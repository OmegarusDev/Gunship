/**
 * World generation — terrain, roads, villages, decorations, enemy rosters.
 * Roads are real entities with surface properties.
 * Villages are first-class objects with archetypes and enemy garrisons.
 */

import { WORLD_SIZE } from './config.js';
import { getDifficulty, getScenario, getStyle } from './contracts.js';
import { mulberry32, randInt, randFloat, pick, clamp, weightedPick } from './rng.js';
import { createTerrain } from './terrain.js';

// ══════════════════════════════════════════════════════════════
//  SURFACE TYPES — affects ground vehicle speed
// ══════════════════════════════════════════════════════════════

export const SURFACE = {
  paved:  { speedMod: 1.3, label: 'Paved' },
  dirt:   { speedMod: 1.0, label: 'Dirt' },
  track:  { speedMod: 0.8, label: 'Track' },
  sand:   { speedMod: 1.0, label: 'Sand' },
  dunes:  { speedMod: 0.6, label: 'Dunes' },
  rock:   { speedMod: 0.8, label: 'Rock' },
  gravel: { speedMod: 0.9, label: 'Gravel' },
};

/** Get speed modifier for a world position (roads take priority over terrain). */
export function getSpeedMod(x, y, roads) {
  // Check roads first
  for (const road of roads) {
    for (let i = 0; i < road.points.length - 1; i++) {
      const p = road.points[i];
      const q = road.points[i + 1];
      const dx = q.x - p.x, dy = q.y - p.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq === 0) continue;
      let t = ((x - p.x) * dx + (y - p.y) * dy) / lenSq;
      t = clamp(t, 0, 1);
      const dist = Math.hypot(x - (p.x + t * dx), y - (p.y + t * dy));
      if (dist < road.width * 0.5) {
        return SURFACE[road.surface].speedMod;
      }
    }
  }
  // Off-road: return sand as default (terrain noise could refine this later)
  return SURFACE.sand.speedMod;
}

// ══════════════════════════════════════════════════════════════
//  TERRAIN COST GRID + LEAST-COST PATHFINDING (roads follow geography)
// ══════════════════════════════════════════════════════════════

const PATH_CELL = 60; // world units per cost cell

/** Sample terrain once into elevation + traversal-cost grids. */
function getTerrainGrid(terrain, worldSize) {
  if (terrain._gridCache) return terrain._gridCache;
  const n = Math.ceil(worldSize / PATH_CELL);
  const elev = new Float32Array(n * n);
  const cost = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const wx = -worldSize / 2 + (i + 0.5) * PATH_CELL;
      const wy = -worldSize / 2 + (j + 0.5) * PATH_CELL;
      const idx = j * n + i;
      const ce = terrain.typeAndElevation(wx, wy);
      elev[idx] = ce.elevation;
      // Base traversal cost by ground: wadis are natural corridors,
      // dunes/rock are slow, settlements (oasis) avoided by through-roads.
      switch (ce.type) {
        case 'hardpack': cost[idx] = 0.8; break;
        case 'sand':     cost[idx] = 1.0; break;
        case 'wadi':     cost[idx] = 0.85; break;
        case 'gravel':   cost[idx] = 1.1; break;
        case 'dunes':    cost[idx] = 2.4; break;
        case 'rock':     cost[idx] = 7.0; break;
        default:         cost[idx] = 3.5; break; // oasis
      }
    }
  }
  const grid = { n, cell: PATH_CELL, elev, cost, half: worldSize / 2 };
  terrain._gridCache = grid;
  return grid;
}

/** A* over the cost grid. Returns polyline of world points, or null. */
function leastCostPath(ax, ay, bx, by, grid) {
  const { n, cell, elev, cost } = grid;
  const toGrid = (x, y) => [
    Math.max(0, Math.min(n - 1, Math.floor((x + grid.half) / cell))),
    Math.max(0, Math.min(n - 1, Math.floor((y + grid.half) / cell))),
  ];
  let [sx, sy] = toGrid(ax, ay);
  let [txx, tyy] = toGrid(bx, by);
  const start = sy * n + sx;
  const goal = tyy * n + txx;
  if (start === goal) return [{ x: ax, y: ay }, { x: bx, y: by }];

  const gScore = new Float32Array(n * n).fill(Infinity);
  const cameFrom = new Int32Array(n * n).fill(-1);
  const closed = new Uint8Array(n * n);
  // Binary heap of [f, node]
  const heap = [];
  const push = (f, node) => {
    heap.push([f, node]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  const h = (idx) => {
    const x = idx % n, y = (idx / n) | 0;
    const dx = x - txx, dy = y - tyy;
    return Math.sqrt(dx * dx + dy * dy) * cell * 0.8;
  };

  gScore[start] = 0;
  push(h(start), start);

  const DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  let found = false;
  let guard = 0;
  while (heap.length && guard++ < 60000) {
    const [, cur] = pop();
    if (cur === goal) { found = true; break; }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % n, cy = (cur / n) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const ni = ny * n + nx;
      if (closed[ni]) continue;
      const stepLen = dx !== 0 && dy !== 0 ? cell * 1.414 : cell;
      const slope = Math.abs(elev[ni] - elev[cur]);
      const step = stepLen * (cost[ni] + slope * 0.06);
      const ng = gScore[cur] + step;
      if (ng < gScore[ni]) {
        gScore[ni] = ng;
        cameFrom[ni] = cur;
        push(ng + h(ni), ni);
      }
    }
  }
  if (!found) return null;

  // Reconstruct
  const pts = [];
  let cur = goal;
  while (cur !== -1) {
    const x = cur % n, y = (cur / n) | 0;
    pts.push({ x: -grid.half + (x + 0.5) * cell, y: -grid.half + (y + 0.5) * cell });
    if (cur === start) break;
    cur = cameFrom[cur];
  }
  pts.reverse();
  // Endpoints exactly at sites
  if (pts.length) {
    pts[0] = { x: ax, y: ay };
    pts[pts.length - 1] = { x: bx, y: by };
  }
  return decimatePath(pts, 150);
}

/** Thin a path to roughly uniform spacing, then soften corners. */
function decimatePath(pts, spacing) {
  if (!pts || pts.length < 3) return pts;
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - out[out.length - 1].x, pts[i].y - out[out.length - 1].y);
    acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc >= spacing) { out.push(pts[i]); acc = 0; }
  }
  const last = pts[pts.length - 1];
  if (Math.hypot(last.x - out[out.length - 1].x, last.y - out[out.length - 1].y) > 30) out.push(last);
  // One Chaikin pass on interior points
  if (out.length > 2) {
    const sm = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const p = out[i], q = out[i + 1];
      sm.push({ x: p.x * 0.72 + q.x * 0.28, y: p.y * 0.72 + q.y * 0.28 });
      sm.push({ x: p.x * 0.28 + q.x * 0.72, y: p.y * 0.28 + q.y * 0.72 });
    }
    sm.push(out[out.length - 1]);
    return sm.filter((_, i) => i % 2 === 0 || i === sm.length - 1);
  }
  return out;
}

