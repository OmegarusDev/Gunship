// Sortie smoke test — headless verification of the win/extraction path.
//
// Drives the *mission-assembly + completion* logic (the pure, browser-free
// seams) for every contract scenario, mirroring the exact completion and
// extraction guards used by the real sortie tick (app.js:1764 checkObjectiveProgress
// and app.js:1816 updateExtraction). Also exercises the career meta pipeline
// (XP / dollars / level / KIA / skill application) that the debrief consumes.
//
// Run:  node tools/sortie-smoke.mjs
//
// NOTE: This validates data-level completability and the meta loop. Full
// pixel-level combat driving would require extracting the sim into js/sim/
// and running app.js with a canvas stub — out of scope here.

import { generateWorld } from '../js/world.js';
import { SCENARIOS, getStyle, getDifficulty } from '../js/contracts.js';
import {
  createCareer, commitSortieOutcome, applyCareerToHeli, gainXp, aggregateModifiers,
} from '../js/meta.js';
import { WORLD_SIZE } from '../js/config.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; fails.push(msg); }
}

// ── mirrors of the real in-tick guards ──────────────────────────────────────
function isAlive(t) {
  if (!t) return false;
  if (t.destroyed !== undefined) return !t.destroyed;
  if (t.state !== undefined) return t.state !== 'dead';
  return true;
}
function objectiveComplete(world) {
  const o = world.objective;
  if (!o) return false;
  if (o.type === 'suppression') {
    let dead = 0;
    for (const s of world.sites) for (const e of (s.enemies || [])) {
      if (e.objectiveTarget && e.state === 'dead') dead++;
    }
    return dead >= (o.requiredCount || 0);
  }
  if (o.type === 'recovery') return Boolean(o.target && o.target.collected);
  return Boolean(o.target && !isAlive(o.target));
}
function canExtract(world, heli) {
  const lim = WORLD_SIZE * 0.48;
  return Boolean(world.extraction && world.extraction.active)
    && objectiveComplete(world)
    && (Math.abs(heli.x) > lim || Math.abs(heli.y) > lim);
}
function baseHeli() {
  return {
    x: 0, y: 0, hp: 100, maxHp: 100,
    bulletDamage: 8, fireRate: 0.15, bulletSpeed: 500, weaponRange: 350,
    accel: 1400, maxSpeed: 400,
  };
}

// ── 1. Mission assembly + completability for every scenario ─────────────────
const STYLE = 'precision_strike';
const DIFF = 'standard';
let scenarioCount = 0;

for (const scenarioId of Object.keys(SCENARIOS)) {
  scenarioCount++;
  // a few seeds to shake out placement-dependent soft-locks
  for (const seed of [1000, 2000, 3000]) {
    const contract = { scenarioId, styleId: STYLE, difficultyId: DIFF, seed };
    const world = generateWorld({ seed, contract });

    ok(world.objective && world.objective.type === scenarioId,
      `[${scenarioId}/${seed}] objective built`);
    ok(world.extraction != null,
      `[${scenarioId}/${seed}] extraction flag present`);
    ok((world.radarSites || []).length >= 1,
      `[${scenarioId}/${seed}] radar installation present`);

    if (scenarioId === 'strike' || scenarioId === 'sabotage') {
      const t = world.objective.target;
      const inWorld = world.buildings.some(b => b.id === t.id);
      ok(t && t.destructible && t.hp > 0 && inWorld,
        `[${scenarioId}/${seed}] target building exists & destructible`);
    } else if (scenarioId === 'intercept') {
      const t = world.objective.target;
      ok(t && t.objectiveTarget === true && Array.isArray(t.route) && t.route.length,
        `[${scenarioId}/${seed}] target convoy exists & routable`);
    } else if (scenarioId === 'suppression') {
      let n = 0;
      for (const s of world.sites) for (const e of (s.enemies || [])) if (e.objectiveTarget) n++;
      ok(n >= (world.objective.requiredCount || 0) && n > 0,
        `[${scenarioId}/${seed}] ${n} air-defense targets >= required ${world.objective.requiredCount}`);
    } else if (scenarioId === 'recovery') {
      ok(world.supplyCrates.some(c => c.objective === true),
        `[${scenarioId}/${seed}] objective supply cache exists`);
    }

    // simulate the pilot completing the op, then assert the win path is reachable
    if (scenarioId === 'strike' || scenarioId === 'sabotage') {
      world.objective.target.destroyed = true;
    } else if (scenarioId === 'intercept') {
      world.objective.target.destroyed = true;
    } else if (scenarioId === 'suppression') {
      for (const s of world.sites) for (const e of (s.enemies || [])) if (e.objectiveTarget) e.state = 'dead';
    } else if (scenarioId === 'recovery') {
      const crate = world.supplyCrates.find(c => c.objective === true);
      if (crate) crate.collected = true;
    }
    ok(objectiveComplete(world),
      `[${scenarioId}/${seed}] objective reaches completion state`);

    // extraction becomes available once objective done, and is geometrically reachable
    world.extraction.active = true;
    const heli = baseHeli();
    heli.x = WORLD_SIZE * 0.48 + 50; // crossed the map edge
    ok(canExtract(world, heli),
      `[${scenarioId}/${seed}] extraction reachable at map edge`);
  }
}
ok(scenarioCount === Object.keys(SCENARIOS).length, 'all scenarios covered');

