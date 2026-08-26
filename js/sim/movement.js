/**
 * sim/movement.js — road-aware movement helpers.
 * Extracted from app.js so the sim tick can be tested without canvas.
 * All functions are pure over (world, terrain, position) — no globals.
 */

import { clamp } from '../rng.js';

// Cached road segment list keyed by world instance
const roadCache = new WeakMap();

function getRoadSegs(world) {
  if (!world || !world.roads) return null;
  let cached = roadCache.get(world);
  if (cached) return cached;
  const segs = [];
  for (const road of world.roads) {
    for (let i = 0; i < road.points.length - 1; i++) {
      segs.push({ ax: road.points[i].x, ay: road.points[i].y, bx: road.points[i + 1].x, by: road.points[i + 1].y });
    }
  }
  roadCache.set(world, segs);
  return segs;
}

/** Nearest point on the road network within maxDist, else null. */
export function nearestRoadPoint(world, x, y, maxDist) {
  const segs = getRoadSegs(world);
  if (!segs || segs.length === 0) return null;
  let bd = maxDist * maxDist;
  let best = null;
  for (const s of segs) {
    const dx = s.bx - s.ax, dy = s.by - s.ay;
    const l2 = dx * dx + dy * dy || 1e-6;
    let t = ((x - s.ax) * dx + (y - s.ay) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = s.ax + t * dx, py = s.ay + t * dy;
    const ddx = x - px, ddy = y - py;
    const d2 = ddx * ddx + ddy * ddy;
    if (d2 < bd) {
      bd = d2;
      best = { x: px, y: py, ang: Math.atan2(dy, dx), dist: Math.sqrt(d2) };
    }
  }
  return best;
}

/** Blend a desired heading toward the nearest road. Returns { angle, dist }. */
export function steerAlongRoads(world, desiredAngle, x, y) {
  const rp = nearestRoadPoint(world, x, y, 320);
  if (!rp) return { angle: desiredAngle, dist: Infinity };
  let roadAng = rp.ang;
  const diffA = Math.abs(Math.atan2(Math.sin(rp.ang - desiredAngle), Math.cos(rp.ang - desiredAngle)));
  const diffB = Math.abs(Math.atan2(Math.sin(rp.ang + Math.PI - desiredAngle), Math.cos(rp.ang + Math.PI - desiredAngle)));
  if (diffB < diffA) roadAng = rp.ang + Math.PI;
  const w = Math.max(0, 1 - rp.dist / 320);
  let diff = roadAng - desiredAngle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return { angle: desiredAngle + diff * w, dist: rp.dist };
}

export const TERRAIN_VEHICLE_SPEED = {
  hardpack: 1.1,
  sand: 1.0,
  gravel: 0.95,
  wadi: 0.9,
  oasis: 0.7,
  dunes: 0.6,
  rock: 0.5,
};

/** Terrain + road speed factor for a ground vehicle at (x,y). */
export function vehicleSpeedFactor(world, terrain, x, y) {
  let f = 1.0;
  if (terrain) {
    const ty = terrain.type(x, y);
    f *= TERRAIN_VEHICLE_SPEED[ty] || 1.0;
  }
  const rp = nearestRoadPoint(world, x, y, 120);
  if (rp) f *= 1.2;
  return f;
}

// ── Convoy path mechanics ──

export const CONVOY_GAP_VEH = 30, CONVOY_GAP_INF = 17;

/** Position + tangent at distance s along a convoy's route. */
export function pointAlongRoute(convoy, s) {
  const pts = convoy.route, cum = convoy.routeCum;
  const total = cum[cum.length - 1];
  s = ((s % total) + total) % total;
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < s) lo = mid + 1; else hi = mid;
  }
  const i = Math.max(0, lo - 1);
  const segLen = cum[i + 1] - cum[i] || 1e-6;
  const t = (s - cum[i]) / segLen;
  const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, ang: Math.atan2(b.y - a.y, b.x - a.x) };
}

/** All members of a convoy in world space (lead first). */
export function getConvoyMembers(convoy) {
  const out = [];
  let offset = 0;
  for (let i = 0; i < (convoy.composition || []).length; i++) {
    const cls = convoy.composition[i];
    const isVeh = cls === 'technical' || cls === 'apc' || cls === 'shilka' || cls === 'sam';
    offset += isVeh ? CONVOY_GAP_VEH : CONVOY_GAP_INF;
    const dirSign = convoy.direction >= 0 ? 1 : -1;
    const p = pointAlongRoute(convoy, convoy.s - offset * dirSign);
    out.push({ x: p.x, y: p.y, angle: p.ang + (dirSign < 0 ? Math.PI : 0), isVeh, cls });
  }
  return out;
}

export function clearRoadCache(world) {
  if (world) roadCache.delete(world);
}