function delaunay(points) {
  const n = points.length;
  if (n < 3) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  const dx = maxX - minX || 1;
  const dy = maxY - minY || 1;
  const dmax = Math.max(dx, dy);
  const midx = (minX + maxX) / 2;
  const midy = (minY + maxY) / 2;
  const margin = dmax * 2;
  const st = [
    { x: midx - margin, y: midy - margin },
    { x: midx + margin, y: midy - margin },
    { x: midx, y: midy + margin * 1.5 },
  ];
  const allPts = [...points, st[0], st[1], st[2]];
  const si = n, sj = n + 1, sk = n + 2;
  let tris = [[si, sj, sk]];
  for (let i = 0; i < n; i++) {
    const px = allPts[i].x, py = allPts[i].y;
    const bad = [];
    for (let t = 0; t < tris.length; t++) {
      const [a, b, c] = tris[t];
      if (ptInCircumcircle(px, py, allPts[a], allPts[b], allPts[c])) bad.push(t);
    }
    if (bad.length === 0) continue;
    const edges = [];
    for (const t of bad) {
      const [a, b, c] = tris[t];
      for (const e of [[a, b], [b, c], [c, a]]) {
        const key = e[0] < e[1] ? `${e[0]}_${e[1]}` : `${e[1]}_${e[0]}`;
        let shared = false;
        for (const t2 of bad) {
          if (t2 === t) continue;
          const [a2, b2, c2] = tris[t2];
          for (const e2 of [[a2, b2], [b2, c2], [c2, a2]]) {
            if (key === (e2[0] < e2[1] ? `${e2[0]}_${e2[1]}` : `${e2[1]}_${e2[0]}`)) { shared = true; break; }
          }
          if (shared) break;
        }
        if (!shared) edges.push(e);
      }
    }
    for (let j = bad.length - 1; j >= 0; j--) tris.splice(bad[j], 1);
    for (const [a, b] of edges) tris.push([a, b, i]);
  }
  return tris
    .filter(([a, b, c]) => a < n && b < n && c < n)
    .map(([a, b, c]) => ({ a: allPts[a], b: allPts[b], c: allPts[c] }));
}

function ptInCircumcircle(px, py, a, b, c) {
  const ax = a.x - px, ay = a.y - py;
  const bx = b.x - px, by = b.y - py;
  const cx = c.x - px, cy = c.y - py;
  const det = (ax * ax + ay * ay) * (bx * cy - cx * by)
            - (bx * bx + by * by) * (ax * cy - cx * ay)
            + (cx * cx + cy * cy) * (ax * by - bx * ay);
  return det > 1e-10;
}

function triangulationEdges(triangles) {
  const edgeSet = new Set();
  const edges = [];
  for (const tri of triangles) {
    for (const [p1, p2] of [[tri.a, tri.b], [tri.b, tri.c], [tri.c, tri.a]]) {
      const k1 = `${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
      const k2 = `${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
      const key = k1 < k2 ? k1 + '|' + k2 : k2 + '|' + k1;
      if (!edgeSet.has(key)) { edgeSet.add(key); edges.push([p1, p2]); }
    }
  }
  return edges;
}

// ══════════════════════════════════════════════════════════════
//  ROAD GENERATION — terrain-following network between real settlements
// ══════════════════════════════════════════════════════════════

/** Union-find for MST construction. */
function ufFind(parent, i) {
  while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
  return parent[i];
}

export function generateRoads(seed, worldSize, terrain, sites) {
  const rng = mulberry32(seed);
  const roads = [];

  // ── Highway backbone: MST over settlement positions, routed by terrain ──
  const nodes = sites.map((s, i) => ({ x: s.x, y: s.y, i }));
  const edges = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
      if (d < worldSize * 0.7) edges.push({ a: i, b: j, d });
    }
  }
  edges.sort((e1, e2) => e1.d - e2.d);
  const parent = nodes.map((_, i) => i);
  const grid = getTerrainGrid(terrain, worldSize);
  const connectedCount = { n: 0 };

  for (const e of edges) {
    const ra = ufFind(parent, e.a), rb = ufFind(parent, e.b);
    if (ra === rb) continue;
    parent[ra] = rb;
    const path = leastCostPath(nodes[e.a].x, nodes[e.a].y, nodes[e.b].x, nodes[e.b].y, grid);
    if (path && path.length >= 2) {
      roads.push({
        points: path,
        width: randFloat(24, 34, rng),
        surface: 'paved',
        hierarchy: 'highway',
      });
      connectedCount.n++;
    }
  }

  // ── Secondary dirt connectors: each site → nearest existing road ──
  const pointOnRoads = (x, y) => {
    let best = null, bd = Infinity;
    for (const r of roads) {
      if (r.hierarchy !== 'highway') continue;
      for (const p of r.points) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bd) { bd = d; best = p; }
      }
    }
    return best ? { p: best, d: bd } : null;
  };
  for (const s of sites) {
    const near = pointOnRoads(s.x, s.y);
    if (!near || near.d > 260) {
      // Not adjacent to the highway network — route a dirt spur.
      const target = near ? near.p : { x: clamp(s.x * 0.5, -worldSize * 0.4, worldSize * 0.4), y: clamp(s.y * 0.5, -worldSize * 0.4, worldSize * 0.4) };
      const path = leastCostPath(s.x, s.y, target.x, target.y, grid);
      if (path && path.length >= 2) {
        roads.push({ points: path, width: randFloat(14, 22, rng), surface: 'dirt', hierarchy: 'secondary' });
      }
    }
  }

  // ── Regional highways: routes that EXIT the map ──────────────────────
  // Real highways don't stop at the operational boundary. Each exit road
  // targets the EMPTIEST point on the boundary (farthest from every
  // settlement), so the network deliberately crosses the empty quarters
  // and reads as part of a larger world.
  {
    // Boundary sample ring
    const edgePts = [];
    for (let k = 0; k < 24; k++) {
      const ang = (k / 24) * Math.PI * 2;
      edgePts.push({
        x: clamp(Math.cos(ang) * worldSize * 0.47, -worldSize * 0.47, worldSize * 0.47),
        y: clamp(Math.sin(ang) * worldSize * 0.47, -worldSize * 0.47, worldSize * 0.47),
      });
    }
    const minDistToSites = (p) => {
      let m = Infinity;
      for (const s of sites) m = Math.min(m, Math.hypot(s.x - p.x, s.y - p.y));
      return m;
    };
    const peripheral = [...sites]
      .map((s, i) => ({ i, r: Math.hypot(s.x, s.y) }))
      .sort((a, b) => b.r - a.r)
      .slice(0, 3);
    const taken = [];
    for (const { i } of peripheral) {
      const s = sites[i];
      // Best edge point: far from all sites AND far from previous exits.
      let best = null, bestScore = -Infinity;
      for (const e of edgePts) {
        let score = minDistToSites(e);
        for (const t of taken) {
          const d = Math.hypot(t.x - e.x, t.y - e.y);
          if (d < 2600) { score = -Infinity; break; } // spread exits apart
          score += d * 0.15;
        }
        if (score > bestScore) { bestScore = score; best = e; }
      }
      if (!best) continue;
      const path = leastCostPath(s.x, s.y, best.x, best.y, grid);
      if (path && path.length >= 2) {
        roads.push({
          points: path,
          width: randFloat(22, 30, rng),
          surface: 'paved',
          hierarchy: 'highway',
        });
        taken.push(best);
      }
    }
  }

  // ── Local tracks: short organic spurs off the network (texture) ──
  for (let i = 0; i < randInt(8, 14, rng); i++) {
    const parentRoad = pick(roads.filter(r => r.hierarchy !== 'local'), rng);
    if (!parentRoad || parentRoad.points.length < 2) continue;
    const idx = randInt(0, parentRoad.points.length - 2, rng);
    const p1 = parentRoad.points[idx], p2 = parentRoad.points[idx + 1];
    const t = rng();
    const start = { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
    const parentAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const growAngle = parentAngle + (rng() > 0.5 ? 1 : -1) * (0.5 + rng() * 1.6);
    const pts = growthRoad(start, growAngle, worldSize, roads, rng, 0.05);
    if (pts.length >= 3) {
      roads.push({ points: pts, width: randFloat(6, 12, rng), surface: 'track', hierarchy: 'local' });
    }
  }

  return roads;
}

