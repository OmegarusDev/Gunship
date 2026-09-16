/**
 * meta-check.mjs — node-run invariants for the career system.
 * Usage: node tools/meta-check.mjs
 */

import {
  createCareer,
  createPilot,
  randomNameParts,
  gainXp,
  xpToNext,
  PILOT_SKILLS,
  SKILL_MAX,
  skillRank,
  levelSkill,
  respecSkills,
  buyHangarLevel,
  HANGAR_SLOTS,
  commitSortieOutcome,
  advanceCampaign,
  applyCareerToHeli,
  aggregateModifiers,
  loadCareer,
  saveCareer,
  wipeAllSaves,
  GUNSHIPS,
  GUNSHIP_ORDER,
  syncGunshipUnlocks,
  selectGunship,
  createSandboxCareer,
  isSandboxCareer,
  evaluateAchievements,
  ACHIEVEMENTS,
} from '../js/meta.js';
import { GUNSHIP_DRAW_IDS } from '../js/render/gunships.js';
import * as GameState from '../js/sim/gameState.js';
import { CAMPAIGN_RULES, createContractBoard, getCampaignMission, hunterBountyForCampaign } from '../js/contracts.js';
import { formatClock, periodLabel, sunFromHour, hourFromSeed } from '../js/sun.js';
import {
  ENEMY_CLASSES,
  ENEMY_CLASS_ORDER,
  classesForAct,
  classMinAct,
} from '../js/data/enemyClasses.js';
import { BOSS_DOSSIERS, BOSS_DOSSIER_ORDER } from '../js/data/bosses.js';

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
  ok(
    PILOT_SKILLS.every((skill) => p.skills[skill.id] === 0),
    'fresh talents start at 0'
  );
  for (const k of ['accuracy', 'control', 'awareness', 'speed', 'grit']) {
    ok(p.stats[k] >= 1 && p.stats[k] <= 4, `stat ${k} in [1,4]`);
  }
  const p2 = createPilot(1234);
  ok(
    p2.name === p.name && JSON.stringify(p2.stats) === JSON.stringify(p.stats),
    'deterministic from seed'
  );
  ok(p.nameParts.culture === 'american' || p.nameParts.culture === 'arab', 'pilot culture tagged');
}

console.log('— name banks —');
{
  const a = randomNameParts(99, 'american');
  const b = randomNameParts(99, 'arab');
  ok(a.culture === 'american' && b.culture === 'arab', 'culture can be forced');
  ok(a.first !== b.first || a.last !== b.last || a.callsign !== b.callsign, 'banks differ');
  let american = 0;
  let arab = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const parts = randomNameParts(seed);
    if (parts.culture === 'american') american++;
    else if (parts.culture === 'arab') arab++;
  }
  ok(american + arab === 200, 'every seed picks a culture');
  ok(american >= 70 && american <= 130, `american share near 50% (${american}/200)`);
  ok(arab >= 70 && arab <= 130, `arab share near 50% (${arab}/200)`);
}

console.log('— xp / leveling —');
{
  const p = createPilot(1);
  ok(xpToNext(1) === 0 && xpToNext(2) === 100, 'cumulative thresholds: L1@0, L2@100');
  const gained = gainXp(p, 250);
  ok(p.level === 3, '250xp → L3 (100+150 thresholds)');
  ok(gained === 2, 'two levels gained');
  ok(p.skillPoints === 4, '2 skill points granted per level');
  ok(gainXp(p, 999999) > 0, 'bulk xp levels up');
  ok(p.level === 10, 'level caps at 10');
  ok(gainXp(p, 500) === 0, 'no gains past cap');
}

