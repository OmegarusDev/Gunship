/**
 * sim/objectives.js — objective predicates & extraction helpers.
 * Pure over world/boss/enemies — no DOM, no canvas. Shared by app.js and tools/.
 */
import { playableLimit } from '../config.js';
import { isRosterStub, resolveLiveTarget, resolveObjectiveAim } from './targeting.js';
import { placeKindLabel } from './flavor.js';

export function isAlive(target) {
  if (!target) return false;
  if (isRosterStub(target)) return false;
  if (target.destroyed !== undefined) return !target.destroyed;
  if (target.state !== undefined) return target.state !== 'dead';
  if (target.collected !== undefined) return !target.collected;
  return target.hp === undefined || target.hp > 0;
}

export function isTargetAlive(world, boss, target, enemies = []) {
  if (!target) return false;
  if (target === boss) return Boolean(boss?.spawned) && boss.state !== 'dead';
  const live = resolveLiveTarget(world, enemies, boss, target);
  if (live) return true;
  if (isRosterStub(target)) return false;
  if (target.state !== undefined) return target.state !== 'dead';
  if (target.collected || target.destroyed) return false;
  return target.hp === undefined || target.hp > 0;
}

export function intelProgress(world) {
  const intel = world?.objective?.intel;
  if (!intel) return { required: 0, secured: 0, complete: true };
  const holders = intel.holders || [];
  const secured = holders.filter(
    (h) => h.destroyed || h.collected || h.state === 'dead' || h.intelTaken
  ).length;
  const required = intel.required || 0;
  return { required, secured, complete: required <= 0 || secured >= required };
}

/** Persist a kill onto the worldgen roster so suppression still counts after corpses despawn. */
export function syncRosterDeath(world, enemy) {
  if (!world || !enemy?.id) return;
  for (const encounter of world.encounters || []) {
    const entry = (encounter.roster || []).find((item) => item.id === enemy.id);
    if (!entry) continue;
    entry.state = 'dead';
    entry.destroyed = true;
    return;
  }
}

export function suppressionProgress(world, enemies = []) {
  const seen = new Set();
  let dead = 0;
  const note = (id, isDead) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    if (isDead) dead++;
  };
  for (const enemy of enemies) {
    if (enemy?.objectiveTarget) note(enemy.id, enemy.state === 'dead');
  }
  for (const encounter of world?.encounters || []) {
    for (const entry of encounter.roster || []) {
      if (entry.objectiveTarget) note(entry.id, entry.state === 'dead' || entry.destroyed);
    }
  }
  const required = world?.objective?.requiredCount || 0;
  return { dead, required, complete: required > 0 && dead >= required };
}

export function objectiveComplete(world, enemies = []) {
  const o = world?.objective;
  if (!o) return false;
  if (!intelProgress(world).complete || !o.revealed) return false;
  if (o.type === 'suppression') return suppressionProgress(world, enemies).complete;
  if (o.type === 'recovery') {
    const crate =
      (world.supplyCrates || []).find((c) => c.objective || c.id === o.targetId) || o.target;
    return Boolean(crate?.collected);
  }
  return Boolean(o.target && !isAlive(o.target));
}

export function canExtract(world, heli, enemies = []) {
  if (!heli) return false;
  const done = Boolean(world?.objective?.complete) || objectiveComplete(world, enemies);
  if (!done && !world?.extraction?.active) return false;
  const lim = playableLimit(world);
  return Math.abs(heli.x) >= lim || Math.abs(heli.y) >= lim;
}

function holderPlace(world, holder) {
  if (!holder?.placeId) return null;
  return (world?.places || []).find((place) => place.id === holder.placeId) || null;
}