function bezierRoad(a, b, rng, subdivisions) {
  const points = [];
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const perpAngle = angle + Math.PI / 2;
  const offsetDist = Math.hypot(b.x - a.x, b.y - a.y) * (0.1 + rng() * 0.2) * (rng() > 0.5 ? 1 : -1);
  const cp = { x: mx + Math.cos(perpAngle) * offsetDist, y: my + Math.sin(perpAngle) * offsetDist };
  for (let i = 0; i <= subdivisions; i++) {
    const t = i / subdivisions;
    points.push({
      x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * cp.x + t * t * b.x,
      y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * cp.y + t * t * b.y,
    });
  }
  return points;
}

function growthRoad(start, startAngle, worldSize, existingRoads, rng, maxLenFrac) {
  const points = [{ ...start }];
  let x = start.x, y = start.y, angle = startAngle;
  const totalLen = worldSize * (0.03 + rng() * maxLenFrac);
  let traveled = 0;
  while (traveled < totalLen) {
    angle += (rng() - 0.5) * 0.4;
    const stepLen = 40 + rng() * 80;
    const nx = x + Math.cos(angle) * stepLen;
    const ny = y + Math.sin(angle) * stepLen;
    if (Math.abs(nx) > worldSize * 0.48 || Math.abs(ny) > worldSize * 0.48) break;
    let tooClose = false;
    for (const road of existingRoads) {
      for (const p of road.points) {
        if (Math.hypot(nx - p.x, ny - p.y) < road.width + 10) { tooClose = true; break; }
      }
      if (tooClose) break;
    }
    if (tooClose) break;
    x = nx; y = ny;
    points.push({ x, y });
    traveled += stepLen;
  }
  return points;
}

// ══════════════════════════════════════════════════════════════
//  SITE ARCHETYPES — from GDD
// ══════════════════════════════════════════════════════════════

export const ARCHETYPES = {
  rural: {
    buildingCount: [1, 5],
    enemyCount: [1, 8],
    // class → weight (resolved at worldgen)
    classes: { unarmed: 10, rifleman: 2, assault: 1 },
    minArmed: 1,            // normally at least one gunman defends the village
    unarmedOnlyChance: 0.25, // ...but tiny hamlets may be wholly civilian
    buildings: ['hut', 'hut', 'sandbag', 'crate_stack'],
    fear: [5, 15], dollars: [10, 50],
    detectionRadius: 350,  // enemies start shooting from this distance
    alertRadius: 500,      // reinforcements spawn when alerted
    garrisonFraction: 0.3, // 30% always present
    clearPenalty: 15,
  },
  town: {
    buildingCount: [6, 20],
    enemyCount: [10, 40],
    classes: { unarmed: 5, rifleman: 3, assault: 2, mg: 1, rpg: 1 },
    minArmed: 2,
    buildings: ['hut', 'depot', 'tower', 'sandbag', 'barracks'],
    fear: [20, 60], dollars: [50, 200],
    detectionRadius: 400,
    alertRadius: 550,
    garrisonFraction: 0.25,
    clearPenalty: 30,
  },
  camp: {
    buildingCount: [3, 8],
    enemyCount: [5, 15],
    classes: { rifleman: 6, assault: 3, mg: 2, rpg: 2, manpads: 1 },
    minArmed: 3,
    buildings: ['sandbag', 'depot', 'tower', 'barracks', 'crate_stack'],
    fear: [15, 40], dollars: [30, 120],
    detectionRadius: 380,
    alertRadius: 520,
    garrisonFraction: 0.3,
    clearPenalty: 20,
  },
  base: {
    buildingCount: [8, 30],
    enemyCount: [20, 80],
    classes: { unarmed: 1, rifleman: 3, assault: 3, mg: 2, rpg: 2, manpads: 1, lightAA: 1, shilka: 1, tank: 1, apc: 1 },
    minArmed: 4, // a couple of labourers at most; bases are heavily defended
    buildings: ['bunker', 'barracks', 'depot', 'tower', 'garage', 'sandbag', 'crate_stack'],
    fear: [40, 120], dollars: [100, 500],
    detectionRadius: 450,
    alertRadius: 600,
    garrisonFraction: 0.2,
    clearPenalty: 45,
  },
};

// ══════════════════════════════════════════════════════════════
//  ENEMY CLASSES — what spawns at worldgen
// ══════════════════════════════════════════════════════════════

// Enemy classes define the COUNT and CATEGORY of enemy.
// Loadout (weapon type) is resolved on discovery based on difficulty.
export const ENEMY_CLASSES = {
  unarmed:    { hp: 8,  speed: 20, points: 5,  color: '#a08060', size: 3, behavior: 'patrol', category: 'infantry' },
  rifleman:   { hp: 15, speed: 30, points: 10, color: '#8a6a4a', size: 4, behavior: 'patrol', category: 'infantry' },
  assault:    { hp: 20, speed: 35, points: 15, color: '#7a5a3a', size: 4, behavior: 'ambush', category: 'infantry' },
  mg:         { hp: 25, speed: 0,  points: 20, color: '#6a5a3a', size: 5, behavior: 'guard',  category: 'infantry' },
  rpg:        { hp: 18, speed: 25, points: 25, color: '#5a4a2a', size: 4, behavior: 'ambush', category: 'infantry' },
  manpads:    { hp: 15, speed: 20, points: 40, color: '#4a3a1a', size: 4, behavior: 'guard',  category: 'infantry' },
  lightAA:    { hp: 40, speed: 0,  points: 30, color: '#6a6a5a', size: 6, behavior: 'fixed',  category: 'emplacement' },
  shilka:     { hp: 60, speed: 40, points: 50, color: '#5a5a4a', size: 8, behavior: 'escort', category: 'vehicle' },
  tank:       { hp: 120,speed: 25, points: 75, color: '#6a6a4a', size: 10,behavior: 'patrol', category: 'vehicle' },
  apc:        { hp: 80, speed: 35, points: 40, color: '#7a7a5a', size: 9, behavior: 'escort', category: 'vehicle' },
  sam:        { hp: 50, speed: 30, points: 60, color: '#5a6a5a', size: 8, behavior: 'mobile_def', category: 'vehicle' },
  technical:  { hp: 45, speed: 55, points: 25, color: '#7a6040', size: 7, behavior: 'patrol', category: 'vehicle' },
};

/** Resolve a class name to an enemy type name (for backwards compat with app.js). */
export function classToEnemyType(className) {
  // Map old names to new if needed, or return as-is
  const map = {
    unarmed: 'rifleman', // unarmed enemies still render as infantry, just weaker
    rifleman: 'rifleman',
    assault: 'assault',
    mg: 'mg',
    rpg: 'rpg',
    manpads: 'manpads',
    lightAA: 'lightAA',
    shilka: 'shilka',
    tank: 'tank',
    apc: 'apc',
    sam: 'sam',
    technical: 'technical',
  };
  return map[className] || 'rifleman';
}

// ══════════════════════════════════════════════════════════════
//  VILLAGE GENERATION — with archetypes and enemy rosters
// ══════════════════════════════════════════════════════════════

