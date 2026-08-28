/**
 * meta.js — career state: pilot, skill grid, hangar, wallet, persistence.
 *
 * DOM-free so it can be unit-tested in node. The game owns one pilot per
 * career: death resets the pilot (name/stats/level/XP), while Dollars,
 * Hangar parts and gunship unlocks persist forever.
 */

import { PILOT_XP } from './config.js';
import { mulberry32, randInt, pick, clamp } from './rng.js';

const SAVE_KEY = 'gunship_save_v1';

/** Shared holder so UI screens can read the career without circular imports. */
export const metaState = { career: null };

// ─────────────────────────────────────────────────────────────────────────────
//  PILOT GENERATION
// ─────────────────────────────────────────────────────────────────────────────

const NAME_FIRST = [
  'Tariq',
  'Basim',
  'Daud',
  'Faisal',
  'Hakim',
  'Jalal',
  'Karim',
  'Nasir',
  'Omar',
  'Qasim',
  'Rafi',
  'Sami',
  'Tariq',
  'Zafir',
  'Idris',
  'Majed',
];
const NAME_CALL = [
  'VIPER',
  'GHOST',
  'SABRE',
  'NOMAD',
  'RAVEN',
  'DAGGER',
  'HAWK',
  'JACKAL',
  'SCORPION',
  'FALCON',
  'MANTIS',
  'DUNE',
];
const NAME_LAST = [
  'al-Asad',
  'al-Din',
  'Haddad',
  'Karam',
  'Mahmoud',
  'Nazari',
  'Qadir',
  'Sahim',
  'Toma',
  'Zahran',
  'Farouk',
  'Hakimi',
];