// ── 2. Career meta pipeline (what the debrief consumes) ─────────────────────
const career = createCareer(12345);
ok(career.pilot.level === 1 && career.dollars === 0 && career.pilot.skillPoints === 0,
  'fresh career starts at level 1, 0 dollars, 0 SP');

// a completed sortie banks XP + dollars (on a pilot below the level cap)
const d0 = career.dollars, xp0 = career.pilot.xp;
const res = commitSortieOutcome(career, 'complete', 200, 500);
ok(!res.died && career.dollars === d0 + 500 && career.pilot.xp > xp0,
  'completed sortie banks dollars + XP');

// levelling grants skill points (fresh pilot so the cap isn't hit)
const cLvl = createCareer(54321);
const before = cLvl.pilot.level;
const lv = gainXp(cLvl.pilot, 5000);
ok(lv > 0 && cLvl.pilot.level > before && cLvl.pilot.skillPoints >= lv,
  `gainXp grants ${lv} level(s) and ${cLvl.pilot.skillPoints} SP`);

// at the level-10 cap, XP is intentionally no longer banked
const capped = createCareer(13579);
gainXp(capped.pilot, 99999);
const xpCap = capped.pilot.xp;
gainXp(capped.pilot, 200);
ok(capped.pilot.level === 10 && capped.pilot.xp === xpCap,
  'level-10 cap stops further XP accrual (by design)');

// KIA path assigns a new pilot but still banks dollars
const oldPilot = career.pilot;
const d1 = career.dollars;
const res2 = commitSortieOutcome(career, 'failed', 0, 300);
ok(res2.died && career.pilot !== oldPilot && career.dollars === d1 + 300,
  'KIA assigns new pilot, still banks dollars');

// skill nodes actually modify the helicopter (meta -> sortie wiring)
const c2 = createCareer(999);
c2.pilot.allocated = ['marksman', 'turbo'];
const m = aggregateModifiers(c2.pilot, c2.hangar);
ok(m.dmgMult > 1 && m.maxSpeedMult > 1, 'skill nodes boost damage + speed modifiers');

const heliPlain = baseHeli();
applyCareerToHeli(heliPlain, c2.pilot, c2.hangar);
ok(heliPlain.bulletDamage > 0 && heliPlain.maxHp > 0 && typeof heliPlain.critChance === 'number',
  'applyCareerToHeli writes combat fields onto the heli');

const heliNoSkill = baseHeli();
const c3 = createCareer(998);
applyCareerToHeli(heliNoSkill, c3.pilot, c3.hangar);
ok(heliPlain.bulletDamage > heliNoSkill.bulletDamage,
  'marksman raises bulletDamage vs unallocated pilot');

// ── 3. Report ───────────────────────────────────────────────────────────────
console.log(`\nSortie smoke test: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of fails) console.log('  FAIL:', f);
  process.exit(1);
} else {
  console.log('All sortie/extraction + meta checks passed — no soft-locks detected.');
}