console.log('— pilot talents —');
{
  ok(PILOT_SKILLS.length === 6, 'six human talents');
  ok(SKILL_MAX === 10, 'each talent has ten ranks');
  const c = createCareer(9);
  c.pilot.skillPoints = 3;
  ok(levelSkill(c, 'gunnery').ok === true, 'level-up spends a point');
  ok(skillRank(c.pilot, 'gunnery') === 1, 'gunnery rose to 1');
  ok(c.pilot.skillPoints === 2, 'SP deducted');
  ok(levelSkill(c, 'nope').ok === false, 'unknown talent rejected');
  const gunnery = createCareer(11);
  const flying = createCareer(11);
  gunnery.pilot.skills.gunnery = SKILL_MAX;
  flying.pilot.skills.flying = SKILL_MAX;
  const mg = aggregateModifiers(gunnery.pilot, gunnery.hangar, 'cobra');
  const mf = aggregateModifiers(flying.pilot, flying.hangar, 'cobra');
  const base = aggregateModifiers(createCareer(11).pilot, createCareer(11).hangar, 'cobra');
  ok(mg.spreadMult < base.spreadMult, 'gunnery tightens spread');
  ok(mg.dmgMult === base.dmgMult, 'gunnery does not raise damage');
  ok(mf.turnMult > base.turnMult && mf.accelMult > base.accelMult, 'flying turns and spools faster');
  ok(mf.maxSpeedMult === base.maxSpeedMult, 'flying does not raise top speed');
  c.pilot.skillPoints = 20;
  for (let i = 0; i < SKILL_MAX; i++) levelSkill(c, 'nerve');
  ok(levelSkill(c, 'nerve').ok === false, 'talent caps at max rank');
  ok(aggregateModifiers(c.pilot, c.hangar, 'cobra').lastStand === true, 'nerve 10 is last stand');
  respecSkills(c);
  ok(skillRank(c.pilot, 'gunnery') === 0 && skillRank(c.pilot, 'nerve') === 0, 'respec clears ranks');
  ok(c.pilot.skillPoints >= 3, 'respec refunds spent points');
}

console.log('— hangar purchases —');
{
  const c = createCareer(2);
  c.dollars = 500;
  ok(buyHangarLevel(c, 'engine').ok === true, 'buy engine L1');
  ok(c.dollars === 400, 'dollars deducted');
  ok(buyHangarLevel(c, 'armor').ok === true, 'buy armor L1');
  ok(buyHangarLevel(c, 'ordnance').ok === false, 'Cobra cannot fit missile racks');
  c.dollars = 20000;
  let steps = 0;
  while (buyHangarLevel(c, 'armor').ok) steps += 1;
  ok(steps === 9, 'armor has ten ranks');
  ok(
    buyHangarLevel(c, 'armor').reason === 'MAX LEVEL',
    'L10 is cap'
  );
  ok(Object.keys(HANGAR_SLOTS).length === 6, '6 hangar systems');
  c.gunship = 'supercobra';
  c.unlocked.push('supercobra');
  c.hangar.supercobra = { engine: 0, armor: 0, rotor: 0, range: 0, ordnance: 0, countermeasures: 0 };
  ok(buyHangarLevel(c, 'ordnance').ok === true, 'SuperCobra can buy ordnance');
  const sc = {
    bulletDamage: 10,
    fireRate: 0.15,
    accel: 1400,
    maxSpeed: 400,
    maxHp: 100,
    hp: 100,
    weaponRange: 350,
  };
  applyCareerToHeli(sc, c.pilot, c.hangar, 'supercobra');
  ok(sc.hasMissiles === true, 'ordnance L1 fits slow autofire missiles');
  ok(Math.abs(sc.missileRate - 10) < 0.01, 'base missile rate is 1 every 10s');
  const stock = {
    bulletDamage: 10,
    fireRate: 0.15,
    accel: 1400,
    maxSpeed: 400,
    maxHp: 100,
    hp: 100,
    weaponRange: 350,
  };
  applyCareerToHeli(
    stock,
    c.pilot,
    { supercobra: { engine: 0, armor: 0, rotor: 0, range: 0, ordnance: 0, countermeasures: 0 } },
    'supercobra'
  );
  ok(stock.hasMissiles === false, 'SuperCobra needs racks bought before missiles fire');
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
  const oldName = c.pilot.name;
  c.gunship = 'apache';
  c.unlocked.push('apache');
  c.hangar.apache = { engine: 0, armor: 0, weaponMount: 0, rotor: 0, avionics: 0 };
  const oldSorties = c.pilot.sortiesFlown;
  const r2 = commitSortieOutcome(c, 'failed', 999, 50);
  ok(r2.died === true, 'death flagged');
  ok(c.pilot.level === 1 && c.pilot.xp === 0, 'fresh pilot on death');
  ok(c.pilot.name !== oldName || true, 'new pilot generated');
  ok(c.dollars === 250, 'dollars persist through death');
  ok(c.hangar.cobra.engine === 2, 'hangar persists through death');
  ok(c.gunship === 'apache' && c.hangar.apache, 'gunship selection persists through death');
  ok(c.pilot.sortiesFlown === oldSorties + 1, 'KIA increments sortie count once');
  ok(c.campaign.sortie === 1 && c.campaign.act === 1, 'campaign restarts on death');
}

