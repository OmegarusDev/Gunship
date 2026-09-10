/**
 * Shared lock / aim resolution. Every shootable thing (enemy, vehicle,
 * emplacement, convoy, building, crate) goes through the same live-object
 * checks so we never lock a roster stub or a place centroid.
 */
export function isRosterStub(target) {
  if (!target) return false;
  if (target.maxHp !== undefined || target.category) return false;
  if (target.destructible !== undefined || Array.isArray(target.route)) return false;
  if (target.collected !== undefined) return false;
  return target.state !== undefined && Boolean(target.className || target.encounterId);
}

export function isLockable(target) {
  if (!target) return false;
  if (isRosterStub(target)) return false;
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return false;
  if (target.spawned !== undefined) return Boolean(target.spawned) && target.state !== 'dead';
  if (target.state !== undefined) {
    return target.state !== 'dead' && target.className !== 'unarmed';
  }
  if (target.collected !== undefined) return !target.collected;
  if (target.destroyed) return false;
  if (target.destructible !== undefined) return Boolean(target.destructible);
  if (Array.isArray(target.route)) return true;
  return target.hp === undefined || target.hp > 0;
}

export function sameTarget(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return Boolean(a.id && b.id && a.id === b.id);
}

export function resolveLiveTarget(world, enemies, boss, target) {
  if (!target) return null;
  if (target === boss || (boss && target.id && target.id === boss.id)) {
    return boss?.spawned && boss.state !== 'dead' ? boss : null;
  }
  if (isRosterStub(target) || (target.state !== undefined && target.maxHp === undefined)) {
    const live = (enemies || []).find((enemy) => enemy.id && enemy.id === target.id);
    return isLockable(live) ? live : null;
  }
  if (target.state !== undefined) return isLockable(target) ? target : null;
  if (target.destructible !== undefined) {
    const building = (world?.buildings || []).find((item) => item === target || item.id === target.id) || target;
    return isLockable(building) ? building : null;
  }
  if (Array.isArray(target.route)) {
    const convoy = (world?.convoys || []).find((item) => item === target || item.id === target.id) || target;
    return isLockable(convoy) ? convoy : null;
  }
  if (target.collected !== undefined) {
    const crate = (world?.supplyCrates || []).find((item) => item === target || item.id === target.id) || target;
    return isLockable(crate) ? crate : null;
  }
  return isLockable(target) ? target : null;
}

export function resolveObjectiveAim(world, enemies, boss, heli) {
  const obj = world?.objective;
  if (!obj) return null;
  const markedIds = new Set(obj.targetIds || []);
  if (obj.target?.id) markedIds.add(obj.target.id);
  if (obj.type === 'suppression' || markedIds.size) {
    let best = null;
    let bestD = Infinity;
    const hx = heli?.x || 0;
    const hy = heli?.y || 0;
    for (const enemy of enemies || []) {
      if (!isLockable(enemy)) continue;
      const marked = enemy.objectiveTarget || markedIds.has(enemy.id);
      if (!marked) continue;
      const dist = Math.hypot(enemy.x - hx, enemy.y - hy);
      if (dist < bestD) {
        bestD = dist;
        best = enemy;
      }
    }
    if (best) return best;
  }
  if (obj.type === 'recovery') {
    return resolveLiveTarget(world, enemies, boss, obj.target);
  }
  return resolveLiveTarget(world, enemies, boss, obj.target);
}

export function aimRadius(target) {
  if (!target) return 20;
  if (target.w && target.d) return Math.max(target.w, target.d) * 0.7 + 18;
  if (target.size) return Math.max(18, target.size * 3.2);
  if (Array.isArray(target.route)) return 28;
  return 22;
}

function pushUnique(list, seen, target) {
  if (!target || seen.has(target)) return;
  seen.add(target);
  list.push(target);
}

export function collectAimables(world, enemies, boss, mode = 'closest') {
  const out = [];
  const seen = new Set();
  if (boss?.spawned && isLockable(boss)) pushUnique(out, seen, boss);
  for (const enemy of enemies || []) {
    if (!isLockable(enemy)) continue;
    const cat = enemy.category;
    if (mode === 'infrastructure') {
      if (cat === 'emplacement' || cat === 'vehicle') pushUnique(out, seen, enemy);
    } else {
      pushUnique(out, seen, enemy);
    }
  }
  if (mode === 'infrastructure') {
    for (const building of world?.buildings || []) {
      if (isLockable(building)) pushUnique(out, seen, building);
    }
  }
  if (mode === 'infrastructure' || mode === 'closest' || mode === 'strongest') {
    for (const convoy of world?.convoys || []) {
      if (convoy.destroyed) continue;
      if (!convoy.active && mode !== 'closest') continue;
      pushUnique(out, seen, convoy);
    }
  }
  return out;
}

function scoreCandidate(candidate, heli, mode, objective) {
  const dist = Math.hypot(candidate.x - heli.x, candidate.y - heli.y);
  if (dist > heli.weaponRange) return Infinity;
  let value = dist;
  if (mode === 'strongest') {
    const dps = (candidate.damage || 0) / Math.max(0.2, candidate.fireRate || 1);
    value = -(dps + (candidate.range || 0) * 0.03);
  }
  if (objective && sameTarget(candidate, objective)) value -= 400;
  return value;
}

export function pickAutoTarget({ world, enemies, boss, heli, mode, manualTarget }) {
  const liveManual = resolveLiveTarget(world, enemies, boss, manualTarget);
  if (liveManual && isLockable(liveManual)) return liveManual;
  const objective = resolveObjectiveAim(world, enemies, boss, heli);
  const modeKey = mode || 'closest';
  const candidates = collectAimables(world, enemies, boss, modeKey);
  if (objective) {
    const seen = new Set(candidates);
    if (!seen.has(objective)) candidates.push(objective);
  }
  let best = null;
  let bestValue = Infinity;
  for (const candidate of candidates) {
    if (!isLockable(candidate)) continue;
    const value = scoreCandidate(candidate, heli, modeKey, objective);
    if (value < bestValue) {
      bestValue = value;
      best = candidate;
    }
  }
  return best;
}

export function pickClickedTarget(world, enemies, boss, worldPos, opts = {}) {
  const extra = opts.extra || [];
  const convoyMembers = opts.convoyMembers;
  const seen = new Set();
  const candidates = [];
  for (const target of [
    ...collectAimables(world, enemies, boss, 'closest'),
    ...collectAimables(world, enemies, boss, 'infrastructure'),
    ...extra,
  ]) {
    pushUnique(candidates, seen, target);
  }
  let best = null;
  let bestDist = 72;
  for (const candidate of candidates) {
    if (!isLockable(candidate)) continue;
    const dist = Math.hypot(candidate.x - worldPos.x, candidate.y - worldPos.y);
    const radius = aimRadius(candidate);
    if (dist <= radius && dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  for (const convoy of world?.convoys || []) {
    if (convoy.destroyed) continue;
    const members = convoyMembers ? convoyMembers(convoy) : [{ x: convoy.x, y: convoy.y, isVeh: true }];
    for (const member of members) {
      const dist = Math.hypot(member.x - worldPos.x, member.y - worldPos.y);
      const radius = member.isVeh ? 26 : 20;
      if (dist <= radius && dist < bestDist) {
        bestDist = dist;
        best = convoy;
      }
    }
  }
  return best;
}
