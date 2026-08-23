/**
 * terrain.js — deterministic desert terrain model.
 *
 * This is the SINGLE SOURCE OF TRUTH for the world. Both the renderer
 * (app.js) and the world generator (world.js) query this same object, so
 * the landscape the player SEES is the same landscape that roads, oases,
 * and settlements are generated from. Layout and graphics are one system.
 *
 * Causal chain (top-down):
 *    tectonic skeleton (dip, basement highs, basin, escarpment)
 *      -> wadi drainage network (flows down-dip, meanders, confluences)
 *        -> oases (where wadis die / join, and at fan toes)
 *          -> settlement anchors + road corridors
 *
 * Everything is deterministic from `seed`. No state, no cache required:
 * elevation(x,y) and type(x,y) are pure functions over a small stored
 * vector skeleton, so the world is infinite-resolution and streamable.
 */

import { mulberry32, randInt, randFloat, pick, clamp, lerp } from './rng.js';
import { createNoise, fbm, ridged } from './noise.js';

// ─────────────────────────────────────────────────────────────────────────────
//  TERRAIN TYPE KEYS — shared with SURFACE/BIOME consumers
// ─────────────────────────────────────────────────────────────────────────────

export const TERRAIN_TYPES = {
  WADI: 'wadi',        // dry riverbed — lowest, sandy/gravel, vehicles slow
  OASIS: 'oasis',      // vegetated wet spot — settlement magnet
  SAND: 'sand',        // standard desert floor
  HARDPACK: 'hardpack',// compacted flat desert — fast travel
  GRAVEL: 'gravel',    // rocky piedmont / fan apron
  DUNES: 'dunes',      // soft rolling sand — slow travel
  ROCK: 'rock',        // mountain / escarpment / outcrop
};

// ─────────────────────────────────────────────────────────────────────────────
//  TECTONIC SKELETON
// ─────────────────────────────────────────────────────────────────────────────

function buildSkeleton(rng, half, worldSize) {
  // Regional structural dip — the direction water flows (unit vector).
  const dipAngle = rng() * Math.PI * 2;
  const dip = { x: Math.cos(dipAngle), y: Math.sin(dipAngle) };

  // Basement highs — resistant mountain cores. 2–4, spread around the map.
  const highs = [];
  const numHighs = randInt(2, 4, rng);
  const minSep = half * 0.5; // keep mountains apart so they don't stack
  for (let i = 0; i < numHighs; i++) {
    let placed = null;
    for (let attempt = 0; attempt < 20 && !placed; attempt++) {
      // Place highs toward the up-dip side so drainage runs across the map.
      const ang = dipAngle + Math.PI + (rng() - 0.5) * 1.6;
      const dist = half * (0.35 + rng() * 0.4);
      const cand = {
        x: Math.cos(ang) * dist,
        y: Math.sin(ang) * dist,
        peak: 700 + rng() * 1400,       // metres of prominence
        radius: 500 + rng() * 1000,     // footprint radius
      };
      const tooClose = highs.some(h => Math.hypot(h.x - cand.x, h.y - cand.y) < minSep);
      if (!tooClose) placed = cand;
    }
    if (placed) highs.push(placed);
  }

  // Basin low — depocenter DOWN-dip (in the flow direction), where wadis converge.
  const basin = {
    x: dip.x * half * 0.45,
    y: dip.y * half * 0.45,
    radius: 400 + rng() * 500,
  };

  // Escarpment — an optional long ridge line (Tuwaq-style barrier).
  // Runs roughly perpendicular to dip, partitioning the map.
  const escarpment = null; // TODO: port from Python geomorph when wiring roads

  return { dip, dipAngle, highs, basin, escarpment };
}

// ─────────────────────────────────────────────────────────────────────────────
//  WADI NETWORK — drainage flowing down-dip from highs toward the basin
// ─────────────────────────────────────────────────────────────────────────────