export function generateSites(seed, roads, worldSize, terrain) {
  const rng = mulberry32(seed + 1000);
  const sites = [];

  // ── Geographic candidate anchors ────────────────────────────────────
  // Like real desert peopling: most settlements hug water, but confluences,
  // high ground and plain hamlets exist too.
  const candidates = [];
  if (terrain) {
    // 1) Water anchors — oases get first claim (strongest sites).
    for (const o of terrain.oases) {
      candidates.push({ x: o.x + randFloat(-90, 90, rng), y: o.y + randFloat(-90, 90, rng), kind: 'water' });
    }
    // Wadi-bank hamlets along trunk channels.
    for (const w of terrain.wadis) {
      if (w.order !== 1) continue;
      for (const t of [0.3, 0.6, 0.85]) {
        if (rng() < 0.55) continue;
        const p = w.points[Math.floor(t * (w.points.length - 1))];
        // Offset perpendicular off the channel bed.
        const nxt = w.points[Math.min(w.points.length - 1, Math.floor(t * (w.points.length - 1)) + 1)];
        const ang = Math.atan2(nxt.y - p.y, nxt.x - p.x) + Math.PI / 2 * (rng() > 0.5 ? 1 : -1);
        candidates.push({
          x: p.x + Math.cos(ang) * (w.width * 0.9 + 40),
          y: p.y + Math.sin(ang) * (w.width * 0.9 + 40),
          kind: 'water',
        });
      }
    }
    // 2) Confluence anchors — where tributaries near trunks.
    for (const t of terrain.wadis) {
      if (t.order !== 2) continue;
      const end = t.points[0];
      candidates.push({ x: end.x + randFloat(-60, 60, rng), y: end.y + randFloat(-60, 60, rng), kind: 'junction' });
    }
    // 3) High-ground anchors — defensible spurs below peaks.
    for (const h of terrain.highs) {
      const n = randInt(1, 2, rng);
      for (let i = 0; i < n; i++) {
        const ang = rng() * Math.PI * 2;
        const d = h.radius * randFloat(0.95, 1.35);
        candidates.push({
          x: h.x + Math.cos(ang) * d,
          y: h.y + Math.sin(ang) * d,
          kind: 'high',
        });
      }
    }
    // 4) Free scatter — hamlets anywhere plausible.
    for (let i = 0; i < 26; i++) {
      candidates.push({
        x: randFloat(-worldSize * 0.44, worldSize * 0.44, rng),
        y: randFloat(-worldSize * 0.44, worldSize * 0.44, rng),
        kind: 'scatter',
      });
    }
  } else {
    // Fallback: legacy random centres (no terrain provided).
    for (let i = 0; i < 6; i++) {
      candidates.push({ x: randFloat(-worldSize * 0.35, worldSize * 0.35, rng), y: randFloat(-worldSize * 0.35, worldSize * 0.35, rng), kind: 'scatter' });
    }
  }

  // ── Resolve candidates: reject implausible, enforce spacing ─────────
  const placed = [];
  const usedNames = new Set();
  const minSep = 430;
  const passesTypeCheck = (c) => {
    if (!terrain) return true;
    const ty = terrain.type(c.x, c.y);
    if (ty === 'rock') return false;             // no villages on peaks
    if (ty === 'wadi' && c.kind !== 'water') return false; // not IN the channel
    return true;
  };
  // Water anchors first (they're the prime locations), then the rest.
  candidates.sort((a, b) => (a.kind === 'water' ? -1 : 0) - (b.kind === 'water' ? -1 : 0));
  for (const c of candidates) {
    if (placed.length >= 16) break;
    if (!passesTypeCheck(c)) continue;
    let tooClose = false;
    for (const p of placed) {
      // Water sites may pack tighter (real oases chain closely).
      const sep = (c.kind === 'water' && p.kind === 'water') ? minSep * 0.72 : minSep;
      if (Math.hypot(c.x - p.x, c.y - p.y) < sep) { tooClose = true; break; }
    }
    if (!tooClose) placed.push(c);
  }

  // ── Waypoint hamlets: midpoints between distant water sites ─────────
  // Caravan logic — long crossings stop where the road says stop.
  const waterSites = placed.filter(p => p.kind === 'water');
  const waypoints = [];
  for (let i = 0; i < waterSites.length && waypoints.length < 4; i++) {
    for (let j = i + 1; j < waterSites.length && waypoints.length < 4; j++) {
      const a = waterSites[i], b = waterSites[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < 3200) continue;
      const mid = {
        x: (a.x + b.x) / 2 + randFloat(-260, 260, rng),
        y: (a.y + b.y) / 2 + randFloat(-260, 260, rng),
        kind: 'waypoint',
      };
      if (!passesTypeCheck(mid)) continue;
      if (placed.some(p => Math.hypot(mid.x - p.x, mid.y - p.y) < 380)) continue;
      if (waypoints.some(p => Math.hypot(mid.x - p.x, mid.y - p.y) < 500)) continue;
      waypoints.push(mid);
      placed.push(mid);
      if (placed.length >= 16) break;
    }
  }

  // ── Sector coverage guarantee: no silent quarter of the map ─────────
  // 3x3 sectors over the play area; force a hamlet into any empty one.
  const SECT = 3, secW = (worldSize * 0.88) / SECT;
  const sectorOf = (p) => {
    const cx = Math.min(SECT - 1, Math.max(0, Math.floor((p.x + worldSize * 0.44) / secW)));
    const cy = Math.min(SECT - 1, Math.max(0, Math.floor((p.y + worldSize * 0.44) / secW)));
    return cy * SECT + cx;
  };
  const occupied = new Set(placed.map(sectorOf));
  for (let sec = 0; sec < SECT * SECT && placed.length < 16; sec++) {
    if (occupied.has(sec)) continue;
    const sx = (sec % SECT) * secW - worldSize * 0.44;
    const sy = Math.floor(sec / SECT) * secW - worldSize * 0.44;
    for (let attempt = 0; attempt < 6; attempt++) {
      const cand = {
        x: sx + randFloat(secW * 0.2, secW * 0.8, rng),
        y: sy + randFloat(secW * 0.2, secW * 0.8, rng),
        kind: 'scatter',
      };
      if (!passesTypeCheck(cand)) continue;
      if (placed.some(p => Math.hypot(cand.x - p.x, cand.y - p.y) < 300)) continue;
      placed.push(cand);
      occupied.add(sec);
      break;
    }
  }

  // Highway-junction bonus candidates from the road network itself.
  const junctionCandidates = [];
  for (let i = 0; i < roads.length && junctionCandidates.length < 2; i++) {
    if (roads[i].hierarchy !== 'highway') continue;
    for (let j = i + 1; j < roads.length; j++) {
      if (roads[j].hierarchy !== 'highway') continue;
      for (const p1 of roads[i].points) {
        for (const p2 of roads[j].points) {
          if (Math.hypot(p1.x - p2.x, p1.y - p2.y) < 200) {
            junctionCandidates.push({ x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2, kind: 'junction' });
            break;
          }
        }
        if (junctionCandidates.length >= 2) break;
      }
      if (junctionCandidates.length >= 2) break;
    }
  }
  for (const jc of junctionCandidates) {
    if (placed.length >= 14) break;
    if (!placed.some(p => Math.hypot(jc.x - p.x, jc.y - p.y) < 380)) placed.push(jc);
  }

  // ── Build sites at the accepted positions ───────────────────────────
  for (const pos of placed) {
    if (sites.length >= 16) break;
    const dist = Math.hypot(pos.x, pos.y);
    const distFrac = dist / (worldSize * 0.45); // 0 at center, 1 at edge

    // Archetype selection based on distance (difficulty progression)
    let archetype;
    const roll = rng();
    if (distFrac < 0.15) {
      archetype = 'rural';
    } else if (distFrac < 0.35) {
      archetype = roll < 0.6 ? 'rural' : 'camp';
    } else if (distFrac < 0.6) {
      archetype = roll < 0.3 ? 'rural' : roll < 0.6 ? 'town' : 'camp';
    } else {
      archetype = roll < 0.15 ? 'rural' : roll < 0.4 ? 'town' : roll < 0.65 ? 'camp' : 'base';
    }

    const arch = ARCHETYPES[archetype];
    const numBuildings = randInt(arch.buildingCount[0], arch.buildingCount[1], rng);
    const spread = archetype === 'base' ? 120 : archetype === 'town' ? 90 : 60;

    // Find nearest road to cluster buildings along it
    let nearestRoad = null;
    let nearestDist = Infinity;
    for (const road of roads) {
      for (const pt of road.points) {
        const d = Math.hypot(pt.x - pos.x, pt.y - pos.y);
        if (d < nearestDist) { nearestDist = d; nearestRoad = road; }
      }
    }

    const buildings = [];
    for (let b = 0; b < numBuildings; b++) {
      let bx, by;
      if (nearestRoad && nearestRoad.points.length >= 2 && rng() < 0.7) {
        // 70% of buildings cluster along the road
        const idx = Math.floor(rng() * (nearestRoad.points.length - 1));
        const pt = nearestRoad.points[idx];
        const nextPt = nearestRoad.points[idx + 1];
        const roadAngle = Math.atan2(nextPt.y - pt.y, nextPt.x - pt.x);
        const perpAngle = roadAngle + Math.PI / 2;
        const offset = (rng() - 0.5) * spread * 0.8;
        bx = pt.x + Math.cos(perpAngle) * offset + (rng() - 0.5) * 20;
        by = pt.y + Math.sin(perpAngle) * offset + (rng() - 0.5) * 20;
      } else {
        // 30% scattered around village center
        bx = pos.x + (rng() - 0.5) * spread;
        by = pos.y + (rng() - 0.5) * spread;
      }
      buildings.push({ x: bx, y: by, type: pick(arch.buildings, rng) });
    }

    // Generate enemy roster at worldgen
    const numEnemies = randInt(arch.enemyCount[0], arch.enemyCount[1], rng);
    const scaledCount = Math.max(1, Math.floor(numEnemies * (1 + distFrac * 0.5)));
    const id = `site-${String(sites.length + 1).padStart(2, '0')}`;
    const allEnemies = generateEnemyRoster(arch.classes, scaledCount, rng, buildings, pos.x, pos.y, id, {
      minArmed: arch.minArmed ?? 1,
      unarmedOnlyChance: arch.unarmedOnlyChance ?? 0,
    });

    sites.push({
      id,
      x: pos.x, y: pos.y,
      archetype,
      terrainKind: pos.kind || 'scatter',
      buildings,
      enemies: allEnemies,
      name: generateVillageName(rng, usedNames, pos.kind || 'scatter'),
      discovered: false,
      cleared: false,
      detectionRadius: arch.detectionRadius,
    });
  }

  return sites;
}

