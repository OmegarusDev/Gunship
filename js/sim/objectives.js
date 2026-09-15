/**
 * sim/objectives.js — objective predicates & extraction helpers.
 * Pure over world/boss/enemies — no DOM, no canvas. Shared by app.js and tools/.
 */
import { WORLD_SIZE } from '../config.js';
import { isRosterStub, resolveLiveTarget, resolveObjectiveAim } from './targeting.js';

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

export function objectiveComplete(world, enemies = []) {
  const o = world?.objective;
  if (!o) return false;
  if (!intelProgress(world).complete || !o.revealed) return false;
  if (o.type === 'suppression') {
    let dead = 0;
    const pools = enemies.length ? enemies : [];
    if (pools.length === 0 && world.encounters) {
      for (const encounter of world.encounters)
        for (const entry of encounter.roster || [])
          if (entry.objectiveTarget && entry.state === 'dead') dead++;
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
  return (
    Boolean(world?.extraction?.active) &&
    objectiveComplete(world) &&
    (Math.abs(heli.x) > lim || Math.abs(heli.y) > lim)
  );
}

export function getObjectiveFocus(world, boss, enemies, heli) {
  const intel = intelProgress(world);
  if (!intel.complete) {
    const next = (world.objective?.intel?.holders || []).find(
      (h) => !h.destroyed && !h.intelTaken && h.state !== 'dead'
    );
    if (next) return { x: next.x, y: next.y };
  }
  const aim = resolveObjectiveAim(world, enemies, boss, heli);
  if (!aim || aim === boss) return null;
  if (aim.objectiveHidden) return null;
  return { x: aim.x, y: aim.y };
}

export function nearestExitPoint(heli) {
  const lim = WORLD_SIZE * 0.48;
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
  return { x, y, card };
}

export function objectiveHudText(world, { objectiveComplete: done } = {}) {
  if (!world?.objective) return 'STANDBY';
  if (done) return 'RTB — CROSS THE BORDER TO EXTRACT';
  const intel = intelProgress(world);
  if (!intel.complete) {
    return `SECURE INTEL  ${intel.secured}/${intel.required}`;
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