function traceWadi(start, dip, basin, half, rng, noise, maxLen) {
  const pts = [{ x: start.x, y: start.y }];
  let x = start.x, y = start.y;
  let len = 0;
  const step = 110;
  let phase = rng() * Math.PI * 2;

  while (len < maxLen) {
    // Flow direction: mostly down-dip, pulled toward the basin, meandering.
    const toBasinX = basin.x - x;
    const toBasinY = basin.y - y;
    const toBasinLen = Math.hypot(toBasinX, toBasinY) || 1;
    let dx = dip.x * 0.6 + (toBasinX / toBasinLen) * 0.4;
    let dy = dip.y * 0.6 + (toBasinY / toBasinLen) * 0.4;

    // Meander: wander perpendicular to flow, driven by noise.
    phase += 0.25 + noise(x * 0.0009, y * 0.0009) * 0.18;
    dx += Math.cos(phase) * 0.38;
    dy += Math.sin(phase) * 0.38;

    const dl = Math.hypot(dx, dy) || 1;
    x += (dx / dl) * step;
    y += (dy / dl) * step;

    pts.push({ x, y });
    len += step;

    if (Math.hypot(x - basin.x, y - basin.y) < 350) break;
    if (Math.abs(x) > half - 150 || Math.abs(y) > half - 150) break;
  }
  return pts;
}

function buildWadis(skeleton, half, rng, noise) {
  const wadis = [];
  const { dip, highs, basin } = skeleton;

  // Trunk wadis: 1–2 per high, flowing toward the basin.
  for (const high of highs) {
    const n = randInt(1, 2, rng);
    for (let i = 0; i < n; i++) {
      // Start near the high, offset to avoid all wadis overlapping.
      const start = {
        x: high.x + (rng() - 0.5) * high.radius,
        y: high.y + (rng() - 0.5) * high.radius,
      };
      const pts = traceWadi(start, dip, basin, half, rng, noise, 6000);
      if (pts.length >= 3) {
        wadis.push({ points: pts, order: 1, width: 90 + rng() * 60 });
      }
    }
  }

  // Tributaries: branch off existing trunks to densify the network.
  const trunkCount = wadis.length;
  for (let t = 0; t < trunkCount; t++) {
    const parent = wadis[t];
    const n = randInt(1, 2, rng);
    for (let i = 0; i < n; i++) {
      const idx = randInt(1, Math.max(2, parent.points.length - 2), rng);
      const start = { x: parent.points[idx].x, y: parent.points[idx].y };
      // Tributary flows with a slight offset from the parent's direction.
      const pts = traceWadi(start, dip, basin, half, rng, noise, 3000 + rng() * 2000);
      if (pts.length >= 3) {
        wadis.push({ points: pts, order: 2, width: 40 + rng() * 30 });
      }
    }
  }

  return wadis;
}

// ─────────────────────────────────────────────────────────────────────────────
//  OASES — where water concentrates (wadi termini, confluences, fan toes)
// ─────────────────────────────────────────────────────────────────────────────

function buildOases(wadis, skeleton, half, rng) {
  const oases = [];

  // Termini: end of each trunk wadi = terminal playa / oasis.
  for (const w of wadis) {
    if (w.order !== 1) continue;
    const end = w.points[w.points.length - 1];
    oases.push({ x: end.x, y: end.y, radius: 120 + rng() * 160, kind: 'terminus' });
  }

  // Mid-course oases: sparse points along trunks (well-watered stretches).
  for (const w of wadis) {
    if (w.order !== 1) continue;
    if (rng() < 0.6) {
      const idx = randInt(2, w.points.length - 2, rng);
      const p = w.points[idx];
      oases.push({ x: p.x, y: p.y, radius: 80 + rng() * 120, kind: 'midcourse' });
    }
  }

  return oases;
}

// ─────────────────────────────────────────────────────────────────────────────
//  TERRAIN MODEL
// ─────────────────────────────────────────────────────────────────────────────