/** Generate enemy roster.
 *  Guarantees `minArmed` armed defenders unless the site is a tiny settlement
 *  that rolls `unarmedOnlyChance` (rural hamlets only). Remaining slots are
 *  filled by weighted pick, so civilians outnumber gunmen in rural sites. */
function generateEnemyRoster(classWeights, count, rng, buildings, villageX, villageY, siteId, opts = {}) {
  const minArmed = opts.minArmed ?? 1;
  const unarmedOnlyChance = opts.unarmedOnlyChance ?? 0;
  const classes = Object.keys(classWeights);
  const weights = classes.map(c => classWeights[c]);
  const armedClasses = classes.filter(c => c !== 'unarmed');
  const armedWeights = armedClasses.map(c => classWeights[c]);

  // Only the smallest settlements may be completely unarmed.
  const unarmedOnly = count <= 3 && rng() < unarmedOnlyChance;
  const guaranteedArmed = unarmedOnly ? 0 : Math.min(minArmed, count);

  const roster = [];
  const indoorCount = Math.max(1, Math.floor(count * 0.2));
  let armedPlaced = 0;

  for (let i = 0; i < count; i++) {
    let className;
    if (i < guaranteedArmed) {
      className = weightedPick(armedClasses, armedWeights, rng);
      armedPlaced++;
    } else {
      className = weightedPick(classes, weights, rng);
      if (className !== 'unarmed') armedPlaced++;
    }
    const isIndoor = i < indoorCount;
    let offsetX, offsetY;

    if (isIndoor && buildings.length > 0) {
      // Indoor enemies start at a building position
      const b = buildings[Math.floor(rng() * buildings.length)];
      offsetX = b.x - villageX;
      offsetY = b.y - villageY;
    } else {
      // Outdoor enemies patrol around the settlement
      const angle = rng() * Math.PI * 2;
      const dist = 20 + rng() * 100;
      offsetX = Math.cos(angle) * dist;
      offsetY = Math.sin(angle) * dist;
    }

    roster.push({
      id: `${siteId}-spawn-${String(i + 1).padStart(2, '0')}`,
      className,
      offsetX,
      offsetY,
      isIndoor,
      active: false,
    });
  }
  return roster;
}

// ══════════════════════════════════════════════════════════════
//  PLACE NAMES — pure syllable assembly. Nothing real, ever.
//  Onsets/nuclei/codas are thrown in a pot and rolled per syllable,
//  with apostrophes (glottal stop) and hyphens (article / compound)
//  following transliteration convention. Result: names like
//  "Zukhranabad", "Wadi al-Qushmir", "Tell Ra'khaniyya" — all fiction.
// ══════════════════════════════════════════════════════════════

const NAME_ONSETS = ['b','b','d','dh','f','g','gh','h','j','k','kh','kh','l','m','m','n','q','q','r','s','sh','sh','t','th','w','y','z','zh'];
const NAME_NUCLEI = ['a','a','a','i','i','u','aa','ii','ou','ai'];
const NAME_CODAS  = ['b','d','dh','f','g','j','k','kh','l','m','n','q','r','r','s','sh','t','z',''];
const NAME_SUFFIX = ['abad','iyya','istan','ah','iya','oun','at','ir','im','ar','eib','oul'];
// Generic geographic honorifics — landscape words, not real places.
const NAME_GEO = {
  water:   ['Ain', 'Bir', 'Wadi', 'Hammam'],
  junction:['Qasr', 'Khan', 'Suk'],
  high:    ['Tell', "Qal'at", 'Khirbet', 'Ras'],
  waypoint:['Maqam', 'Khan', 'Midan'],
  scatter: ['Khirbet', 'Nabaa', 'Deir', 'Marj'],
};

/** Build one invented Arabic-flavoured core of 2–3 syllables.
 *  Phonotactics: medial codas are sonorants only, and a coda must be
 *  followed by a liquid/nasal/glide onset — no "ghsq" porridge. */
function nameCore(rng) {
  const MEDIAL_CODA = ['l', 'm', 'n', 'r', 's'];
  const SOFT_ONSET = ['l', 'm', 'n', 'r', 'w', 'y', 'h', ''];
  const n = rng() < 0.65 ? 2 : 3;
  let s = '';
  for (let i = 0; i < n; i++) {
    let onset = pick(NAME_ONSETS, rng);
    let coda = '';
    if (i === n - 1) {
      // Word-final: anything goes (minus nothing)
      coda = pick(NAME_CODAS, rng);
    } else {
      // Medial: light codas only, and force a soft onset after one.
      if (s && rng() < 0.4) coda = pick(MEDIAL_CODA, rng);
      if (coda) onset = pick(SOFT_ONSET, rng);
      if (!onset && rng() < 0.5) onset = pick(['b', 'k', 't'], rng);
    }
    s += onset + pick(NAME_NUCLEI, rng) + coda;
  }
  return s[0].toUpperCase() + s.slice(1);
}