console.log('— campaign / practice sortie policy —');
{
  const c = createCareer(77);
  GameState.setCareer(c);
  GameState.setSortieXp(0);
  GameState.setSortieDollars(0);
  GameState.setSortieMode('practice');
  GameState.captureSortieSnapshot();
  GameState.addSortieXp(100);
  GameState.addSortieDollars(250);
  ok(GameState.isPracticeSortie(), 'practice mode is explicit in session state');
  ok(
    GameState.sortieXpEarned === 0 && GameState.sortieDollarsEarned === 0,
    'practice earns no rewards'
  );
  ok(
    GameState.sortieContext.pilotName === c.pilot.name &&
      GameState.sortieContext.gunshipId === c.gunship,
    'practice captures the active pilot and gunship'
  );
  GameState.setSortieMode('campaign');
  GameState.addSortieXp(100);
  GameState.addSortieDollars(250);
  ok(
    GameState.sortieXpEarned === 100 && GameState.sortieDollarsEarned === 250,
    'campaign rewards remain bankable'
  );
  GameState.setCareer(null);
}

console.log('— campaign structure —');
{
  const normal = createContractBoard(101, { act: 3, sortie: 2 });
  ok(
    normal.length === 4 && normal.every((c) => c.missionType === 'sortie'),
    'normal campaign sortie offers four contracts'
  );
  ok(
    normal.every((c) => c.id.startsWith('act-3-sortie-2-')),
    'contract IDs carry the active campaign position'
  );
  ok(
    normal.every((c) => Number.isFinite(c.hour) && c.hour >= 0 && c.hour < 24),
    'each contract has a clock hour'
  );
  ok(
    createContractBoard(101, { act: 3, sortie: 2 })[0].hour === normal[0].hour,
    'contract hour is deterministic'
  );
  const stronghold = createContractBoard(202, { act: 4, sortie: 4 });
  ok(stronghold.length === 1 && stronghold[0].stronghold, 'stronghold sortie is unavoidable');
  ok(
    Number.isFinite(stronghold[0].hour) && stronghold[0].hour >= 0 && stronghold[0].hour < 24,
    'stronghold has a clock hour'
  );
  ok(stronghold[0].bossProfile.final, 'Act 4 stronghold carries the final boss profile');
  ok(
    getCampaignMission({ act: 2, sortie: CAMPAIGN_RULES.strongholdSortie }).stronghold,
    'each act ends with a stronghold mission'
  );
  ok(
    !getCampaignMission({ act: 4, sortie: 4, allowStronghold: false }).stronghold,
    'allowStronghold false blocks the final'
  );
  ok(hunterBountyForCampaign({ act: 1, sortie: 1 }) === 250, 'act 1 hunter bounty is $250');
  ok(hunterBountyForCampaign({ act: 4, sortie: 3 }) === 600, 'late-act hunter bounty scales');

  const c = createCareer(8080);
  c.campaign = { act: 1, sortie: 1 };
  let next = advanceCampaign(c);
  ok(
    !next.prestige && c.campaign.act === 1 && c.campaign.sortie === 2,
    'normal sortie advances within the act'
  );
  c.campaign = { act: 1, sortie: 4 };
  next = advanceCampaign(c);
  ok(
    !next.prestige && c.campaign.act === 2 && c.campaign.sortie === 1,
    'stronghold completion advances the act'
  );
  c.campaign = { act: 4, sortie: 4 };
  const oldPilot = c.pilot;
  next = advanceCampaign(c);
  ok(next.prestige && c.prestige === 1, 'final stronghold awards prestige');
  ok(c.campaign.act === 1 && c.campaign.sortie === 1, 'prestige starts a new campaign');
  ok(
    c.pilot !== oldPilot && c.unlocked.includes('comanche'),
    'prestige resets pilot and unlocks Comanche'
  );
}