export function createPilot(seed = (Math.random() * 0xffffffff) >>> 0) {
  const rng = mulberry32(seed >>> 0);
  const stat = () => 1 + rng() * 3; // 1–4, fractional growth via nodes
  return {
    name: `${pick(NAME_FIRST, rng)} "${pick(NAME_CALL, rng)}" ${pick(NAME_LAST, rng)}`,
    level: 1,
    xp: 0,
    skillPoints: 0,
    allocated: [], // skill node ids
    alive: true,
    stats: {
      accuracy: stat(),
      control: stat(),
      awareness: stat(),
      speed: stat(),
      grit: stat(),
    },
    sortiesFlown: 0,
    careerKills: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKILL GRID — 5 branches × 6 nodes, cross-linked ladder per branch.
//  Layout per branch (GDD): top row 0-1-2, bottom row 3-4-5, links 0↔3,1↔4,2↔5.
//  Allocatable = adjacent to an allocated node; 0 and 3 are branch entries.
// ─────────────────────────────────────────────────────────────────────────────

export const SKILL_GRID = [
  // ── Marksman (accuracy) ──
  { id: 'stabilizer', branch: 0, tier: 0, name: 'Stabilizer', desc: '-5% weapon spread' },
  { id: 'marksman', branch: 0, tier: 1, name: 'Marksman', desc: '+10% gun damage' },
  { id: 'deadeye', branch: 0, tier: 2, name: 'Dead Eye', desc: '15% chance: double-damage shot' },
  { id: 'rapidfire', branch: 0, tier: 0, name: 'Rapid Fire', desc: '+10% fire rate' },
  { id: 'sniper', branch: 0, tier: 1, name: 'Sniper', desc: '+20% damage beyond 250u' },
  {
    id: 'doubletap',
    branch: 0,
    tier: 2,
    name: 'Double Tap',
    desc: '15% chance: second projectile',
  },
  // ── Pilot (control) ──
  { id: 'steadyhands', branch: 1, tier: 0, name: 'Steady Hands', desc: '+10% turn rate' },
  { id: 'lockedon', branch: 1, tier: 1, name: 'Locked On', desc: '+15% aim tracking speed' },
  {
    id: 'interceptor',
    branch: 1,
    tier: 2,
    name: 'Interceptor',
    desc: '+20% tracking on fast targets',
  },
  { id: 'recoilcontrol', branch: 1, tier: 0, name: 'Recoil Control', desc: '-15% weapon spread' },
  { id: 'smoothop', branch: 1, tier: 1, name: 'Smooth Operator', desc: '+10% turn rate' },
  {
    id: 'targetcomp',
    branch: 1,
    tier: 2,
    name: 'Targeting Computer',
    desc: 'Auto-lead moving targets',
  },
  // ── Recon (awareness) ──
  { id: 'sharpeyes', branch: 2, tier: 0, name: 'Sharp Eyes', desc: '+20% radar detail range' },
  { id: 'intelnet', branch: 2, tier: 1, name: 'Intel Network', desc: '+15% settlement detection' },
  {
    id: 'fullspectrum',
    branch: 2,
    tier: 2,
    name: 'Full Spectrum',
    desc: 'All hostiles visible on radar',
  },
  {
    id: 'threatdet',
    branch: 2,
    tier: 0,
    name: 'Threat Detector',
    desc: 'Incoming fire warning flash',
  },
  {
    id: 'markedtarget',
    branch: 2,
    tier: 1,
    name: 'Marked Target',
    desc: '+10% damage to locked target',
  },
  {
    id: 'reconflyover',
    branch: 2,
    tier: 2,
    name: 'Recon Flyover',
    desc: 'Full radar reveal every 30s (10s)',
  },
  // ── Thrust (speed) ──
  { id: 'lightframe', branch: 3, tier: 0, name: 'Light Frame', desc: '+10% acceleration' },
  { id: 'turbo', branch: 3, tier: 1, name: 'Turbo', desc: '+15% max speed' },
  { id: 'afterburner', branch: 3, tier: 2, name: 'Afterburner', desc: 'OVERBOOST lasts +20%' },
  { id: 'quickstart', branch: 3, tier: 0, name: 'Quick Start', desc: 'OVERBOOST potency +25%' },
  { id: 'zoom', branch: 3, tier: 1, name: 'Zoom', desc: '+25% accel while boosted' },
  { id: 'overdrive', branch: 3, tier: 2, name: 'Overdrive', desc: '+10% max speed' },
  // ── Fortitude (grit) ──
  { id: 'hardened', branch: 4, tier: 0, name: 'Hardened', desc: '10% damage resistance' },
  { id: 'ironskin', branch: 4, tier: 1, name: 'Iron Skin', desc: '15% damage resistance' },
  { id: 'bulletproof', branch: 4, tier: 2, name: 'Bulletproof', desc: '20% damage resistance' },
  { id: 'steady', branch: 4, tier: 0, name: 'Steady', desc: '-20% critical vision loss' },
  { id: 'unbreakable', branch: 4, tier: 1, name: 'Unbreakable', desc: '+25 maximum hull' },
  {
    id: 'laststand',
    branch: 4,
    tier: 2,
    name: 'Last Stand',
    desc: 'Survive lethal hit once per sortie',
  },
];

/** Adjacency: ladder within a branch. Returns neighbour ids. */
export function gridNeighbors(id) {
  const idx = SKILL_GRID.findIndex((n) => n.id === id);
  if (idx < 0) return [];
  const b = Math.floor(idx / 6),
    t = idx % 6;
  const row = t < 3 ? 0 : 1,
    col = t % 3;
  const at = (r, c) => {
    if (r < 0 || r > 1 || c < 0 || c > 2) return null;
    return SKILL_GRID[b * 6 + r * 3 + c].id;
  };
  const out = [];
  for (const [r, c] of [
    [row, col - 1],
    [row, col + 1],
    [row - 1, col],
    [row + 1, col],
  ]) {
    const n = at(r, c);
    if (n) out.push(n);
  }
  return out;
}

/** Can this node be allocated given the allocated set? */
export function canAllocate(allocated, id) {
  if (allocated.includes(id)) return false;
  const idx = SKILL_GRID.findIndex((n) => n.id === id);
  const t = idx % 6,
    row = t < 3 ? 0 : 1,
    col = t % 3;
  if (col === 0) return true; // branch entry nodes always open
  return gridNeighbors(id).some((n) => allocated.includes(n));
}

// ─────────────────────────────────────────────────────────────────────────────
//  HANGAR — per-gunship parts. 5 slots × 2 levels (fuel dropped per design;
//  countermeasures live in Equipment consumables).
// ─────────────────────────────────────────────────────────────────────────────

export const HANGAR_SLOTS = {
  engine: {
    name: 'ENGINE',
    levels: [
      { cost: 100, desc: 'Turbine: +30 speed, +120 accel' },
      { cost: 250, desc: 'Upgraded Turbine: +60 speed, +240 accel' },
    ],
  },
  armor: {
    name: 'ARMOR',
    levels: [
      { cost: 150, desc: 'Skid Plates: +20 hull, 5% resist' },
      { cost: 350, desc: 'Ballistic Armor: +40 hull, 10% resist' },
    ],
  },
  weaponMount: {
    name: 'WEAPON MOUNT',
    levels: [
      { cost: 200, desc: 'Pod Rail: +50 weapon range' },
      { cost: 500, desc: 'Dual Rail: +110 weapon range' },
    ],
  },
  rotor: {
    name: 'ROTOR',
    levels: [
      { cost: 120, desc: 'Improved 2-Blade: +8% turn rate' },
      { cost: 300, desc: '4-Blade Retrofit: +16% turn rate' },
    ],
  },
  avionics: {
    name: 'AVIONICS',
    levels: [
      { cost: 180, desc: 'Targeting Suite: +15% lock, +10% radar' },
      { cost: 420, desc: 'Strike Suite: +30% lock, +20% radar' },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  MODIFIER AGGREGATION — pilot stats + skill nodes + hangar → heli fields
// ─────────────────────────────────────────────────────────────────────────────

export function aggregateModifiers(pilot, hangar, gunshipId = 'cobra') {
  const m = {
    dmgMult: 1,
    spreadMult: 1,
    fireRateMult: 1,
    turnMult: 1,
    lockMult: 1,
    autoLead: false,
    accelMult: 1,
    maxSpeedMult: 1,
    radarRange: 1,
    detectionMult: 1,
    fullSpectrum: false,
    reconPulse: false,
    markedDmg: 0,
    dmgResist: 0,
    redScreenRed: 0,
    bonusHp: 0,
    boostDurMult: 1,
    boostPotency: 1,
    doubleTap: 0,
    critChance: 0,
    sniperBonus: 0,
    lastStand: false,
    missileWarning: false,
  };

  // Pilot base stats
  const s = pilot.stats;
  m.dmgMult *= 1 + (s.accuracy - 1) * 0.1;
  m.spreadMult /= 1 + (s.accuracy - 1) * 0.05;
  m.turnMult *= 1 + (s.control - 1) * 0.08;
  m.lockMult *= 1 + (s.control - 1) * 0.05;
  m.radarRange *= 1 + (s.awareness - 1) * 0.15;
  m.detectionMult *= 1 + (s.awareness - 1) * 0.05;
  m.accelMult *= 1 + (s.speed - 1) * 0.08;
  m.maxSpeedMult *= 1 + (s.speed - 1) * 0.05;
  m.dmgResist += (s.grit - 1) * 0.05;
  m.redScreenRed += (s.grit - 1) * 0.1;

  // Skill nodes
  const has = (id) => pilot.allocated.includes(id);
  if (has('stabilizer')) m.spreadMult *= 0.95;
  if (has('marksman')) m.dmgMult *= 1.1;
  if (has('deadeye')) m.critChance += 0.15;
  if (has('rapidfire')) m.fireRateMult *= 0.9;
  if (has('sniper')) m.sniperBonus += 0.2;
  if (has('doubletap')) m.doubleTap += 0.15;
  if (has('steadyhands')) m.turnMult *= 1.1;
  if (has('lockedon')) m.lockMult *= 1.15;
  if (has('interceptor')) m.turnMult *= 1.1; // tracking folds into turn
  if (has('recoilcontrol')) m.spreadMult *= 0.85;
  if (has('smoothop')) m.turnMult *= 1.1;
  if (has('targetcomp')) m.autoLead = true;
  if (has('sharpeyes')) m.radarRange *= 1.2;
  if (has('intelnet')) m.detectionMult *= 1.15;
  if (has('fullspectrum')) m.fullSpectrum = true;
  if (has('threatdet')) m.missileWarning = true;
  if (has('markedtarget')) m.markedDmg += 0.1;
  if (has('reconflyover')) m.reconPulse = true;
  if (has('lightframe')) m.accelMult *= 1.1;
  if (has('turbo')) m.maxSpeedMult *= 1.15;
  if (has('afterburner')) m.boostDurMult *= 1.2;
  if (has('quickstart')) m.boostPotency *= 1.25;
  if (has('zoom')) m.accelMult *= 1.1;
  if (has('overdrive')) m.maxSpeedMult *= 1.1;
  if (has('hardened')) m.dmgResist += 0.1;
  if (has('ironskin')) m.dmgResist += 0.15;
  if (has('bulletproof')) m.dmgResist += 0.2;
  if (has('steady')) m.redScreenRed += 0.2;
  if (has('unbreakable')) m.bonusHp += 25;
  if (has('laststand')) m.lastStand = true;

  // Hangar levels
  const h = hangar[gunshipId] || {};
  const lvl = (slot) => h[slot] || 0;
  if (lvl('engine') >= 1) {
    m.maxSpeedMult *= 1.06;
    m.accelMult *= 1.08;
  }
  if (lvl('engine') >= 2) {
    m.maxSpeedMult *= 1.06;
    m.accelMult *= 1.08;
  }
  if (lvl('armor') >= 1) {
    m.bonusHp += 20;
    m.dmgResist += 0.05;
  }
  if (lvl('armor') >= 2) {
    m.bonusHp += 20;
    m.dmgResist += 0.05;
  }
  if (lvl('weaponMount') >= 1) m.rangeBonus = (m.rangeBonus || 0) + 50;
  if (lvl('weaponMount') >= 2) m.rangeBonus = (m.rangeBonus || 0) + 60;
  if (lvl('rotor') >= 1) m.turnMult *= 1.08;
  if (lvl('rotor') >= 2) m.turnMult *= 1.08;
  if (lvl('avionics') >= 1) {
    m.lockMult *= 1.15;
    m.radarRange *= 1.1;
  }
  if (lvl('avionics') >= 2) {
    m.lockMult *= 1.15;
    m.radarRange *= 1.1;
  }

  m.dmgResist = Math.min(m.dmgResist, 0.6); // hard cap
  return m;
}

/** Apply aggregated career modifiers onto a freshly-reset heli. */
export function applyCareerToHeli(heli, pilot, hangar, gunshipId = 'cobra') {
  const m = aggregateModifiers(pilot, hangar, gunshipId);
  heli.bulletDamage = Math.max(1, Math.round(heli.bulletDamage * m.dmgMult));
  heli.fireRate = heli.fireRate * m.fireRateMult;
  heli.accel = heli.accel * m.accelMult;
  heli.maxSpeed = heli.maxSpeed * m.maxSpeedMult;
  heli.maxHp = Math.round(heli.maxHp * 1 + m.bonusHp);
  heli.hp = heli.maxHp;
  heli.weaponRange = (heli.weaponRange || 350) + (m.rangeBonus || 0);
  // Non-numeric career fields consumed by the sim/HUD:
  heli.turnMult = m.turnMult;
  heli.spreadMult = m.spreadMult;
  heli.lockMult = m.lockMult;
  heli.autoLead = m.autoLead;
  heli.radarRange = m.radarRange;
  heli.detectionMult = m.detectionMult;
  heli.fullSpectrum = m.fullSpectrum;
  heli.reconPulse = m.reconPulse;
  heli.markedDmg = m.markedDmg;
  heli.dmgResist = m.dmgResist;
  heli.redScreenRed = m.redScreenRed;
  heli.boostDurMult = m.boostDurMult;
  heli.boostPotency = m.boostPotency;
  heli.doubleTap = m.doubleTap;
  heli.critChance = m.critChance;
  heli.sniperBonus = m.sniperBonus;
  heli.lastStand = m.lastStand;
  heli.missileWarning = m.missileWarning;
  heli.lastStandUsed = false;
  return heli;
}

// ─────────────────────────────────────────────────────────────────────────────
//  XP / LEVELLING
// ─────────────────────────────────────────────────────────────────────────────

/** Total career XP required to REACH `level` (cumulative thresholds). */
export function xpToNext(level) {
  const row = PILOT_XP.find((r) => r.level === level);
  return row ? row.xpToNext : Infinity;
}

/** Add XP; returns number of levels gained (each grants 1 skill point). */
export function gainXp(pilot, amount) {
  if (amount <= 0 || pilot.level >= 10) return 0;
  pilot.xp += amount;
  let levels = 0;
  while (pilot.level < 10 && pilot.xp >= xpToNext(pilot.level + 1)) {
    pilot.level += 1;
    pilot.skillPoints += 1;
    levels += 1;
  }
  return levels;
}

// ─────────────────────────────────────────────────────────────────────────────
//  CAREER (save state) + PERSISTENCE
// ─────────────────────────────────────────────────────────────────────────────

export function createCareer(seed) {
  return {
    version: 1,
    pilot: createPilot(seed),
    dollars: 0,
    hangar: { cobra: { engine: 0, armor: 0, weaponMount: 0, rotor: 0, avionics: 0 } },
    unlocked: ['cobra'],
    gunship: 'cobra',
    campaign: { act: 1, sortie: 1 },
    prestige: 0,
  };
}

export function loadCareer() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !data.pilot) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveCareer(career) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(career));
  } catch {
    /* private mode etc. — play without persistence */
  }
}

export function clearCareer() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Apply the outcome of a finished sortie to the career.
 *  - 'failed' (pilot KIA): XP lost, fresh pilot, campaign restarts. Dollars/hangar kept.
 *  - 'complete' | 'abandoned': pilot survives — XP kept, level-ups granted.
 * `campaign` advance is the caller's job (it knows completion state).
 * Returns { died, levelsGained }.
 */
export function commitSortieOutcome(career, status, xpEarned, dollarsEarned) {
  career.dollars += dollarsEarned;
  career.pilot.sortiesFlown += 1;
  career.pilot.careerKills = career.pilot.careerKills || 0;

  let died = false;
  let levelsGained = 0;

  if (status === 'failed') {
    died = true;
    const keep = {
      sortiesFlown: career.pilot.sortiesFlown,
      careerKills: career.pilot.careerKills,
    };
    career.pilot = createPilot((Math.random() * 0xffffffff) >>> 0);
    career.pilot.sortiesFlown = keep.sortiesFlown + 1;
    career.pilot.careerKills = keep.careerKills;
    career.campaign = { act: 1, sortie: 1 };
  } else {
    levelsGained = gainXp(career.pilot, xpEarned);
  }

  saveCareer(career);
  return { died, levelsGained };
}

/** Hangar purchase. Returns { ok, reason }. */
export function buyHangarLevel(career, slot) {
  const def = HANGAR_SLOTS[slot];
  if (!def) return { ok: false, reason: 'UNKNOWN SLOT' };
  const tree = career.hangar[career.gunship] || (career.hangar[career.gunship] = {});
  const lvl = tree[slot] || 0;
  if (lvl >= 2) return { ok: false, reason: 'MAX LEVEL' };
  const cost = def.levels[lvl].cost;
  if (career.dollars < cost) return { ok: false, reason: 'INSUFFICIENT FUNDS' };
  career.dollars -= cost;
  tree[slot] = lvl + 1;
  saveCareer(career);
  return { ok: true };
}

/** Skill-node allocation with adjacency + SP check. Returns { ok, reason }. */
export function allocateSkill(career, nodeId) {
  const node = SKILL_GRID.find((n) => n.id === nodeId);
  if (!node) return { ok: false, reason: 'UNKNOWN NODE' };
  if (career.pilot.allocated.includes(nodeId)) return { ok: false, reason: 'ALREADY OWNED' };
  if (career.pilot.skillPoints <= 0) return { ok: false, reason: 'NO SKILL POINTS' };
  if (!canAllocate(career.pilot.allocated, nodeId))
    return { ok: false, reason: 'LOCKED — CONNECT FROM OWNED NODE' };
  career.pilot.allocated.push(nodeId);
  career.pilot.skillPoints -= 1;
  saveCareer(career);
  return { ok: true };
}

/** Free respec between sorties. */
export function respecSkills(career) {
  career.pilot.skillPoints += career.pilot.allocated.length;
  career.pilot.allocated = [];
  saveCareer(career);
}

export { clamp };