function generateVillageName(rng, used, terrainKind) {
  const geoPool = NAME_GEO[terrainKind] || NAME_GEO.scatter;
  for (let attempt = 0; attempt < 24; attempt++) {
    const core = nameCore(rng);
    const roll = rng();
    let name;
    if (roll < 0.22) {
      name = `Al-${core}${pick(NAME_SUFFIX, rng)}`;            // Al-Zakhmiriyya
    } else if (roll < 0.42) {
      name = `${pick(geoPool, rng)}-${core}`;                  // Bir-Qashoul
    } else if (roll < 0.56) {
      name = `${pick(geoPool, rng)} al-${core}`;               // Wadi al-Kharnoub
    } else if (roll < 0.68) {
      name = `${core}${pick(NAME_SUFFIX, rng)}`;               // Muhdafiyya
    } else if (roll < 0.8) {
      // Glottal-stop compound: break inside the core, never between
      // identical consonants (no "q'q").
      const cut = Math.max(1, Math.floor(core.length * 0.6));
      const cleanCut = core[cut - 1]?.toLowerCase() === core[cut]?.toLowerCase()
        ? cut + 1 : cut;
      name = `${core.slice(0, cleanCut)}'${core.slice(cleanCut).toLowerCase()}${rng() < 0.5 ? pick(NAME_SUFFIX, rng) : ''}`;
    } else {
      name = core;
    }
    if (!used.has(name)) { used.add(name); return name; }
  }
  return nameCore(rng) + pick(NAME_SUFFIX, rng); // last resort, collisions near-impossible
}

// ══════════════════════════════════════════════════════════════
//  PATROL CONVOYS — follow road graph between villages
// ══════════════════════════════════════════════════════════════

/** Cumulative arc length per route point — enables exact path positioning. */
function buildRouteCum(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  return cum;
}

/** Resample a polyline to dense uniform spacing so straight-line
 *  waypoint-following hugs the road centerline exactly. */
function densifyRoute(pts, spacing = 55) {
  if (!pts || pts.length < 2) return pts;
  const out = [pts[0]];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen < 1) continue;
    let d = spacing - carry;
    while (d <= segLen) {
      const t = d / segLen;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      d += spacing;
    }
    carry = (carry + segLen) % spacing;
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function generateConvoys(seed, roads, sites, worldSize) {
  const rng = mulberry32(seed + 3000);
  const convoys = [];

  const highways = roads.filter(r => r.hierarchy === 'highway');
  if (highways.length === 0) return convoys;

  const numConvoys = randInt(2, 4, rng);

  for (let i = 0; i < numConvoys; i++) {
    const road = pick(highways, rng);
    if (!road || road.points.length < 4) continue;

    // Pick a direction (forward or backward along road)
    const forward = rng() > 0.5;
    const points = forward ? road.points : [...road.points].reverse();

    // Create a patrol route: loop along this road, densely sampled so
    // vehicles track the centreline precisely through curves.
    const routeLen = Math.min(points.length, randInt(4, 8, rng));
    const startIdx = randInt(0, Math.max(0, points.length - routeLen), rng);
    const coarse = [];
    for (let j = 0; j < routeLen; j++) coarse.push(points[startIdx + j]);
    const route = densifyRoute(coarse, 55);
    if (route.length < 3) continue;

    // Composition: mix of vehicles and infantry
    const composition = [];
    let vehicleCount = 0;
    const numVehicles = randInt(1, 3, rng);
    for (let v = 0; v < numVehicles; v++) {
      composition.push(pick(['technical', 'apc', 'shilka'], rng));
      vehicleCount++;
    }
    const numInfantry = randInt(2, 6, rng);
    for (let inf = 0; inf < numInfantry; inf++) {
      composition.push(pick(['rifleman', 'assault', 'rpg'], rng));
    }

    convoys.push({
      id: `convoy-${String(i + 1).padStart(2, '0')}`,
      route,
      routeCum: buildRouteCum(route),
      s: 60,                 // arc-length position of the lead along the route
      direction: 1,          // ping-pong patrol direction
      composition,
      surface: road.surface, // speed mod by the road it patrols
      x: route[0].x,
      y: route[0].y,
      angle: 0,
      baseSpeed: 25 + rng() * 15,
      speed: (25 + rng() * 15) * (SURFACE[road.surface]?.speedMod || 1),
      active: false,
      hp: 70 + vehicleCount * 30,
      maxHp: 70 + vehicleCount * 30,
      fireCooldown: 0,
      flashTimer: 0,
      destroyed: false,
    });
  }

  return convoys;
}

// ══════════════════════════════════════════════════════════════
//  DECORATIONS
// ══════════════════════════════════════════════════════════════

export function generateDecorations(seed, worldSize, roads, villages, terrain) {
  const rng = mulberry32(seed + 2000);
  const decos = [];
  const numDecos = Math.floor(worldSize * worldSize * 0.00005);

  // Ecology lookups: vegetation follows water, rocks follow height.
  const nearestWadiDist = terrain
    ? (x, y) => {
        let best = Infinity;
        for (const w of terrain.wadis) {
          for (let i = 0; i < w.points.length - 1; i++) {
            const a = w.points[i], b = w.points[i + 1];
            const dx = b.x - a.x, dy = b.y - a.y;
            const l2 = dx * dx + dy * dy || 1e-6;
            let t = ((x - a.x) * dx + (y - a.y) * dy) / l2;
            t = clamp(t, 0, 1);
            const d = Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
            if (d < best) best = d;
          }
        }
        return best;
      }
    : null;
  const nearestOasisDist = terrain
    ? (x, y) => {
        let best = Infinity;
        for (const o of terrain.oases) {
          const d = Math.hypot(x - o.x, y - o.y);
          if (d < best) best = d;
        }
        return best;
      }
    : null;

  for (let i = 0; i < numDecos; i++) {
    const x = (rng() - 0.5) * worldSize * 0.95;
    const y = (rng() - 0.5) * worldSize * 0.95;

    // Skip roads and villages as before.
    let nearRoad = false;
    for (const road of roads) {
      for (const p of road.points) {
        if (Math.hypot(p.x - x, p.y - y) < road.width + 10) { nearRoad = true; break; }
      }
      if (nearRoad) break;
    }
    if (nearRoad) continue;
    let nearVillage = false;
    for (const v of villages) {
      if (Math.hypot(v.x - x, v.y - y) < 100) { nearVillage = true; break; }
    }
    if (nearVillage) continue;

    // Ecological placement.
    const wd = nearestWadiDist ? nearestWadiDist(x, y) : Infinity;
    const od = nearestOasisDist ? nearestOasisDist(x, y) : Infinity;
    const ty = terrain ? terrain.type(x, y) : 'sand';

    const roll = rng();
    let type, size;
    if (od < 220 && roll < 0.75) {
      // Palm groves ring the oases — nothing else grows there like this.
      type = 'palm'; size = 9 + rng() * 7;
    } else if (wd < 140 && roll < 0.6) {
      // Tamarisk / scrub lines trace the wadi banks.
      type = 'bush'; size = 4 + rng() * 8;
    } else if (ty === 'rock' || ty === 'gravel') {
      // Rocky highlands and gravel aprons shed stones.
      if (roll < 0.55) { type = 'rock'; size = 5 + rng() * 12; }
      else if (roll < 0.7) { type = 'bush'; size = 2 + rng() * 4; }
      else continue;
    } else if (ty === 'dunes') {
      // Dune fields are near-barren; occasional dry shrub.
      if (roll < 0.12) { type = 'bush'; size = 2 + rng() * 3; }
      else continue;
    } else {
      // Open desert: sparse scrub and the occasional crater.
      if (roll < 0.16) { type = 'bush'; size = 3 + rng() * 6; }
      else if (roll < 0.24) { type = 'rock'; size = 4 + rng() * 10; }
      else if (roll < 0.28) { type = 'crater'; size = 10 + rng() * 20; }
      else continue;
    }
    decos.push({ x, y, type, size, angle: rng() * Math.PI * 2 });
  }

  // Guaranteed oasis palm groves (dense clusters at every oasis).
  if (terrain) {
    for (const o of terrain.oases) {
      const n = Math.floor(o.radius / 14);
      for (let p = 0; p < n; p++) {
        const ang = rng() * Math.PI * 2;
        const d = rng() * o.radius;
        const x = o.x + Math.cos(ang) * d, y = o.y + Math.sin(ang) * d;
        if (!decos.some(dd => Math.hypot(dd.x - x, dd.y - y) < 14)) {
          decos.push({ x, y, type: 'palm', size: 9 + rng() * 8, angle: rng() * Math.PI * 2 });
        }
      }
    }
  }
  return decos;
}

