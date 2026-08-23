/**
 * World generation — terrain, roads, villages, decorations, enemy rosters.
 * Roads are real entities with surface properties.
 * Villages are first-class objects with archetypes and enemy garrisons.
 */

import { WORLD_SIZE } from './config.js';
import { getDifficulty, getScenario, getStyle } from './contracts.js';
import { mulberry32, randInt, randFloat, pick, clamp, weightedPick } from './rng.js';

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
//  DELAUNAY TRIANGULATION
// ══════════════════════════════════════════════════════════════

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
//  ROAD GENERATION — with surface properties
// ══════════════════════════════════════════════════════════════

export function generateRoads(seed, worldSize) {
  const rng = mulberry32(seed);
  const roads = [];
  const halfW = worldSize * 0.45;

  const numCenters = randInt(5, 9, rng);
  const centers = [];
  for (let i = 0; i < numCenters; i++) {
    centers.push({
      x: randFloat(-halfW, halfW, rng),
      y: randFloat(-halfW, halfW, rng),
    });
  }

  const triangles = delaunay(centers);
  const edges = triangulationEdges(triangles);

  // Highways (paved)
  for (const [a, b] of edges) {
    const edgeLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (edgeLen > worldSize * 0.7) continue;
    roads.push({
      points: bezierRoad(a, b, rng, 6),
      width: randFloat(24, 34, rng),
      surface: 'paved',
      hierarchy: 'highway',
    });
  }

  // Secondary roads (dirt)
  for (let i = 0; i < randInt(12, 20, rng); i++) {
    if (roads.length === 0) break;
    const parent = pick(roads, rng);
    if (!parent || parent.points.length < 2) continue;
    const idx = randInt(0, parent.points.length - 2, rng);
    const p1 = parent.points[idx], p2 = parent.points[idx + 1];
    const t = rng();
    const start = { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
    const parentAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const growAngle = parentAngle + (rng() > 0.5 ? 1 : -1) * (0.6 + rng() * 1.2);
    const pts = growthRoad(start, growAngle, worldSize, roads, rng, 0.08);
    if (pts.length >= 3) {
      roads.push({ points: pts, width: randFloat(14, 22, rng), surface: 'dirt', hierarchy: 'secondary' });
    }
  }

  // Local tracks (track)
  for (let i = 0; i < randInt(15, 25, rng); i++) {
    if (roads.length === 0) break;
    const parent = pick(roads, rng);
    if (!parent || parent.points.length < 2) continue;
    const idx = randInt(0, parent.points.length - 2, rng);
    const p1 = parent.points[idx], p2 = parent.points[idx + 1];
    const t = rng();
    const start = { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
    const parentAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const growAngle = parentAngle + (rng() > 0.5 ? 1 : -1) * (0.4 + rng() * 2.0);
    const pts = growthRoad(start, growAngle, worldSize, roads, rng, 0.04);
    if (pts.length >= 2) {
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

export function generateSites(seed, roads, worldSize) {
  const rng = mulberry32(seed + 1000);
  const sites = [];

  // Find highway junctions
  const junctionCandidates = [];
  for (let i = 0; i < roads.length; i++) {
    if (roads[i].hierarchy !== 'highway') continue;
    for (let j = i + 1; j < roads.length; j++) {
      if (roads[j].hierarchy !== 'highway') continue;
      for (const p1 of roads[i].points) {
        for (const p2 of roads[j].points) {
          if (Math.hypot(p1.x - p2.x, p1.y - p2.y) < 200) {
            junctionCandidates.push({ x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 });
          }
        }
      }
    }
  }

  // Random population centers
  const centers = [];
  for (let i = 0; i < 6; i++) {
    centers.push({ x: (rng() - 0.5) * worldSize * 0.7, y: (rng() - 0.5) * worldSize * 0.7 });
  }

  // Merge and deduplicate
  const allCandidates = [...junctionCandidates, ...centers];
  const placed = [];
  for (const c of allCandidates) {
    if (placed.some(p => Math.hypot(c.x - p.x, c.y - p.y) < 300)) continue;
    placed.push(c);
  }

  // Assign archetypes based on distance from center (GDD rules)
  for (const pos of placed) {
    if (sites.length >= 14) break;
    const dist = Math.hypot(pos.x, pos.y);
    const distFrac = dist / (worldSize * 0.45); // 0 at center, 1 at edge

    // Archetype selection based on distance
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
      buildings,
      enemies: allEnemies,
      name: generateVillageName(rng),
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

function generateVillageName(rng) {
  const prefixes = ['Al', 'Tell', 'Khan', 'Ras', 'Ain', 'Wadi', 'Djebla', 'El'];
  const bases = ['Rashid', 'Kuwait', 'Basra', 'Fallujah', 'Ramadi', 'Hillah', 'Nasiriyah', 'Samarra'];
  return `${pick(prefixes, rng)} ${pick(bases, rng)}`;
}

// ══════════════════════════════════════════════════════════════
//  PATROL CONVOYS — follow road graph between villages
// ══════════════════════════════════════════════════════════════

export function generateConvoys(seed, roads, sites, worldSize) {
  const rng = mulberry32(seed + 3000);
  const convoys = [];

  // Build a simplified road graph: nodes are road endpoints, edges are road segments
  // Convoys pick a highway, follow it, then branch to a secondary road
  const highways = roads.filter(r => r.hierarchy === 'highway');
  if (highways.length === 0) return convoys;

  const numConvoys = randInt(2, 4, rng);

  for (let i = 0; i < numConvoys; i++) {
    const road = pick(highways, rng);
    if (!road || road.points.length < 4) continue;

    // Pick a direction (forward or backward along road)
    const forward = rng() > 0.5;
    const points = forward ? road.points : [...road.points].reverse();

    // Create a patrol route: loop along this road
    const routeLen = Math.min(points.length, randInt(4, 8, rng));
    const startIdx = randInt(0, points.length - routeLen, rng);
    const route = [];
    for (let j = 0; j < routeLen; j++) {
      route.push(points[startIdx + j]);
    }

    // Composition: mix of vehicles and infantry
    const composition = [];
    const numVehicles = randInt(1, 3, rng);
    for (let v = 0; v < numVehicles; v++) {
      composition.push(pick(['technical', 'apc', 'shilka'], rng));
    }
    const numInfantry = randInt(2, 6, rng);
    for (let inf = 0; inf < numInfantry; inf++) {
      composition.push(pick(['rifleman', 'assault', 'rpg'], rng));
    }

    convoys.push({
      id: `convoy-${String(i + 1).padStart(2, '0')}`,
      route,
      routeIndex: 0,
      composition,
      x: route[0].x,
      y: route[0].y,
      speed: 25 + rng() * 15, // units per second
      active: false,
      hp: 100,
      maxHp: 100,
      destroyed: false,
    });
  }

  return convoys;
}

// ══════════════════════════════════════════════════════════════
//  DECORATIONS
// ══════════════════════════════════════════════════════════════

export function generateDecorations(seed, worldSize, roads, villages) {
  const rng = mulberry32(seed + 2000);
  const decos = [];
  const numDecos = Math.floor(worldSize * worldSize * 0.00005);

  for (let i = 0; i < numDecos; i++) {
    const x = (rng() - 0.5) * worldSize * 0.95;
    const y = (rng() - 0.5) * worldSize * 0.95;
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
    const typeRoll = rng();
    let type, size;
    if (typeRoll < 0.25) { type = 'bush'; size = 3 + rng() * 6; }
    else if (typeRoll < 0.45) { type = 'rock'; size = 4 + rng() * 10; }
    else if (typeRoll < 0.55) { type = 'palm'; size = 8 + rng() * 6; }
    else if (typeRoll < 0.60) { type = 'crater'; size = 10 + rng() * 20; }
    else continue;
    decos.push({ x, y, type, size, angle: rng() * Math.PI * 2 });
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

function makeExtraction(world, target, style) {
  const targetAngle = Math.atan2(target.y, target.x);
  const distance = world.worldSize * 0.34 * style.extractionDistanceMultiplier;
  const angle = targetAngle + Math.PI;
  return {
    x: clamp(Math.cos(angle) * distance, -world.worldSize * 0.44, world.worldSize * 0.44),
    y: clamp(Math.sin(angle) * distance, -world.worldSize * 0.44, world.worldSize * 0.44),
    radius: 42,
    holdTime: 1.25,
    active: false,
    progress: 0,
  };
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
    let convoy = world.convoys[0];
    if (!convoy) {
      convoy = {
        id: 'convoy-01',
        route: [{ x: -world.worldSize * 0.35, y: targetSite.y }, { x: world.worldSize * 0.35, y: targetSite.y }],
        routeIndex: 0,
        x: -world.worldSize * 0.35,
        y: targetSite.y,
        speed: 30,
        active: false,
        hp: 100,
        maxHp: 100,
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
  world.extraction = makeExtraction(world, targetPoint, style);
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
//  FULL WORLD GENERATION
// ══════════════════════════════════════════════════════════════

export function generateWorld(input) {
  const context = typeof input === 'number' ? { seed: input } : (input || {});
  const seed = context.seed ?? context.rootSeed ?? 42;
  const worldSize = context.worldSize || WORLD_SIZE;
  const roads = generateRoads(seed, worldSize);
  const sites = generateSites(seed, roads, worldSize);
  const decorations = generateDecorations(seed, worldSize, roads, sites);
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

  const world = {
    seed,
    worldSize,
    roads,
    sites,
    decorations,
    buildings,
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