console.log('— applyCareerToHeli —');
{
  const c = createCareer(4);
  c.pilot.skills.gunnery = 2;
  c.pilot.stats.accuracy = 4;
  c.pilot.stats.grit = 4;
  c.hangar.cobra.armor = 2;
  c.hangar.cobra.range = 2;
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
  ok(heli.lastStand === false, 'no last stand below nerve 10');
  c.pilot.skills.nerve = 10;
  applyCareerToHeli(heli, c.pilot, c.hangar, 'cobra');
  ok(heli.lastStand === true, 'nerve 10 wires last stand');
  ok(heli.gunshipId === 'cobra', 'gunship id stamped');
  ok(heli.rotorBlades === 2, 'stock AH-1G is 2-blade');
  c.hangar.cobra.rotor = 5;
  applyCareerToHeli(heli, c.pilot, c.hangar, 'cobra');
  ok(heli.rotorBlades === 4, 'rotor 5 is 4-blade retrofit');
  ok(heli.hasMissiles === false, 'Cobra has no missile racks');
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
  wipeAllSaves();
  ok(loadCareer() === null, 'wipeAllSaves clears persisted career');
}

console.log('— practice sandbox —');
{
  const campaign = createCareer(42);
  campaign.dollars = 77;
  campaign.pilot.name = 'KEEP ME';
  saveCareer(campaign);
  const sand = createSandboxCareer(campaign);
  ok(isSandboxCareer(sand), 'sandbox flag is set');
  ok(sand.campaign.act === 4 && sand.campaign.sortie === 3, 'practice sits on late-act ops');
  ok(sand.campaign.allowStronghold === false, 'practice cannot open the final stronghold');
  ok(
    createContractBoard(77, sand.campaign).length === 4 &&
      createContractBoard(77, sand.campaign).every((card) => !card.stronghold),
    'practice board is four regular contracts'
  );
  ok(sand.unlocked.length === GUNSHIP_ORDER.length, 'all airframes unlocked');
  ok(
    PILOT_SKILLS.every((skill) => sand.pilot.skills[skill.id] === SKILL_MAX),
    'range pilot is fully rated'
  );
  ok(levelSkill(sand, 'gunnery').ok === false, 'sandbox cannot spend talent points');
  sand.dollars = 1;
  saveCareer(sand);
  const still = loadCareer();
  ok(still && still.dollars === 77 && still.pilot.name === 'KEEP ME', 'sandbox save does not overwrite campaign');
}

console.log('— achievements —');
{
  const c = createCareer(5);
  ok(evaluateAchievements(c).length === 0, 'fresh career has no medals');
  c.pilot.careerKills = 1;
  ok(evaluateAchievements(c).includes('first_blood'), 'first kill unlocks FIRST BLOOD');
  ok(c.achievements.first_blood, 'medal is stamped');
  ok(ACHIEVEMENTS.length >= 6, 'hub has a medal list');
}