// ══════════════════════════════════════════════════════════════
//  BUILDING TEMPLATES
// ══════════════════════════════════════════════════════════════

const BUILDING_TEMPLATES = {
  hut:         { w: 20, d: 20, h: 10, col: '#a08050' },
  depot:       { w: 48, d: 32, h: 14, col: '#8a8a7a' },
  tower:       { w: 16, d: 16, h: 36, col: '#c0b898' },
  sandbag:     { w: 36, d: 36, h: 6,  col: '#b0a070' },
  crate_stack: { w: 16, d: 16, h: 8,  col: '#a08050' },
  bunker:      { w: 40, d: 40, h: 18, col: '#c0b898' },
  barracks:    { w: 56, d: 28, h: 12, col: '#c0b898' },
  garage:      { w: 44, d: 36, h: 16, col: '#8a8a7a' },
  fuel:        { w: 24, d: 24, h: 12, col: '#cc4433' },
  sam_site:    { w: 30, d: 30, h: 20, col: '#5a6a5a' },
  radar:       { w: 20, d: 20, h: 40, col: '#6a7a6a' },
};

export function getBuildingTemplate(type) {
  return BUILDING_TEMPLATES[type] || BUILDING_TEMPLATES.hut;
}

// ══════════════════════════════════════════════════════════════
//  SCENARIO LAYOUT
// ══════════════════════════════════════════════════════════════

function addScenarioBuilding(world, site, type, x, y, options = {}) {
  const tmpl = getBuildingTemplate(type);
  const id = `${site.id}-building-${String(site.buildings.length + 1).padStart(2, '0')}`;
  const building = {
    id,
    x, y, type,
    w: tmpl.w, d: tmpl.d, h: tmpl.h, col: tmpl.col,
    siteId: site.id,
    hp: options.hp || 80,
    maxHp: options.hp || 80,
    destructible: options.destructible !== false,
    objectiveTag: options.objectiveTag || null,
    special: options.special || null,
    highPriority: Boolean(options.highPriority),
    destroyed: false,
    flashTimer: 0,
  };
  site.buildings.push(building);
  world.buildings.push(building);
  return building;
}

function addRosterEnemy(site, className, rng, index, objectiveTarget = false) {
  const angle = rng() * Math.PI * 2;
  const dist = 30 + rng() * 80;
  site.enemies.push({
    id: `${site.id}-objective-${String(index).padStart(2, '0')}`,
    className,
    offsetX: Math.cos(angle) * dist,
    offsetY: Math.sin(angle) * dist,
    isIndoor: false,
    active: false,
    objectiveTarget,
  });
}

function makeExtraction() {
  // Extraction = leaving the map. No LZ point, no hold timer.
  return { active: false };
}

function chooseTargetSite(world, scenario, rng) {
  const candidates = world.sites.filter((site) => scenario.compatibleSites.includes(site.archetype));
  return pick(candidates.length > 0 ? candidates : world.sites, rng) || world.sites[0];
}

function applyContractPlan(world, contract) {
  if (!contract) return;

  const scenario = getScenario(contract.scenarioId);
  const style = getStyle(contract.styleId);
  const difficulty = getDifficulty(contract.difficultyId);
  const rng = mulberry32((contract.seed + 4100) >>> 0);
  const targetSite = chooseTargetSite(world, scenario, rng);
  const targetPoint = { x: targetSite.x, y: targetSite.y };
  const targetOffset = () => ({
    x: targetSite.x + (rng() - 0.5) * 34,
    y: targetSite.y + (rng() - 0.5) * 34,
  });

  world.contract = contract;
  world.objective = {
    type: contract.scenarioId,
    siteId: targetSite.id,
    targetId: null,
    targetIds: [],
    requiredCount: 0,
    progress: 0,
    complete: false,
  };

  if (contract.scenarioId === 'strike') {
    const p = targetOffset();
    const target = addScenarioBuilding(world, targetSite, 'bunker', p.x, p.y, {
      hp: Math.round(125 * difficulty.targetHpMultiplier),
      objectiveTag: 'command',
      highPriority: true,
    });
    world.objective.targetId = target.id;
    world.objective.target = target;
  } else if (contract.scenarioId === 'sabotage') {
    const p = targetOffset();
    const target = addScenarioBuilding(world, targetSite, 'radar', p.x, p.y, {
      hp: Math.round(75 * difficulty.targetHpMultiplier),
      objectiveTag: 'radar',
      special: 'radar',
      highPriority: true,
    });
    world.objective.targetId = target.id;
    world.objective.target = target;
  } else if (contract.scenarioId === 'intercept') {
    let convoy = world.convoys.find(c => !c.destroyed) || world.convoys[0];
    if (!convoy) {
      // Fallback: run the intercept along a real highway if one exists,
      // otherwise a straight line through the target site.
      const hw = world.roads.filter(r => r.hierarchy === 'highway' && r.points.length >= 6);
      let route;
      if (hw.length > 0) {
        const src = pick(hw, rng).points;
        route = densifyRoute(src.slice(Math.floor(src.length * 0.2), Math.floor(src.length * 0.8)), 55);
      } else {
        route = [{ x: -world.worldSize * 0.35, y: targetSite.y }, { x: world.worldSize * 0.35, y: targetSite.y }];
      }
      convoy = {
        id: 'convoy-01',
        route,
        routeCum: buildRouteCum(route),
        s: 60,
        direction: 1,
        composition: ['technical', 'rifleman', 'apc', 'rifleman'],
        x: route[0].x,
        y: route[0].y,
        angle: 0,
        speed: 30,
        active: false,
        hp: 160,
        maxHp: 160,
        fireCooldown: 0,
        flashTimer: 0,
        destroyed: false,
      };
      world.convoys.push(convoy);
    }
    convoy.objectiveTarget = true;
    convoy.hp = Math.round(100 * difficulty.targetHpMultiplier);
    convoy.maxHp = convoy.hp;
    convoy.siteId = targetSite.id;
    world.objective.targetId = convoy.id;
    world.objective.target = convoy;
  } else if (contract.scenarioId === 'suppression') {
    const classes = difficulty.rating >= 3 ? ['lightAA', 'shilka', 'lightAA'] : ['lightAA', 'lightAA', 'rpg'];
    for (let i = 0; i < classes.length; i++) {
      addRosterEnemy(targetSite, classes[i], rng, i + 1, true);
    }
    world.objective.requiredCount = classes.length;
  } else if (contract.scenarioId === 'recovery') {
    const p = targetOffset();
    const crate = {
      id: `crate-${String(Math.floor(rng() * 90) + 10)}`,
      x: p.x,
      y: p.y,
      siteId: targetSite.id,
      collected: false,
      objective: true,
      rewardType: pick(['repair', 'damage', 'speed', 'fear'], rng),
    };
    world.supplyCrates.push(crate);
    world.objective.targetId = crate.id;
    world.objective.target = crate;
  }

  // Every operation has a radar installation to make Heat controllable.
  const radarSite = world.sites.find((site) => site.id !== targetSite.id) || targetSite;
  const radarPoint = targetSite.id === radarSite.id ? targetOffset() : { x: radarSite.x, y: radarSite.y };
  const radar = addScenarioBuilding(world, radarSite, 'radar', radarPoint.x, radarPoint.y, {
    hp: Math.round(65 * difficulty.targetHpMultiplier),
    objectiveTag: 'radar',
    special: 'radar',
    highPriority: true,
  });
  world.radarSites.push(radar.id);

  // Supply is a deliberate opportunity, not a second currency.
  if (contract.scenarioId !== 'recovery' && rng() < style.supplyChance) {
    const supplySite = world.sites.find((site) => site.id !== targetSite.id) || targetSite;
    const p = { x: supplySite.x + (rng() - 0.5) * 50, y: supplySite.y + (rng() - 0.5) * 50 };
    world.supplyCrates.push({
      id: `crate-${String(Math.floor(rng() * 90) + 10)}`,
      x: p.x,
      y: p.y,
      siteId: supplySite.id,
      collected: false,
      objective: false,
      rewardType: pick(['repair', 'damage', 'speed', 'fear'], rng),
    });
  }

  world.objective.targetSiteId = targetSite.id;
  world.objective.targetSiteName = targetSite.name;
  world.extraction = makeExtraction();
  world.responsePlan = {
    heatGainMultiplier: style.heatGainMultiplier,
    hunterRateMultiplier: style.hunterRateMultiplier,
    enemyCountMultiplier: style.enemyCountMultiplier,
    difficulty,
    tierEvents: [
      { tier: 1, label: 'LOCAL SEARCH' },
      { tier: 2, label: 'GARRISON ALERT' },
      { tier: 3, label: 'COORDINATED RESPONSE' },
      { tier: 4, label: 'HUNTER DISPATCHED' },
    ],
  };
}