export function getObjectiveFocus(world, boss, enemies, heli) {
  const intel = intelProgress(world);
  if (!intel.complete) {
    const holders = (world.objective?.intel?.holders || []).filter(
      (h) => !h.destroyed && !h.intelTaken && h.state !== 'dead'
    );
    if (!holders.length) return null;
    const hx = heli?.x || 0;
    const hy = heli?.y || 0;
    const withPlace = holders.map((holder) => ({ holder, place: holderPlace(world, holder) }));
    const local = withPlace.filter((item) => item.place?.discovered);
    const pool = local.length ? local : withPlace;
    let best = null;
    let bestD = Infinity;
    for (const item of pool) {
      const coarse = !item.place?.discovered;
      const x = coarse ? (item.place?.x ?? item.holder.x) : item.holder.x;
      const y = coarse ? (item.place?.y ?? item.holder.y) : item.holder.y;
      const dist = Math.hypot(x - hx, y - hy);
      if (dist < bestD) {
        bestD = dist;
        best = {
          x,
          y,
          coarse,
          label: coarse ? placeKindLabel(item.place) : 'INTEL',
        };
      }
    }
    return best;
  }
  const aim = resolveObjectiveAim(world, enemies, boss, heli);
  if (!aim || aim === boss) return null;
  if (aim.objectiveHidden) return null;
  return { x: aim.x, y: aim.y, coarse: false, label: null };
}

function snapToPlayableEdge(x, y, lim) {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax < 1e-6 && ay < 1e-6) return { x: 0, y: -lim, card: 'N' };
  if (ax >= ay) {
    return {
      x: x >= 0 ? lim : -lim,
      y: (y / ax) * lim,
      card: x >= 0 ? 'E' : 'W',
    };
  }
  return {
    x: (x / ay) * lim,
    y: y >= 0 ? lim : -lim,
    card: y >= 0 ? 'N' : 'S',
  };
}

export function nearestExitPoint(heli, world) {
  const lim = playableLimit(world);
  let best = null;
  for (const gate of world?.gateways || []) {
    if (!Number.isFinite(gate.x) || !Number.isFinite(gate.y)) continue;
    const edge = snapToPlayableEdge(gate.x, gate.y, lim);
    const d = Math.hypot(edge.x - heli.x, edge.y - heli.y);
    if (!best || d < best.d) best = { ...edge, d, highway: true };
  }
  if (best) return { x: best.x, y: best.y, card: best.card, highway: true };
  const dL = heli.x + lim,
    dR = lim - heli.x;
  const dT = heli.y + lim,
    dB = lim - heli.y;
  const m = Math.min(dL, dR, dT, dB);
  let x = Math.max(-lim, Math.min(lim, heli.x));
  let y = Math.max(-lim, Math.min(lim, heli.y));
  if (m === dL) x = -lim;
  else if (m === dR) x = lim;
  else if (m === dT) y = -lim;
  else y = lim;
  const card = m === dT ? 'N' : m === dR ? 'E' : m === dB ? 'S' : 'W';
  return { x, y, card, highway: false };
}

export function objectiveHudText(world, { objectiveComplete: done } = {}) {
  if (!world?.objective) return 'STANDBY';
  if (done) return 'RTB — HIGHWAY TO THE BORDER';
  const intel = intelProgress(world);
  if (!intel.complete) {
    return `RECON  ${intel.secured}/${intel.required}  ·  SEARCH MILITARY SITES`;
  }
  if (world.objective.type === 'strike')
    return `DESTROY ${world.objective.targetPlaceName || 'COMMAND TARGET'}`;
  if (world.objective.type === 'sabotage')
    return `DISABLE ${world.objective.targetPlaceName || 'RADAR RELAY'}`;
  if (world.objective.type === 'intercept') return 'INTERCEPT SUPPLY CONVOY';
  if (world.objective.type === 'suppression') return 'DESTROY AIR DEFENSE UNITS';
  if (world.objective.type === 'recovery') return 'RECOVER SUPPLY CACHE';
  return 'COMPLETE OPERATION';
}

export function hunterClockRate(sortieState, activeContract) {
  // Re-export for convenience; actual impl lives in state.js to avoid circular
  const { getDifficulty, getStyle } = { getDifficulty: null, getStyle: null };
  void getDifficulty;
  void getStyle;
  return 1;
}
