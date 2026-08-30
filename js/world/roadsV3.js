/**
 * roadsV3.js — immersive, terrain-following road network for WORLD_GEN 3
 * Roads are primary: they exist to connect buildings across the landscape.
 * Highways follow hardpack/wadi corridors, secondaries branch to settlements,
 * local streets are the settlement itself.
 * Deterministic from seed via mulberry32.
 */

import { mulberry32, randInt, randFloat, pick, clamp } from '../rng.js';
import { getTerrainGrid, leastCostPath } from './roadsUtil.js'; // will be created or use existing

// For now, we will implement a simple but more organic road network
// that is distinct from the MST blobs.

export function generateRoadsV3(seed, worldSize, terrain, sites) {
  const rng = mulberry32(seed);
  const roads = [];
  const grid = getTerrainGrid(terrain, worldSize);

  // 1. Primary highways: 2-3 long least-cost paths that traverse the map
  // Pick 3-4 anchor points on map edges + oases/highs, then connect them
  const anchors = [];
  // Add map edge points
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + randFloat(-0.2, 0.2, rng);
    const r = worldSize * 0.45;
    anchors.push({
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
    });
  }
  // Add oases and highs as anchors
  if (terrain) {
    for (const o of terrain.oases.slice(0, 3)) {
      anchors.push({ x: o.x, y: o.y });
    }
    for (const h of terrain.highs.slice(0, 2)) {
      // Place anchor near but not on the peak
      const ang = rng() * Math.PI * 2;
      const dist = h.radius * 0.7;
      anchors.push({ x: h.x + Math.cos(ang) * dist, y: h.y + Math.sin(ang) * dist });
    }
  }

  // Create highways between anchors in order around the map
  anchors.sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const b = anchors[(i + 1) % anchors.length];
    // Only connect if not too far and not crossing too much
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > worldSize * 0.8) continue;
    if (rng() < 0.3) continue; // skip some for more organic
    const path = leastCostPath(a.x, a.y, b.x, b.y, grid);
    if (path && path.length >= 3) {
      // Add some meandering by perturbing the path
      for (const p of path) {
        p.x += (rng() - 0.5) * 12;
        p.y += (rng() - 0.5) * 12;
      }
      roads.push({
        points: path,
        width: randFloat(28, 36, rng),
        surface: 'paved',
        hierarchy: 'highway',
      });
    }
  }

  // 2. Secondary roads: connect each site to the nearest highway with a dirt track
  for (const site of sites) {
    // Find nearest highway point
    let best = null, bestDist = Infinity;
    let bestRoad = null;
    for (const road of roads) {
      if (road.hierarchy !== 'highway') continue;
      for (const p of road.points) {
        const d = Math.hypot(p.x - site.x, p.y - site.y);
        if (d < bestDist) { bestDist = d; best = p; bestRoad = road; }
      }
    }
    if (!best || bestDist > 800) continue;
    // Create a dirt track from site to highway, following terrain
    const path = leastCostPath(site.x, site.y, best.x, best.y, grid);
    if (path && path.length >= 2) {
      // Simplify and add organic wobble
      for (const p of path) {
        p.x += (rng() - 0.5) * 8;
        p.y += (rng() - 0.5) * 8;
      }
      roads.push({
        points: path,
        width: randFloat(16, 22, rng),
        surface: 'dirt',
        hierarchy: 'secondary',
      });
    }
  }

  // 3. Local streets: within each site, create a small street grid
  // This is where villages become *made of* streets
  for (const site of sites) {
    const spread = site.archetype === 'base' ? 140 : site.archetype === 'town' ? 110 : site.archetype === 'camp' ? 90 : 70;
    const half = spread / 2;
    const bbox = { x0: site.x - half, y0: site.y - half, x1: site.x + half, y1: site.y + half };

    // For rural: single track with 1-2 buildings along it
    if (site.archetype === 'rural') {
      const angle = rng() * Math.PI;
      const len = spread * 0.8;
      const dx = Math.cos(angle) * len / 2;
      const dy = Math.sin(angle) * len / 2;
      const p1 = { x: site.x - dx, y: site.y - dy };
      const p2 = { x: site.x + dx, y: site.y + dy };
      roads.push({
        points: [p1, { x: site.x, y: site.y }, p2],
        width: 8,
        surface: 'track',
        hierarchy: 'local',
      });
    } else if (site.archetype === 'town') {
      // Town: 2x2 grid of local streets
      const pad = 12;
      const xSteps = [bbox.x0 + pad, site.x, bbox.x1 - pad];
      const ySteps = [bbox.y0 + pad, site.y, bbox.y1 - pad];
      // Horizontal streets
      for (const y of ySteps) {
        roads.push({
          points: [{ x: bbox.x0 + pad, y }, { x: bbox.x1 - pad, y }],
          width: 10,
          surface: 'dirt',
          hierarchy: 'local',
        });
      }
      // Vertical streets
      for (const x of xSteps) {
        roads.push({
          points: [{ x, y: bbox.y0 + pad }, { x, y: bbox.y1 - pad }],
          width: 10,
          surface: 'dirt',
          hierarchy: 'local',
        });
      }
    } else if (site.archetype === 'camp' || site.archetype === 'base') {
      // Military: perimeter + internal grid, with walls (visualized as road with dirt + wall deco)
      const pad = 10;
      const corners = [
        { x: bbox.x0 + pad, y: bbox.y0 + pad },
        { x: bbox.x1 - pad, y: bbox.y0 + pad },
        { x: bbox.x1 - pad, y: bbox.y1 - pad },
        { x: bbox.x0 + pad, y: bbox.y1 - pad },
      ];
      // Perimeter (will get wall later)
      for (let i = 0; i < 4; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % 4];
        roads.push({
          points: [a, b],
          width: 12,
          surface: 'dirt',
          hierarchy: 'perimeter',
        });
      }
      // Internal grid
      if (site.archetype === 'base') {
        // Base: 3x3 grid inside
        const step = spread / 3;
        for (let i = 1; i < 3; i++) {
          const x = bbox.x0 + step * i;
          const y = bbox.y0 + step * i;
          roads.push({
            points: [{ x, y: bbox.y0 + pad }, { x, y: bbox.y1 - pad }],
            width: 8,
            surface: 'dirt',
            hierarchy: 'local',
          });
          roads.push({
            points: [{ x: bbox.x0 + pad, y }, { x: bbox.x1 - pad, y }],
            width: 8,
            surface: 'dirt',
            hierarchy: 'local',
          });
        }
      } else {
        // Camp: central street
        roads.push({
          points: [{ x: bbox.x0 + pad, y: site.y }, { x: bbox.x1 - pad, y: site.y }],
          width: 9,
          surface: 'dirt',
          hierarchy: 'local',
        });
      }
    }
  }

  return roads;
}
