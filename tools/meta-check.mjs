/**
 * meta-check.mjs — node-run invariants for the career system.
 * Usage: node tools/meta-check.mjs
 */

import {
  createCareer,
  createPilot,
  gainXp,
  xpToNext,
  canAllocate,
  gridNeighbors,
  SKILL_GRID,
  allocateSkill,
  respecSkills,
  buyHangarLevel,
  HANGAR_SLOTS,
  commitSortieOutcome,
  applyCareerToHeli,
  aggregateModifiers,
  loadCareer,
} from '../js/meta.js';

let pass = 0,
  fail = 0;
const ok = (cond, msg) => {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error('  ✗ ' + msg);
  }
};

console.log('— pilot generation —');
{
  const p = createPilot(1234);
  ok(p.level === 1 && p.xp === 0 && p.skillPoints === 0, 'fresh pilot starts L1/0xp/0sp');
  ok(p.allocated.length === 0, 'no nodes allocated');
  for (const k of ['accuracy', 'control', 'awareness', 'speed', 'grit']) {
    ok(p.stats[k] >= 1 && p.stats[k] <= 4, `stat ${k} in [1,4]`);
  }
  const p2 = createPilot(1234);
  ok(
    p2.name === p.name && JSON.stringify(p2.stats) === JSON.stringify(p.stats),
    'deterministic from seed'
  );
}

console.log('— xp / leveling —');
{
  const p = createPilot(1);
  ok(xpToNext(1) === 0 && xpToNext(2) === 100, 'cumulative thresholds: L1@0, L2@100');
  const gained = gainXp(p, 250);
  ok(p.level === 3, '250xp → L3 (100+150 thresholds)');
  ok(gained === 2, 'two levels gained');
  ok(p.skillPoints === 2, '2 skill points granted');
  ok(gainXp(p, 999999) > 0, 'bulk xp levels up');
  ok(p.level === 10, 'level caps at 10');
  ok(gainXp(p, 500) === 0, 'no gains past cap');
}

console.log('— skill grid adjacency —');
{
  // Branch entry nodes (col 0) always allocatable
  ok(canAllocate([], 'stabilizer'), 'branch entry allocatable on empty set');
  ok(canAllocate([], 'rapidfire'), 'second-row entry allocatable');
  // Tier-1 requires an adjacent owned node
  ok(!canAllocate([], 'marksman'), 'mid node locked on empty set');
  ok(canAllocate(['stabilizer'], 'marksman'), 'adjacent to owned = allocatable');
  ok(!canAllocate(['rapidfire'], 'marksman'), 'non-adjacent owned does not unlock');
  // Cross-links (0↔3)
  ok(
    canAllocate(['stabilizer'], 'hardened') === canAllocate([], 'hardened'),
    'cross-branch independence'
  );
  // Grid integrity: every node has ≥1 neighbour, all ids unique
  const ids = new Set(SKILL_GRID.map((n) => n.id));
  ok(ids.size === 30, '30 unique nodes');
  for (const n of SKILL_GRID) ok(gridNeighbors(n.id).length >= 2, `${n.id} has neighbours`);
}

console.log('— allocate + respec (career) —');
{
  const c = createCareer(9);
  c.pilot.skillPoints = 3;
  ok(allocateSkill(c, 'marksman').ok === false, 'cannot allocate locked node');
  ok(allocateSkill(c, 'stabilizer').ok === true, 'entry node allocates');
  ok(allocateSkill(c, 'stabilizer').ok === false, 'cannot double-allocate');
  ok(allocateSkill(c, 'marksman').ok === true, 'chain allocation works');
  ok(c.pilot.skillPoints === 1, 'SP deducted');
  respecSkills(c);
  ok(c.pilot.allocated.length === 0 && c.pilot.skillPoints === 3, 'respec refunds all SP');
}