export function createTerrain(seed, worldSize = 6000) {
  const rng = mulberry32(seed >>> 0);
  const noise = createNoise(seed);
  const half = worldSize / 2;

  const skeleton = buildSkeleton(rng, half, worldSize);
  const wadis = buildWadis(skeleton, half, rng, noise);
  const oases = buildOases(wadis, skeleton, half, rng);

  // Precompute segment lists for fast distance queries.
  const wadiSegs = [];
  for (const w of wadis) {
    for (let i = 0; i < w.points.length - 1; i++) {
      wadiSegs.push({ a: w.points[i], b: w.points[i + 1], order: w.order, width: w.width });
    }
  }

  // Distance from (x,y) to nearest wadi centerline (returns {dist, order}).
  function nearestWadi(x, y) {
    let best = Infinity;
    let bestOrder = 0;
    for (const s of wadiSegs) {
      const dx = s.b.x - s.a.x;
      const dy = s.b.y - s.a.y;
      const l2 = dx * dx + dy * dy;
      let t = l2 === 0 ? 0 : ((x - s.a.x) * dx + (y - s.a.y) * dy) / l2;
      t = clamp(t, 0, 1);
      const px = s.a.x + t * dx;
      const py = s.a.y + t * dy;
      const d = Math.hypot(x - px, y - py);
      if (d < best) { best = d; bestOrder = s.order; }
    }
    return { dist: best, order: bestOrder };
  }

  // Distance from (x,y) to nearest oasis.
  function nearestOasis(x, y) {
    let best = Infinity;
    for (const o of oases) {
      const d = Math.hypot(x - o.x, y - o.y);
      if (d < best) best = d;
    }
    return best;
  }

  // ── Structural elevation (metres) without noise detail ──
  function structuralElevation(x, y) {
    let e = 0;

    // Basement highs: gaussian falloff mountains.
    for (const h of skeleton.highs) {
      const d = Math.hypot(x - h.x, y - h.y);
      const s = d / (h.radius * 1.4);
      e += h.peak * Math.exp(-s * s);
    }

    // Regional dip: gentle tilt down toward the basin side.
    e += (x * skeleton.dip.x + y * skeleton.dip.y) * 0.06;

    return e;
  }

  // ── Full elevation with wadi carving + noise detail ──
  function elevation(x, y) {
    let e = structuralElevation(x, y);

    // Wadi carving: depressed channel with soft banks.
    const nw = nearestWadi(x, y);
    const wadiReach = nw.order === 1 ? 400 : 200;
    if (nw.dist < wadiReach) {
      const carve = (1 - nw.dist / wadiReach) * (nw.order === 1 ? 160 : 90);
      e -= carve;
    }

    // Basin low: subtle sag.
    const bd = Math.hypot(x - skeleton.basin.x, y - skeleton.basin.y);
    const basinT = bd / (skeleton.basin.radius * 2);
    e -= 120 * Math.exp(-(basinT * basinT));

    // Noise detail: small-scale relief (dunes, undulations).
    e += fbm(noise, x * 0.0011, y * 0.0011, 4, 2.0, 0.5) * 90;

    return e;
  }

  // ── Terrain classification ──
  function type(x, y) {
    // Water features first (they override everything).
    const no = nearestOasis(x, y);
    if (no < 130) return TERRAIN_TYPES.OASIS;

    const nw = nearestWadi(x, y);
    const wadiHalfWidth = nw.order === 1 ? 130 : 70;
    if (nw.dist < wadiHalfWidth) return TERRAIN_TYPES.WADI;

    const e = elevation(x, y);

    // Mountains.
    if (e > 620) return TERRAIN_TYPES.ROCK;

    // Dune belts (wind-driven noise) at mid elevations.
    if (e > 250 && e < 560) {
      const dn = ridged(noise, x * 0.0008, y * 0.0008, 3, 2.0, 0.5);
      if (dn > 0.25) return TERRAIN_TYPES.DUNES;
    }

    // Low & dry -> gravel fan apron; low & wet -> hardpack.
    if (e < 120) {
      const moist = fbm(noise, x * 0.0009 + 100, y * 0.0009 + 100, 3, 2.0, 0.5);
      return moist > 0.15 ? TERRAIN_TYPES.HARDPACK : TERRAIN_TYPES.GRAVEL;
    }

    return TERRAIN_TYPES.SAND;
  }

  // ── Settlement suitability — for world-gen site placement ──
  // High near water, moderate elevation, on stable ground.
  function suitability(x, y) {
    const no = nearestOasis(x, y);
    const nw = nearestWadi(x, y);
    const e = elevation(x, y);

    let s = 0;
    // Water proximity (dominant driver in a desert).
    const water = Math.min(no, nw.dist);
    s += Math.exp(-water / 900) * 1.0;
    // Avoid mountains and wadi floors (flood risk), prefer gentle rises.
    if (e > 500) s -= 0.5;
    if (e < 30) s -= 0.3;
    // Oases are ideal.
    if (no < 260) s += 0.6;
    return s;
  }

  return {
    seed,
    worldSize,
    half,
    // geographic skeleton (for world-gen)
    dip: skeleton.dip,
    highs: skeleton.highs,
    basin: skeleton.basin,
    escarpment: skeleton.escarpment,
    wadis,
    oases,
    // pure query functions (for renderer + world-gen)
    elevation,
    structuralElevation,
    type,
    suitability,
    nearestWadi,
    nearestOasis,
  };
}