// ══════════════════════════════════════════════════════════════
//  FUEL DEPOTS — standalone timer-bonus targets (GDD: +20s per tank)
// ══════════════════════════════════════════════════════════════

function generateFuelDepots(seed, roads, sites, worldSize, rng) {
  const depots = [];
  const buildings = [];
  const candidates = [];
  // Sample drivable points off the paved/dirt network, away from sites.
  for (const road of roads) {
    if (road.hierarchy === 'local') continue;
    for (let i = 2; i < road.points.length - 2; i += 3) {
      candidates.push({ p: road.points[i], hierarchy: road.hierarchy });
    }
  }
  if (candidates.length === 0) return { depots, buildings };

  const want = randInt(3, 5, rng);
  let guard = 0;
  while (depots.length < want && guard++ < 200) {
    const cand = pick(candidates, rng);
    const x = cand.p.x + randFloat(-70, 70, rng);
    const y = cand.p.y + randFloat(-70, 70, rng);
    if (Math.abs(x) > worldSize * 0.45 || Math.abs(y) > worldSize * 0.45) continue;
    if (sites.some(s => Math.hypot(s.x - x, s.y - y) < 550)) continue;
    if (depots.some(d => Math.hypot(d.x - x, d.y - y) < 900)) continue;

    const id = `depot-${String(depots.length + 1).padStart(2, '0')}`;
    const tanks = randInt(2, 3);
    const depot = { id, x, y, tanks };
    depots.push(depot);

    // Fuel tanks + a watch tower + sandbag revetment.
    for (let t = 0; t < tanks; t++) {
      const ang = (t / tanks) * Math.PI * 2 + rng();
      buildings.push(makeFuelBuilding(
        `${id}-tank-${t + 1}`,
        x + Math.cos(ang) * 22, y + Math.sin(ang) * 22,
        'fuel', { depotId: id, hp: 15 }
      ));
    }
    buildings.push(makeFuelBuilding(
      `${id}-tower`, x + randFloat(-30, 30), y + randFloat(-30, 30),
      'tower', { depotId: id, hp: 20 }
    ));
    buildings.push(makeFuelBuilding(
      `${id}-bag`, x + randFloat(-30, 30), y + randFloat(-30, 30),
      'sandbag', { depotId: id, hp: 25 }
    ));
  }
  return { depots, buildings };
}

function makeFuelBuilding(id, x, y, type, opts = {}) {
  const tmpl = getBuildingTemplate(type);
  return {
    id, x, y, type,
    w: tmpl.w, d: tmpl.d, h: tmpl.h, col: tmpl.col,
    siteId: null,
    hp: opts.hp || 80,
    maxHp: opts.hp || 80,
    destructible: true,
    objectiveTag: null,
    special: type === 'fuel' ? 'fuel' : null,
    highPriority: false,
    depotId: opts.depotId || null,
    destroyed: false,
    flashTimer: 0,
  };
}

// ══════════════════════════════════════════════════════════════
//  FULL WORLD GENERATION
// ══════════════════════════════════════════════════════════════

export function generateWorld(input) {
  const context = typeof input === 'number' ? { seed: input } : (input || {});
  const seed = context.seed ?? context.rootSeed ?? 42;
  const worldSize = context.worldSize || WORLD_SIZE;
  const terrain = context.terrain || createTerrain(seed, worldSize);
  // Settlements are placed on geography first (water, confluences, high
  // ground, scatter) — then the road network connects them across terrain.
  const sites = generateSites(seed, [], worldSize, terrain);
  const roads = generateRoads(seed + 7, worldSize, terrain, sites);
  const decorations = generateDecorations(seed, worldSize, roads, sites, terrain);
  const convoys = generateConvoys(seed, roads, sites, worldSize);

  const buildings = [];
  for (const site of sites) {
    for (let i = 0; i < site.buildings.length; i++) {
      const b = site.buildings[i];
      const tmpl = getBuildingTemplate(b.type);
      b.id = `${site.id}-building-${String(i + 1).padStart(2, '0')}`;
      b.siteId = site.id;
      buildings.push({
        id: b.id,
        x: b.x, y: b.y, type: b.type,
        w: tmpl.w, d: tmpl.d, h: tmpl.h, col: tmpl.col,
        siteId: site.id,
        hp: b.hp || 0,
        maxHp: b.maxHp || 0,
        destructible: Boolean(b.destructible),
        objectiveTag: b.objectiveTag || null,
        special: b.special || null,
        highPriority: Boolean(b.highPriority),
        destroyed: false,
        flashTimer: 0,
      });
    }
  }

  // Fuel depots — standalone timer-bonus targets along the road network.
  const depotRng = mulberry32(seed + 5000);
  const { depots: fuelDepots, buildings: depotBuildings } =
    generateFuelDepots(seed + 5000, roads, sites, worldSize, depotRng);
  for (const db of depotBuildings) buildings.push(db);

  const world = {
    seed,
    worldSize,
    roads,
    sites,
    decorations,
    buildings,
    fuelDepots,
    convoys,
    supplyCrates: [],
    radarSites: [],
    objective: null,
    extraction: null,
    responsePlan: null,
    contract: context.contract || null,
  };

  applyContractPlan(world, context.contract);
  return world;
}
