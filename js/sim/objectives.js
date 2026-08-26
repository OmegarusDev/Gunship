/**
 * sim/objectives.js — objective predicates & extraction helpers.
 * Pure over world/boss/enemies — no DOM, no canvas. Shared by app.js and tools/.
 */
import { WORLD_SIZE } from '../config.js';

export function isAlive(target) {
  if (!target) return false;
  if (target.destroyed !== undefined) return !target.destroyed;
  if (target.state !== undefined) return target.state !== 'dead';
  if (target.collected !== undefined) return !target.collected;
  return target.hp === undefined || target.hp > 0;
}

export function isTargetAlive(world, boss, target) {
  if (!target) return false;
  if (target === boss) return Boolean(boss?.spawned) && boss.state !== 'dead';
  if (target.state !== undefined) return target.state !== 'dead';
  if (target.collected || target.destroyed) return false;
  return target.hp === undefined || target.hp > 0;
}

export function objectiveComplete(world, enemies = []) {
  const o = world?.objective;
  if (!o) return false;
  if (o.type === 'suppression') {
    let dead = 0;
    const pools = enemies.length ? enemies : [];
    // also check site rosters that may not yet be spawned
    if (pools.length === 0 && world.sites) {
      for (const s of world.sites) for (const e of (s.enemies || [])) if (e.objectiveTarget && e.state === 'dead') dead++;
    } else {
      for (const e of pools) if (e.objectiveTarget && e.state === 'dead') dead++;
    }
    return dead >= (o.requiredCount || 0);
  }
  if (o.type === 'recovery') return Boolean(o.target && o.target.collected);
  return Boolean(o.target && !isAlive(o.target));
}

export function canExtract(world, heli) {
  const lim = WORLD_SIZE * 0.48;
  return Boolean(world?.extraction?.active)
    && objectiveComplete(world)
    && (Math.abs(heli.x) > lim || Math.abs(heli.y) > lim);
}

export function getObjectiveFocus(world, boss, enemies, heli) {
  const obj = world?.objective;
  if (!obj) return null;
  if (obj.type === 'suppression') {
    let best = null, bestD = Infinity;
    for (const e of enemies) {
      if (!e.objectiveTarget || e.state === 'dead') continue;
      const d = Math.hypot(e.x - heli.x, e.y - heli.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best ? { x: best.x, y: best.y } : null;
  }
  const t = obj.target;
  if (!t || !isTargetAlive(world, boss, t) || t === boss) return null;
  return { x: t.x, y: t.y };
}

export function nearestExitPoint(heli) {
  const lim = WORLD_SIZE * 0.48;
  const dL = heli.x + lim, dR = lim - heli.x;
  const dT = heli.y + lim, dB = lim - heli.y;
  const m = Math.min(dL, dR, dT, dB);
  let x = Math.max(-lim, Math.min(lim, heli.x));
  let y = Math.max(-lim, Math.min(lim, heli.y));
  if (m === dL) x = -lim; else if (m === dR) x = lim; else if (m === dT) y = -lim; else y = lim;
  const card = m === dT ? 'N' : m === dR ? 'E' : m === dB ? 'S' : 'W';
  return { x, y, card };
}

export function objectiveHudText(world) {
  if (!world?.objective) return 'STANDBY';
  if (world.objective.type === 'strike') return `DESTROY ${world.objective.targetSiteName || 'COMMAND TARGET'}`;
  if (world.objective.type === 'sabotage') return `DISABLE ${world.objective.targetSiteName || 'RADAR RELAY'}`;
  if (world.objective.type === 'intercept') return 'INTERCEPT SUPPLY CONVOY';
  if (world.objective.type === 'suppression') return 'DESTROY AIR DEFENSE UNITS';
  if (world.objective.type === 'recovery') return 'RECOVER SUPPLY CACHE';
  return 'COMPLETE OPERATION';
}

export function hunterClockRate(sortieState, activeContract) {
  // Re-export for convenience; actual impl lives in state.js to avoid circular
  const { getDifficulty, getStyle } = { getDifficulty: null, getStyle: null };
  void getDifficulty; void getStyle;
  return 1;
}
