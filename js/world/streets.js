/**
 * world/streets.js — street-graph generator for immersive settlements.
 * Each site gets a StreetGraph { nodes, edges } that *forms* the town.
 * Roads are edges, parcels are blocks between them, buildings front onto edges.
 * Deterministic from site seed + archetype. See docs/STREETS_SPEC.md §5.
 */

import { mulberry32, randInt, randFloat, pick } from '../rng.js';

// Helper to find nearest world road point to site center (for spine connection)
function nearestWorldRoadInfo(site, worldRoads) {
  if (!worldRoads || worldRoads.length === 0) return null;
  let best = null;
  let bestDist = Infinity;
  let bestAngle = 0;
  for (const road of worldRoads) {
    for (let i = 0; i < road.points.length - 1; i++) {
      const a = road.points[i], b = road.points[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      let t = ((site.x - a.x) * dx + (site.y - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + t * dx, py = a.y + t * dy;
      const d = Math.hypot(site.x - px, site.y - py);
      if (d < bestDist) {
        bestDist = d;
        best = { x: px, y: py };
        bestAngle = Math.atan2(dy, dx);
      }
    }
  }
  if (!best) return null;
  return { point: best, dist: bestDist, angle: bestAngle };
}

function makeNode(id, x, y, kind = 'junction') {
  return { id, x, y, kind };
}

function makeEdge(id, a, b, kind = 'local', width = 10) {
  return { id, a, b, kind, width };
}

/**
 * Generate a StreetGraph for a single site.
 * @param {object} site - { x, y, archetype, seed, id }
 * @param {Array} worldRoads - world.roads (for spine connection)
 * @param {number} seed - deterministic seed for this site
 * @returns {{ nodes: Array, edges: Array, bbox: object }}
 */
export function generateStreetsForSite(site, worldRoads, seed) {
  const rng = mulberry32(seed >>> 0);
  const arch = site.archetype;
  const spread = arch === 'base' ? 120 : arch === 'town' ? 90 : arch === 'camp' ? 75 : 60;
  const half = spread / 2;
  const bbox = {
    x0: site.x - half,
    y0: site.y - half,
    x1: site.x + half,
    y1: site.y + half,
    w: spread,
    h: spread,
  };

  const roadInfo = nearestWorldRoadInfo(site, worldRoads);
  const roadAngle = roadInfo ? roadInfo.angle : rng() * Math.PI * 2;
  // Perpendicular to road is the settlement's main axis (so spine meets road at ~90deg)
  const spineAngle = roadAngle + Math.PI / 2 + (rng() - 0.5) * 0.4;

  const nodes = [];
  const edges = [];
  let nid = 0, eid = 0;
  const addNode = (x, y, kind) => {
    const n = makeNode(`n${nid++}`, x, y, kind);
    nodes.push(n);
    return n;
  };
  const addEdge = (a, b, kind, width) => {
    const e = makeEdge(`e${eid++}`, a.id, b.id, kind, width);
    edges.push(e);
    return e;
  };

  // Helper to create a spine edge across the bbox
  const makeSpine = (angle, width, kind = 'local') => {
    const cx = site.x, cy = site.y;
    const len = spread * 0.85;
    const dx = Math.cos(angle) * len / 2;
    const dy = Math.sin(angle) * len / 2;
    const a = addNode(cx - dx, cy - dy, 'deadend');
    const b = addNode(cx + dx, cy + dy, 'deadend');
    addEdge(a, b, kind, width);
    return { a, b, angle, width, kind };
  };

  if (arch === 'rural') {
    // 1 spine + 0-1 short spur
    const spine = makeSpine(spineAngle, 8, 'local');
    if (rng() < 0.45) {
      const t = 0.25 + rng() * 0.5;
      const sx = spine.a.x + (spine.b.x - spine.a.x) * t;
      const sy = spine.a.y + (spine.b.y - spine.a.y) * t;
      const spurAngle = spineAngle + Math.PI / 2 + (rng() - 0.5) * 0.3;
      const spurLen = 12 + rng() * 18;
      const j = addNode(sx, sy, 'junction');
      // Find which spine endpoint is closer to j and split the spine? Simpler: just add spur from junction
      // To keep graph simple, we don't split — we just add a deadend spur from the junction point
      // But we need a node at the junction; we already have j at spine interior, but spine currently is a single edge a-b.
      // Split spine edge a-b into a-j and j-b for proper graph connectivity
      // Remove original edge and replace
      edges.pop(); // remove a-b
      addEdge(spine.a, j, 'local', 8);
      addEdge(j, spine.b, 'local', 8);
      const tip = addNode(sx + Math.cos(spurAngle) * spurLen, sy + Math.sin(spurAngle) * spurLen, 'deadend');
      addEdge(j, tip, 'alley', 6);
    }
    // Connect to world road if nearby
    if (roadInfo && roadInfo.dist < 400) {
      // Extend spine nearest endpoint toward roadInfo.point
      const nearest = nodes.reduce((best, n) => {
        const d = Math.hypot(n.x - roadInfo.point.x, n.y - roadInfo.point.y);
        return !best || d < best.d ? { n, d } : best;
      }, null);
      if (nearest && nearest.d > 20) {
        const c = addNode(roadInfo.point.x, roadInfo.point.y, 'gate');
        addEdge(nearest.n, c, 'local', 8);
      }
    }
  } else if (arch === 'town') {
    // Grid: 1 main spine + 1 cross + optional 2nd cross/vertical
    const main = makeSpine(spineAngle, 10, 'local');
    const crossAngle = spineAngle + Math.PI / 2;
    const cross = makeSpine(crossAngle, 9, 'local');
    // Make them intersect at center: add junction at site center and split both
    // Remove the two original edges and replace with 4 edges meeting at junction
    const center = addNode(site.x, site.y, 'junction');
    // Find and remove the two original edges (they are the first two)
    edges.length = 0;
    nodes.length = 1; // keep center only, rebuild
    // Re-add 4 arms
    const mainLen = spread * 0.85 / 2;
    const crossLen = spread * 0.75 / 2;
    const n1 = addNode(site.x - Math.cos(spineAngle) * mainLen, site.y - Math.sin(spineAngle) * mainLen, 'deadend');
    const n2 = addNode(site.x + Math.cos(spineAngle) * mainLen, site.y + Math.sin(spineAngle) * mainLen, 'deadend');
    const n3 = addNode(site.x - Math.cos(crossAngle) * crossLen, site.y - Math.sin(crossAngle) * crossLen, 'deadend');
    const n4 = addNode(site.x + Math.cos(crossAngle) * crossLen, site.y + Math.sin(crossAngle) * crossLen, 'deadend');
    addEdge(n1, center, 'local', 10);
    addEdge(center, n2, 'local', 10);
    addEdge(n3, center, 'local', 9);
    addEdge(center, n4, 'local', 9);
    // Optional second vertical (parallel to main) for larger towns
    if (rng() < 0.5) {
      const off = (rng() > 0.5 ? 1 : -1) * (18 + rng() * 12);
      const ox = -Math.sin(spineAngle) * off;
      const oy = Math.cos(spineAngle) * off;
      const v1 = addNode(n1.x + ox, n1.y + oy, 'deadend');
      const v2 = addNode(n2.x + ox, n2.y + oy, 'deadend');
      addEdge(v1, v2, 'alley', 7);
    }
    if (roadInfo) {
      const c = addNode(roadInfo.point.x, roadInfo.point.y, 'gate');
      // Connect gate to nearest town node
      const nearest = nodes.filter(n => n.kind !== 'gate').reduce((best, n) => {
        const d = Math.hypot(n.x - roadInfo.point.x, n.y - roadInfo.point.y);
        return !best || d < best.d ? { n, d } : best;
      }, null);
      if (nearest) addEdge(nearest.n, c, 'local', 10);
    }
  } else if (arch === 'camp') {
    // Perimeter rectangle + central parade
    const pad = 6;
    const n1 = addNode(bbox.x0 + pad, bbox.y0 + pad, 'junction');
    const n2 = addNode(bbox.x1 - pad, bbox.y0 + pad, 'junction');
    const n3 = addNode(bbox.x1 - pad, bbox.y1 - pad, 'junction');
    const n4 = addNode(bbox.x0 + pad, bbox.y1 - pad, 'junction');
    addEdge(n1, n2, 'perimeter', 8);
    addEdge(n2, n3, 'perimeter', 8);
    addEdge(n3, n4, 'perimeter', 8);
    addEdge(n4, n1, 'perimeter', 8);
    // Parade street across middle
    const p1 = addNode(site.x - spread * 0.3, site.y, 'junction');
    const p2 = addNode(site.x + spread * 0.3, site.y, 'junction');
    addEdge(p1, p2, 'local', 9);
    // Gate on the side facing the road
    if (roadInfo) {
      const side = Math.abs(Math.cos(roadAngle)) > Math.abs(Math.sin(roadAngle)) ? (roadInfo.point.x < site.x ? 'west' : 'east') : (roadInfo.point.y < site.y ? 'north' : 'south');
      let gateEdge, gatePos;
      if (side === 'west') { gateEdge = n1; gatePos = { x: bbox.x0 + pad, y: site.y }; }
      else if (side === 'east') { gateEdge = n2; gatePos = { x: bbox.x1 - pad, y: site.y }; }
      else if (side === 'north') { gateEdge = n1; gatePos = { x: site.x, y: bbox.y0 + pad }; }
      else { gateEdge = n3; gatePos = { x: site.x, y: bbox.y1 - pad }; }
      const gate = addNode(roadInfo.point.x, roadInfo.point.y, 'gate');
      // Find closest perimeter node to gate direction
      const mid = addNode(gatePos.x, gatePos.y, 'junction');
      // Split the perimeter edge that contains mid? For simplicity, just connect mid to gate and add mid to graph
      // Find the edge that is closest to mid and split it
      // Simpler: just connect gate to the nearest perimeter node
      const nearest = [n1, n2, n3, n4].reduce((best, n) => {
        const d = Math.hypot(n.x - roadInfo.point.x, n.y - roadInfo.point.y);
        return !best || d < best.d ? { n, d } : best;
      }, null);
      if (nearest) addEdge(nearest.n, gate, 'local', 8);
    }
  } else if (arch === 'base') {
    // 2x2 grid + gate + motor pool alley
    const nCenter = addNode(site.x, site.y, 'junction');
    const half = spread / 2 - 8;
    const corners = [
      addNode(site.x - half, site.y - half, 'junction'),
      addNode(site.x + half, site.y - half, 'junction'),
      addNode(site.x + half, site.y + half, 'junction'),
      addNode(site.x - half, site.y + half, 'junction'),
    ];
    // Perimeter
    addEdge(corners[0], corners[1], 'perimeter', 10);
    addEdge(corners[1], corners[2], 'perimeter', 10);
    addEdge(corners[2], corners[3], 'perimeter', 10);
    addEdge(corners[3], corners[0], 'perimeter', 10);
    // Cross through center
    addEdge(corners[0], nCenter, 'local', 9);
    addEdge(nCenter, corners[2], 'local', 9);
    addEdge(corners[1], nCenter, 'local', 9);
    addEdge(nCenter, corners[3], 'local', 9);
    // Motor pool alley (short spur off center)
    const alleyAngle = spineAngle + Math.PI / 3;
    const alleyTip = addNode(site.x + Math.cos(alleyAngle) * 18, site.y + Math.sin(alleyAngle) * 18, 'deadend');
    addEdge(nCenter, alleyTip, 'alley', 6);
    if (roadInfo) {
      const gate = addNode(roadInfo.point.x, roadInfo.point.y, 'gate');
      // Gate connects to the side of the base facing the road
      const nearest = corners.reduce((best, n) => {
        const d = Math.hypot(n.x - roadInfo.point.x, n.y - roadInfo.point.y);
        return !best || d < best.d ? { n, d } : best;
      }, null);
      if (nearest) addEdge(nearest.n, gate, 'local', 10);
    }
  }

  // Deduplicate nodes that are very close (within 4u) — merge them
  // Simple O(n^2) for small graphs (<15 nodes)
  for (let i = nodes.length - 1; i >= 0; i--) {
    for (let j = 0; j < i; j++) {
      if (Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y) < 4) {
        const dup = nodes[i];
        const keep = nodes[j];
        // Rewire edges
        for (const e of edges) {
          if (e.a === dup.id) e.a = keep.id;
          if (e.b === dup.id) e.b = keep.id;
        }
        nodes.splice(i, 1);
        break;
      }
    }
  }
  // Remove self-loop edges
  for (let i = edges.length - 1; i >= 0; i--) {
    if (edges[i].a === edges[i].b) edges.splice(i, 1);
  }

  return { nodes, edges, bbox, roadAngle: spineAngle };
}