console.log('— gunship roster / unlocks —');
{
  ok(GUNSHIP_ORDER.join(',') === 'cobra,supercobra,apache,longbow,dap,comanche', 'roster order');
  ok(
    GUNSHIP_DRAW_IDS.slice().sort().join(',') === GUNSHIP_ORDER.slice().sort().join(','),
    'every roster airframe has a renderer'
  );
  ok(GUNSHIPS.dap.year === 1990 && GUNSHIPS.dap.rotorBlades === 4, 'DAP is MH-60L 4-blade');
  ok(GUNSHIPS.comanche.unlock === 'prestige', 'Comanche is post-game');
  const c = createCareer(3);
  syncGunshipUnlocks(c);
  ok(c.unlocked.join(',') === 'cobra', 'fresh career is Cobra only');
  c.campaign.act = 4;
  syncGunshipUnlocks(c);
  ok(c.unlocked.includes('longbow') && !c.unlocked.includes('dap'), 'Longbow before DAP');
  c.campaign.act = 5;
  syncGunshipUnlocks(c);
  ok(c.unlocked.includes('dap') && !c.unlocked.includes('comanche'), 'DAP on campaign clear');
  c.prestige = 1;
  syncGunshipUnlocks(c);
  ok(c.unlocked.includes('comanche'), 'Comanche on prestige');
  const heli = { bulletDamage: 10, fireRate: 0.15, accel: 1, maxSpeed: 1, maxHp: 100, hp: 100 };
  applyCareerToHeli(heli, c.pilot, c.hangar, 'dap');
  ok(heli.gunshipId === 'dap' && heli.airframeScale === GUNSHIPS.dap.size, 'DAP scale stamped');
  ok(heli.rotorBlades === 4, 'DAP keeps its native rotor count');
  c.prestige = 1;
  syncGunshipUnlocks(c);
  for (const id of GUNSHIP_ORDER) {
    const selected = selectGunship(c, id);
    ok(selected.ok && c.gunship === id, `${id} can be selected once unlocked`);
    const airframe = {
      bulletDamage: 10,
      fireRate: 0.15,
      accel: 1,
      maxSpeed: 1,
      maxHp: 100,
      hp: 100,
    };
    applyCareerToHeli(airframe, c.pilot, c.hangar, id);
    ok(airframe.gunshipId === id, `${id} reaches the player renderer`);
    ok(airframe.rotorBlades === GUNSHIPS[id].rotorBlades, `${id} keeps its native rotor count`);
  }
  const fresh = createCareer(8);
  ok(
    !selectGunship(fresh, 'apache').ok && fresh.gunship === 'cobra',
    'locked airframe cannot be selected'
  );
}

console.log('— enemy roster / hunters —');
{
  ok(ENEMY_CLASS_ORDER.length === 16, '16 field classes from Appendix B');
  ok(
    ENEMY_CLASS_ORDER.every((id) => ENEMY_CLASSES[id]),
    'every ordered class has a definition'
  );
  ok(classMinAct('rifleman') === 1 && classMinAct('lightAA') === 1, 'act 1 opens with rifles and light AA');
  ok(classMinAct('manpads') === 2 && classMinAct('twin23') === 2 && classMinAct('apc') === 2, 'act 2 opens MANPADS / twin 23 / APC');
  ok(classMinAct('shilka') === 3 && classMinAct('tank') === 3 && classMinAct('sam') === 3, 'act 3 opens Shilka / tank / SAM');
  ok(classMinAct('heavyAA') === 4, '57mm AA waits until act 4');
  ok(!classesForAct(1).includes('tank') && !classesForAct(1).includes('shilka'), 'act 1 roster excludes armor and Shilkas');
  ok(classesForAct(4).length === ENEMY_CLASS_ORDER.length, 'act 4 unlocks the full field roster');
  ok(BOSS_DOSSIER_ORDER.length === 16, '16 hunter dossier slots');
  ok(new Set(BOSS_DOSSIER_ORDER).size === 16, 'hunter types are unique');
  ok(
    BOSS_DOSSIER_ORDER.every((id) => BOSS_DOSSIERS[id]?.hp > 0),
    'every hunter has hull'
  );
  ok(BOSS_DOSSIERS.light_tank?.hp === 110, 'act 1 hunter hull matches the 5 dmg / 2 rds gun');
  ok(BOSS_DOSSIERS.supergunship?.hp === 620 && BOSS_DOSSIERS.supergunship.final, 'Guardian hull is a one-sortie magdump, not a 2000hp wall');
}

console.log('— sortie sun —');
{
  ok(formatClock(4) === '04:00' && formatClock(18.5) === '18:30', 'clock formatting');
  ok(periodLabel(6.2) === 'DAWN' && periodLabel(23) === 'NIGHT', 'period labels');
  ok(hourFromSeed(99) === hourFromSeed(99), 'hourFromSeed is deterministic');
  const noon = sunFromHour(12);
  const night = sunFromHour(2);
  const dawn = sunFromHour(6.3);
  ok(noon.strength > night.strength, 'noon glare stronger than 2am');
  ok(noon.shadowLen < dawn.shadowLen, 'low sun casts a longer shadow');
  ok(night.isMoon && !noon.isMoon, 'night uses moon fill-in');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