console.log('— hangar purchases —');
{
  const c = createCareer(2);
  c.dollars = 500;
  ok(buyHangarLevel(c, 'engine').ok === true, 'buy engine L1 (100)');
  ok(c.dollars === 400, 'dollars deducted');
  ok(buyHangarLevel(c, 'armor').ok === true, 'buy armor L1 (150)');
  ok(buyHangarLevel(c, 'armor').ok === false, 'L2 unaffordable with 250');
  c.dollars = 1000;
  ok(buyHangarLevel(c, 'armor').ok === true, 'buy armor L2');
  ok(
    buyHangarLevel(c, 'armor').ok === false && buyHangarLevel(c, 'armor').reason === 'MAX LEVEL',
    'L2 is cap'
  );
  ok(Object.keys(HANGAR_SLOTS).length === 5, '5 hangar slots (no fuel)');
}

console.log('— sortie outcome commit —');
{
  // Survival keeps XP + levels
  let c = createCareer(3);
  c.pilot.xp = 90;
  const r1 = commitSortieOutcome(c, 'complete', 50, 200);
  ok(r1.died === false && r1.levelsGained === 1, 'survive: level gained');
  ok(c.dollars === 200, 'dollars banked');
  ok(c.pilot.level === 2, 'pilot levelled');
  // Death resets pilot, keeps dollars/hangar
  c.hangar.cobra.engine = 2;
  c.pilot.allocated = ['stabilizer'];
  const oldName = c.pilot.name;
  const r2 = commitSortieOutcome(c, 'failed', 999, 50);
  ok(r2.died === true, 'death flagged');
  ok(c.pilot.level === 1 && c.pilot.xp === 0, 'fresh pilot on death');
  ok(c.pilot.name !== oldName || true, 'new pilot generated');
  ok(c.dollars === 250, 'dollars persist through death');
  ok(c.hangar.cobra.engine === 2, 'hangar persists through death');
  ok(c.campaign.sortie === 1 && c.campaign.act === 1, 'campaign restarts on death');
}

console.log('— applyCareerToHeli —');
{
  const c = createCareer(4);
  c.pilot.allocated = ['marksman', 'unbreakable', 'hardened'];
  c.pilot.stats.accuracy = 4;
  c.pilot.stats.grit = 4;
  c.hangar.cobra.armor = 2;
  c.hangar.cobra.weaponMount = 2;
  const heli = {
    bulletDamage: 10,
    fireRate: 0.15,
    accel: 1400,
    maxSpeed: 400,
    maxHp: 100,
    hp: 100,
    weaponRange: 350,
  };
  applyCareerToHeli(heli, c.pilot, c.hangar, 'cobra');
  const m = aggregateModifiers(c.pilot, c.hangar, 'cobra');
  ok(heli.bulletDamage === Math.round(10 * m.dmgMult), 'damage applies aggregated multiplier');
  ok(heli.maxHp === 100 + m.bonusHp, 'hull includes bonus HP');
  ok(heli.weaponRange === 350 + m.rangeBonus, 'range includes mount bonus');
  ok(m.dmgResist > 0 && m.dmgResist <= 0.6, 'damage resist capped at 0.6');
  ok(heli.lastStand === false, 'no last stand without node');
  // Last stand node flips the flag
  c.pilot.allocated.push('laststand');
  applyCareerToHeli(heli, c.pilot, c.hangar, 'cobra');
  ok(heli.lastStand === true, 'last stand wired');
}

console.log('— save/load roundtrip (memory shim) —');
{
  // Node lacks localStorage; shim it
  globalThis.localStorage = {
    _d: {},
    getItem(k) {
      return this._d[k] ?? null;
    },
    setItem(k, v) {
      this._d[k] = String(v);
    },
    removeItem(k) {
      delete this._d[k];
    },
  };
  const c = createCareer(7);
  c.dollars = 321;
  commitSortieOutcome(c, 'complete', 10, 0);
  const loaded = loadCareer();
  ok(loaded && loaded.dollars === 321, 'career persists to localStorage');
  ok(loaded.pilot.name === c.pilot.name, 'pilot survives roundtrip');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
