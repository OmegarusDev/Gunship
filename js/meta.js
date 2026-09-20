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
const ROSTER_KEY = 'gunship_roster_v1';

function newSlotId() {
  return `pilot-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function emptyRoster() {
  return { version: 1, activeId: null, slots: [] };
}

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function loadRoster() {
  const stored = readJson(ROSTER_KEY);
  if (stored?.slots?.length) return stored;
  const legacy = readJson(SAVE_KEY);
  if (legacy?.pilot) {
    const id = newSlotId();
    const roster = {
      version: 1,
      activeId: id,
      slots: [{ id, lastPlayed: Date.now(), career: legacy }],
    };
    try {
      localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
    } catch {
      /* ignore */
    }
    return roster;
  }
  return emptyRoster();
}

export function saveRoster(roster) {
  try {
    localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
  } catch {
    /* private mode */
  }
}

export function listPilotSlots() {
  const roster = loadRoster();
  return roster.slots
    .slice()
    .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))
    .map((slot) => ({
      id: slot.id,
      lastPlayed: slot.lastPlayed || 0,
      name: slot.career?.pilot?.name || 'UNKNOWN',
      level: slot.career?.pilot?.level || 1,
      dollars: slot.career?.dollars || 0,
      act: slot.career?.campaign?.act || 1,
      sortie: slot.career?.campaign?.sortie || 1,
      active: slot.id === roster.activeId,
    }));
}

export function activatePilotSlot(id) {
  const roster = loadRoster();
  const slot = roster.slots.find((s) => s.id === id);
  if (!slot) return null;
  roster.activeId = id;
  slot.lastPlayed = Date.now();
  saveRoster(roster);
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(slot.career));
  } catch {
    /* ignore */
  }
  return slot.career;
}

export function addCareerToRoster(career) {
  const roster = loadRoster();
  const id = newSlotId();
  roster.slots.push({ id, lastPlayed: Date.now(), career });
  roster.activeId = id;
  saveRoster(roster);
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(career));
  } catch {
    /* ignore */
  }
  return id;
}

/** Shared holder so UI screens can read the career without circular imports. */
export const metaState = { career: null };

// ─────────────────────────────────────────────────────────────────────────────
//  PILOT GENERATION
// ─────────────────────────────────────────────────────────────────────────────

const NAME_BANKS = {
  american: {
    first: [
      'Beau',
      'Bo',
      'Brody',
      'Bubba',
      'Cash',
      'Chet',
      'Cletus',
      'Clint',
      'Colt',
      'Cody',
      'Dallas',
      'Duke',
      'Dwight',
      'Garth',
      'Hank',
      'Hunter',
      'Jed',
      'Jethro',
      'Leroy',
      'Maverick',
      'Merle',
      'Randy',
      'Rip',
      'Tanner',
      'Travis',
      'Wade',
      'Waylon',
      'Wyatt',
    ],
    call: [
      'ACE',
      'BANDIT',
      'DUKE',
      'EAGLE',
      'FREEDOM',
      'GUNNER',
      'GUNNY',
      'HAWG',
      'MAVERICK',
      'OUTLAW',
      'PATRIOT',
      'RAMBO',
      'REBEL',
      'SPARKY',
      'YANKEE',
      'YEEHAW',
    ],
    last: [
      'Boone',
      'Calhoun',
      'Cutter',
      'Dalton',
      'Dodge',
      'Earp',
      'Fairchild',
      'Gritton',
      'Haggard',
      'Hickok',
      'Holster',
      'Jackson',
      'Ledoux',
      'McGraw',
      'Presley',
      'Rambo',
      'Redd',
      'Steele',
      'Truitt',
      'Walker',
    ],
  },
  arab: {
    first: [
      'Ahmed',
      'Basim',
      'Faisal',
      'Farid',
      'Hakim',
      'Hassan',
      'Ibrahim',
      'Idris',
      'Jalal',
      'Karim',
      'Khalid',
      'Majed',
      'Mustafa',
      'Nabil',
      'Nasir',
      'Omar',
      'Qasim',
      'Rafi',
      'Rashid',
      'Sami',
      'Tariq',
      'Walid',
      'Yusuf',
      'Zafir',
    ],
    call: [
      'BADR',
      'DAGGER',
      'DUNE',
      'FALCON',
      'FENNEC',
      'HAWK',
      'JACKAL',
      'MANTIS',
      'MIRAGE',
      'NASR',
      'NOMAD',
      'SABRE',
      'SAQR',
      'SCORPION',
      'SHAMS',
      'VIPER',
    ],
    last: [
      'Abdullah',
      'al-Asad',
      'al-Din',
      'al-Rashid',
      'Farouk',
      'Haddad',
      'Hakimi',
      'Hussein',
      'Karam',
      'Khoury',
      'Mahmoud',
      'Mansour',
      'Nasser',
      'Nazari',
      'Qadir',
      'Rahman',
      'Sahim',
      'Saleh',
      'Toma',
      'Zahran',
    ],
  },
};

export function randomNameParts(seed = (Math.random() * 0xffffffff) >>> 0, culture = null) {
  const rng = mulberry32(seed >>> 0);
  const picked =
    culture === 'american' || culture === 'arab' ? culture : rng() < 0.5 ? 'american' : 'arab';
  const bank = NAME_BANKS[picked];
  return {
    culture: picked,
    first: pick(bank.first, rng),
    callsign: pick(bank.call, rng),
    last: pick(bank.last, rng),
  };
}

export function formatPilotName(first, callsign, last) {
  const f = String(first || '').trim() || 'Pilot';
  const c =
    String(callsign || '')
      .trim()
      .toUpperCase() || 'GHOST';
  const l = String(last || '').trim();
  return l ? `${f} "${c}" ${l}` : `${f} "${c}"`;
}

export function setPilotName(pilot, parts) {
  const first = parts.first ?? '';
  const callsign = parts.callsign ?? '';
  const last = parts.last ?? '';
  const culture =
    parts.culture === 'american' || parts.culture === 'arab'
      ? parts.culture
      : pilot.nameParts?.culture;
  pilot.nameParts = { first, callsign, last, culture };
  pilot.name = formatPilotName(first, callsign, last);
  return pilot;
}

export function createPilot(seed = (Math.random() * 0xffffffff) >>> 0) {
  const rng = mulberry32(seed >>> 0);
  const parts = randomNameParts(seed);
    const stat = () => 1 + rng() * 3;
  return {
    name: formatPilotName(parts.first, parts.callsign, parts.last),
    nameParts: parts,
    level: 1,
    xp: 0,
    skillPoints: 0,
    skills: emptySkillMap(),
    allocated: [],
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
    dossierKills: {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  PILOT SKILLS — human talent, not airframe hardware.
//  Ranks never raise top speed; hangar engines do that. Flying can still
//  turn and accelerate quicker because that is stick work.
//  Perks land at ranks 3, 5, 7 and 10.
// ─────────────────────────────────────────────────────────────────────────────

export const SKILL_MAX = 10;
export const SKILL_PERK_RANKS = [3, 5, 7, 10];

const SKILL_ALIASES = { hands: 'flying', eyes: 'vision', lead: 'tracking' };

export const PILOT_SKILLS = [
  {
    id: 'gunnery',
    name: 'GUNNERY',
    hint: 'Sight picture and trigger control. Tightens the gun group so more rounds hit. Does not hit harder and does not cycle the cannon faster.',
    perks: {
      3: { name: 'STEADY', desc: 'Boosting no longer walks the burst.' },
      5: { name: 'PICTURE', desc: 'Another cut of spread on top of rank.' },
      7: { name: 'HOLDOVER', desc: 'Groups tighten further on slow or stopped contacts.' },
      10: { name: 'ZEROED', desc: 'Almost no wander. The pipper stays put.' },
    },
  },
  {
    id: 'flying',
    name: 'FLYING',
    hint: 'Stick and collective. You roll into a turn and spool the rotor sooner. Does not raise top speed — that is the airframe.',
    perks: {
      3: { name: 'COLLECTIVE', desc: 'Quicker spool when you pull power.' },
      5: { name: 'PEDAL', desc: 'The nose comes around faster.' },
      7: { name: 'ENERGY', desc: 'You dump speed cleaner when you let off.' },
      10: { name: 'SEAT TIME', desc: 'Boosts last a little longer because you hold the attitude.' },
    },
  },
  {
    id: 'vision',
    name: 'VISION',
    hint: 'Scan, radio picture, dust and muzzle flash. Better radar and you notice contacts earlier.',
    perks: {
      3: { name: 'WARNING', desc: 'Incoming missiles paint on the glass.' },
      5: { name: 'SCAN', desc: 'You pick up contacts further out.' },
      7: { name: 'PULSE', desc: 'A short recon pulse marks the nearest cluster.' },
      10: { name: 'SPECTRUM', desc: 'Full-spectrum picture. Hidden contacts show sooner.' },
    },
  },
  {
    id: 'nerve',
    name: 'NERVE',
    hint: 'You stay on the controls under fire instead of flinching. The glass washes out less. Highest rank: one recovery from a killing blow.',
    perks: {
      3: { name: 'COLD', desc: 'The red wash fades faster.' },
      5: { name: 'PLATE', desc: 'You ride hits instead of folding.' },
      7: { name: 'NO FLINCH', desc: 'Low hull no longer blooms the screen.' },
      10: { name: 'LAST STAND', desc: 'One killing blow becomes a 25% hull recovery.' },
    },
  },
  {
    id: 'tracking',
    name: 'TRACKING',
    hint: 'You put rounds where the target will be. Locks stick faster and, at high rank, you auto-lead movers.',
    perks: {
      3: { name: 'LEAD', desc: 'The pipper leads movers for you.' },
      5: { name: 'LOCK', desc: 'Locks bite and hold.' },
      7: { name: 'MARK', desc: 'A tracked contact takes extra punishment.' },
      10: { name: 'SOLUTION', desc: 'Locks are near-instant and the lead is clean.' },
    },
  },
  {
    id: 'luck',
    name: 'LUCK',
    hint: 'Caches, wrecks, and field finds go your way. Better payouts and, at high rank, extra crates on the map.',
    perks: {
      3: { name: 'SALVAGE', desc: 'Crates pay more.' },
      5: { name: 'NOSE', desc: 'You snag crates from further out, and the map hides one extra.' },
      7: { name: 'STASH', desc: 'Finds skew toward ammo and turbine kits.' },
      10: { name: 'JACKPOT', desc: 'A chance to double a pickup, and another crate on the map.' },
    },
  },
];

export function emptySkillMap() {
  const skills = {};
  for (const skill of PILOT_SKILLS) skills[skill.id] = 0;
  return skills;
}

export function migratePilotSkills(pilot) {
  if (!pilot || typeof pilot !== 'object') return pilot;
  if (!pilot.skills || typeof pilot.skills !== 'object') {
    const refund = Array.isArray(pilot.allocated) ? pilot.allocated.length : 0;
    pilot.skills = emptySkillMap();
    pilot.skillPoints = (pilot.skillPoints || 0) + refund;
    pilot.allocated = [];
  } else {
    const src = { ...pilot.skills };
    for (const [from, to] of Object.entries(SKILL_ALIASES)) {
      if (src[from] != null && src[to] == null) src[to] = src[from];
    }
    pilot.skills = emptySkillMap();
    for (const skill of PILOT_SKILLS) {
      const n = Math.round(Number(src[skill.id]) || 0);
      pilot.skills[skill.id] = clamp(n, 0, SKILL_MAX);
    }
  }
  if (!Array.isArray(pilot.allocated)) pilot.allocated = [];
  return pilot;
}

export function skillRank(pilot, id) {
  migratePilotSkills(pilot);
  return pilot?.skills?.[id] || 0;
}

export function spentSkillPoints(pilot) {
  migratePilotSkills(pilot);
  return PILOT_SKILLS.reduce((sum, skill) => sum + (pilot.skills[skill.id] || 0), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
//  HANGAR — per-gunship systems. 6 slots × 10 levels.
//  Range is sensors + targeting. Ordnance is SuperCobra+ missile racks.
//  Defenses stretch flare bloom. Cobra cannot fit ordnance.
// ─────────────────────────────────────────────────────────────────────────────

export const GUNSHIPS = {
  cobra: {
    id: 'cobra',
    name: 'AH-1G Cobra',
    year: 1967,
    rotorBlades: 2,
    size: 1,
    unlock: 'start',
    hardpoints: false,
  },
  supercobra: {
    id: 'supercobra',
    name: 'AH-1W SuperCobra',
    year: 1986,
    rotorBlades: 2,
    size: 1.03,
    unlock: 'act_2',
    hardpoints: true,
  },
  apache: {
    id: 'apache',
    name: 'AH-64 Apache',
    year: 1986,
    rotorBlades: 4,
    size: 1.08,
    unlock: 'act_3',
    hardpoints: true,
  },
  longbow: {
    id: 'longbow',
    name: 'AH-64D Longbow',
    year: 1997,
    rotorBlades: 4,
    size: 1.08,
    unlock: 'act_4',
    hardpoints: true,
  },
  dap: {
    id: 'dap',
    name: 'MH-60L DAP',
    year: 1990,
    rotorBlades: 4,
    size: 1.1,
    unlock: 'campaign',
    hardpoints: true,
  },
  comanche: {
    id: 'comanche',
    name: 'RAH-66 Comanche',
    year: 1996,
    rotorBlades: 5,
    size: 1,
    unlock: 'prestige',
    hardpoints: true,
  },
};

export const GUNSHIP_ORDER = ['cobra', 'supercobra', 'apache', 'longbow', 'dap', 'comanche'];

export function gunshipDef(id = 'cobra') {
  return GUNSHIPS[id] || GUNSHIPS.cobra;
}

export const HANGAR_MAX = 10;
export const HANGAR_SLOT_ORDER = [
  'engine',
  'armor',
  'rotor',
  'range',
  'ordnance',
  'countermeasures',
];

function emptyHangarTree() {
  const tree = {};
  for (const id of HANGAR_SLOT_ORDER) tree[id] = 0;
  return tree;
}

export function gunshipHasMissiles(id) {
  const def = GUNSHIPS[id];
  return Boolean(def?.hardpoints);
}

function migrateHangarTree(tree) {
  const next = emptyHangarTree();
  if (!tree || typeof tree !== 'object') return next;
  for (const id of HANGAR_SLOT_ORDER) {
    next[id] = clamp(Math.round(Number(tree[id]) || 0), 0, HANGAR_MAX);
  }
  if (!tree.range) {
    const inherited = (Number(tree.weaponMount) || 0) + (Number(tree.avionics) || 0);
    if (inherited > 0) next.range = clamp(inherited, 0, HANGAR_MAX);
  }
  return next;
}

/** Grant airframes the career has earned. DAP after the campaign; Comanche on prestige. */
export function syncGunshipUnlocks(career) {
  if (!career || typeof career !== 'object') return career;
  career.unlocked = Array.isArray(career.unlocked) ? career.unlocked : [];
  career.hangar = career.hangar && typeof career.hangar === 'object' ? career.hangar : {};
  if (!GUNSHIPS[career.gunship]) career.gunship = 'cobra';

  const act = career.campaign?.act || 1;
  const prestige = career.prestige || 0;
  const add = (id) => {
    if (!career.unlocked.includes(id)) career.unlocked.push(id);
    if (!career.hangar[id]) career.hangar[id] = emptyHangarTree();
    else career.hangar[id] = migrateHangarTree(career.hangar[id]);
  };
  add('cobra');
  if (act >= 2) add('supercobra');
  if (act >= 3) add('apache');
  if (act >= 4) add('longbow');
  if (act >= 5 || prestige >= 1) add('dap');
  if (prestige >= 1) add('comanche');
  if (!career.unlocked.includes(career.gunship)) career.gunship = 'cobra';
  migratePilotSkills(career.pilot);
  if (!career.achievements || typeof career.achievements !== 'object') career.achievements = {};
  if (!Number.isFinite(career.pilotsLost)) career.pilotsLost = 0;
  if (!Number.isFinite(career.extracts)) career.extracts = 0;
  return career;
}

/** Select an unlocked airframe and persist it with the active career. */
export function selectGunship(career, id) {
  syncGunshipUnlocks(career);
  if (!GUNSHIPS[id]) return { ok: false, reason: 'UNKNOWN AIRFRAME' };
  if (!career.unlocked.includes(id)) return { ok: false, reason: 'LOCKED AIRFRAME' };
  career.gunship = id;
  if (!career.hangar[id]) career.hangar[id] = emptyHangarTree();
  saveCareer(career);
  return { ok: true };
}

/** Unlocked hangar + maxed pilot for Practice. Never written to the campaign save. */
export function createSandboxCareer(source) {
  const src = source && typeof source === 'object' ? source : createCareer(1);
  const hangar = {};
  for (const id of GUNSHIP_ORDER) hangar[id] = emptyHangarTree();
  const skills = emptySkillMap();
  for (const skill of PILOT_SKILLS) skills[skill.id] = SKILL_MAX;
  const srcParts = src.pilot?.nameParts;
  return {
    version: 1,
    sandbox: true,
    pilot: {
      name: 'RANGE PILOT',
      nameParts: srcParts
        ? { ...srcParts }
        : {
            first: 'Range',
            callsign: 'SAND',
            last: 'Box',
            culture: 'american',
          },
      level: 10,
      xp: 0,
      skillPoints: 0,
      skills,
      allocated: [],
      alive: true,
      stats: { accuracy: 4, control: 4, awareness: 4, speed: 4, grit: 4 },
      sortiesFlown: 0,
      careerKills: 0,
      dossierKills: {},
    },
    dollars: 99999,
    hangar,
    unlocked: GUNSHIP_ORDER.slice(),
    gunship: GUNSHIPS[src.gunship] ? src.gunship : 'cobra',
    campaign: { act: 4, sortie: 3, allowStronghold: false },
    prestige: Math.max(1, src.prestige || 0),
    dossierKills: { ...(src.dossierKills || {}) },
    achievements: { ...(src.achievements || {}) },
    pilotsLost: src.pilotsLost || 0,
    extracts: src.extracts || 0,
  };
}

export function isSandboxCareer(career) {
  return Boolean(career?.sandbox);
}

function hangarLadder(baseCost, describe) {
  return Array.from({ length: HANGAR_MAX }, (_, i) => {
    const n = i + 1;
    return {
      cost: Math.max(5, Math.round((baseCost * Math.pow(1.27, i)) / 5) * 5),
      desc: describe(n),
    };
  });
}

export const HANGAR_SLOTS = {
  engine: {
    name: 'ENGINE',
    levels: hangarLadder(
      100,
      (n) => `Turbine ${n}: +${(n * 1.8).toFixed(1)}% top speed, +${(n * 2.2).toFixed(1)}% accel`
    ),
  },
  armor: {
    name: 'ARMOR',
    levels: hangarLadder(120, (n) => `Plate ${n}: +${n * 6} hull, +${(n * 1.2).toFixed(1)}% resist`),
  },
  rotor: {
    name: 'ROTOR',
    levels: hangarLadder(90, (n) =>
      n >= 5
        ? `Head ${n}: +${(n * 2.2).toFixed(1)}% turn${n === 5 ? ' · 4-blade retrofit' : ''}`
        : `Head ${n}: +${(n * 2.2).toFixed(1)}% turn`
    ),
  },
  range: {
    name: 'RANGE',
    levels: hangarLadder(
      110,
      (n) =>
        `Sensors ${n}: +${n * 18}m gun range, +${(n * 4).toFixed(0)}% lock, +${(n * 3).toFixed(0)}% radar`
    ),
  },
  ordnance: {
    name: 'ORDNANCE',
    levels: hangarLadder(150, (n) => {
      if (n === 1) return 'Racks 1: slow autofire missiles — 1 every 10s';
      const seconds = (10 / (1 + 0.035 * (n - 1))).toFixed(1);
      return `Racks ${n}: missiles every ${seconds}s, +${n * 2} warhead`;
    }),
  },
  countermeasures: {
    name: 'DEFENSES',
    levels: hangarLadder(
      100,
      (n) => `CM ${n}: flares last ${(3 * (1 + 0.08 * n)).toFixed(1)}s, wider bloom`
    ),
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
    lootMult: 1,
    lootRadius: 24,
    lootQuality: false,
    lootJackpot: false,
    extraCrates: 0,
    hasMissiles: false,
    missileRate: 10,
    missileDamage: 18,
    flareDurMult: 1,
    flareRadius: 170,
    shakeResist: 0,
    noFlinch: false,
    brakeMult: 1,
    hoverSpread: false,
    slowSpread: false,
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
  m.dmgResist += (s.grit - 1) * 0.05;
  m.redScreenRed += (s.grit - 1) * 0.1;

  migratePilotSkills(pilot);
  const gunnery = skillRank(pilot, 'gunnery');
  const flying = skillRank(pilot, 'flying');
  const vision = skillRank(pilot, 'vision');
  const nerve = skillRank(pilot, 'nerve');
  const tracking = skillRank(pilot, 'tracking');
  const luck = skillRank(pilot, 'luck');
  m.spreadMult /= 1 + 0.045 * gunnery;
  if (gunnery >= 3) m.hoverSpread = true;
  if (gunnery >= 5) m.spreadMult /= 1.12;
  if (gunnery >= 7) m.slowSpread = true;
  if (gunnery >= 10) m.spreadMult *= 0.55;
  m.turnMult *= 1 + 0.035 * flying;
  m.accelMult *= 1 + 0.035 * flying;
  if (flying >= 3) m.accelMult *= 1.06;
  if (flying >= 5) m.turnMult *= 1.06;
  if (flying >= 7) m.brakeMult *= 1.12;
  if (flying >= 10) m.boostDurMult *= 1.15;
  m.radarRange *= 1 + 0.05 * vision;
  m.detectionMult *= 1 + 0.035 * vision;
  if (vision >= 3) m.missileWarning = true;
  if (vision >= 5) m.detectionMult *= 1.12;
  if (vision >= 7) m.reconPulse = true;
  if (vision >= 10) m.fullSpectrum = true;
  m.dmgResist += 0.018 * nerve;
  m.redScreenRed += 0.03 * nerve;
  m.shakeResist += 0.04 * nerve;
  if (nerve >= 3) m.redScreenRed += 0.12;
  if (nerve >= 5) m.dmgResist += 0.05;
  if (nerve >= 7) m.noFlinch = true;
  if (nerve >= 10) m.lastStand = true;
  m.lockMult *= 1 + 0.04 * tracking;
  m.markedDmg += 0.02 * tracking;
  if (tracking >= 3) m.autoLead = true;
  if (tracking >= 5) m.lockMult *= 1.15;
  if (tracking >= 7) m.markedDmg += 0.08;
  if (tracking >= 10) m.lockMult *= 1.2;
  m.lootMult *= 1 + 0.06 * luck;
  if (luck >= 3) m.lootMult *= 1.15;
  if (luck >= 5) {
    m.lootRadius = 34;
    m.extraCrates += 1;
  }
  if (luck >= 7) m.lootQuality = true;
  if (luck >= 10) {
    m.lootJackpot = true;
    m.extraCrates += 1;
  }

  // Hangar levels — these are the airframe, not the pilot.
  const h = migrateHangarTree(hangar?.[gunshipId]);
  const lvl = (slot) => clamp(h[slot] || 0, 0, HANGAR_MAX);
  const engine = lvl('engine');
  const armor = lvl('armor');
  const rotor = lvl('rotor');
  const range = lvl('range');
  const ordnance = lvl('ordnance');
  const cm = lvl('countermeasures');
  m.maxSpeedMult *= 1 + 0.018 * engine;
  m.accelMult *= 1 + 0.022 * engine;
  m.bonusHp += 6 * armor;
  m.dmgResist += 0.012 * armor;
  m.turnMult *= 1 + 0.022 * rotor;
  m.rangeBonus = (m.rangeBonus || 0) + 18 * range;
  m.lockMult *= 1 + 0.04 * range;
  m.radarRange *= 1 + 0.03 * range;
  m.hasMissiles = gunshipHasMissiles(gunshipId) && ordnance >= 1;
  m.missileRate = 10 / (1 + 0.035 * Math.max(0, ordnance - 1));
  m.missileDamage = 16 + 2 * ordnance;
  m.flareDurMult *= 1 + 0.08 * cm;
  m.flareRadius = 170 * (1 + 0.04 * cm);

  m.dmgResist = Math.min(m.dmgResist, 0.6); // hard cap
  return m;
}

/** Apply aggregated career modifiers onto a freshly-reset heli. */
export function applyCareerToHeli(heli, pilot, hangar, gunshipId = 'cobra') {
  const id = GUNSHIPS[gunshipId] ? gunshipId : 'cobra';
  const safeHangar = hangar && typeof hangar === 'object' ? hangar : {};
  const m = aggregateModifiers(pilot, safeHangar, id);
  const tree = migrateHangarTree(safeHangar[id]);
  heli.gunshipId = id;
  const def = gunshipDef(id);
  heli.airframeScale = def.size || 1;
  heli.rotorBlades = def.rotorBlades === 5 ? 5 : (tree.rotor || 0) >= 5 ? 4 : def.rotorBlades;
  heli.bulletDamage = Math.max(1, Math.round(heli.bulletDamage * m.dmgMult));
  heli.fireRate = heli.fireRate * m.fireRateMult;
  heli.accel = heli.accel * m.accelMult;
  heli.maxSpeed = heli.maxSpeed * m.maxSpeedMult;
  heli.maxHp = Math.round(heli.maxHp * 1 + m.bonusHp);
  heli.hp = heli.maxHp;
  heli.weaponRange = (heli.weaponRange || 350) + (m.rangeBonus || 0);
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
  heli.hasMissiles = m.hasMissiles;
  heli.missileRate = m.missileRate;
  heli.missileDamage = m.missileDamage;
  heli.missileCooldown = 0;
  heli.flareDurMult = m.flareDurMult;
  heli.flareRadius = m.flareRadius;
  heli.lootMult = m.lootMult;
  heli.lootRadius = m.lootRadius;
  heli.lootQuality = m.lootQuality;
  heli.lootJackpot = m.lootJackpot;
  heli.extraCrates = m.extraCrates;
  heli.shakeResist = m.shakeResist;
  heli.noFlinch = m.noFlinch;
  heli.brakeMult = m.brakeMult;
  heli.hoverSpread = m.hoverSpread;
  heli.slowSpread = m.slowSpread;
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

/** Add XP; returns number of levels gained (each grants 2 skill points). */
export function gainXp(pilot, amount) {
  if (amount <= 0 || pilot.level >= 10) return 0;
  pilot.xp += amount;
  let levels = 0;
  while (pilot.level < 10 && pilot.xp >= xpToNext(pilot.level + 1)) {
    pilot.level += 1;
    pilot.skillPoints += 2;
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
    hangar: { cobra: emptyHangarTree() },
    unlocked: ['cobra'],
    gunship: 'cobra',
    campaign: { act: 1, sortie: 1 },
    prestige: 0,
    dossierKills: {},
    achievements: {},
    pilotsLost: 0,
    extracts: 0,
  };
}

export function loadCareer() {
  const roster = loadRoster();
  const slot = roster.slots.find((s) => s.id === roster.activeId) || roster.slots[0];
  if (slot?.career?.pilot) {
    syncGunshipUnlocks(slot.career);
    return slot.career;
  }
  const legacy = readJson(SAVE_KEY);
  return legacy?.pilot ? legacy : null;
}

export function saveCareer(career) {
  if (!career || career.sandbox) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(career));
  } catch {
    /* private mode etc. — play without persistence */
  }
  try {
    const roster = loadRoster();
    let slot = roster.slots.find((s) => s.id === roster.activeId);
    if (!slot && roster.slots.length) {
      slot = roster.slots[0];
      roster.activeId = slot.id;
    }
    if (!slot) {
      const id = newSlotId();
      slot = { id, lastPlayed: Date.now(), career };
      roster.slots.push(slot);
      roster.activeId = id;
    } else {
      slot.career = career;
      slot.lastPlayed = Date.now();
    }
    saveRoster(roster);
  } catch {
    /* ignore roster write */
  }
}

export function clearCareer() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

/** Wipe roster + legacy save. Caller boots a fresh career afterwards. */
export function wipeAllSaves() {
  try {
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem(ROSTER_KEY);
  } catch {
    /* ignore */
  }
}

export function recordDossierKill(career, className) {
  if (!career || !className) return;
  if (!career.dossierKills || typeof career.dossierKills !== 'object') career.dossierKills = {};
  career.dossierKills[className] = (career.dossierKills[className] || 0) + 1;
  const pilot = career.pilot;
  if (!pilot) return;
  if (!pilot.dossierKills || typeof pilot.dossierKills !== 'object') pilot.dossierKills = {};
  pilot.dossierKills[className] = (pilot.dossierKills[className] || 0) + 1;
  pilot.careerKills = (pilot.careerKills || 0) + 1;
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
    career.pilotsLost = (career.pilotsLost || 0) + 1;
    career.pilot = createPilot((Math.random() * 0xffffffff) >>> 0);
    career.pilot.sortiesFlown = keep.sortiesFlown;
    career.pilot.careerKills = keep.careerKills;
    career.campaign = { act: 1, sortie: 1 };
  } else {
    levelsGained = gainXp(career.pilot, xpEarned);
    if (status === 'complete') career.extracts = (career.extracts || 0) + 1;
  }

  evaluateAchievements(career);
  saveCareer(career);
  return { died, levelsGained };
}

/** Advance the four-act campaign after a completed campaign sortie. */
export function advanceCampaign(career) {
  const act = career.campaign?.act || 1;
  const sortie = career.campaign?.sortie || 1;
  if (sortie < 4) {
    career.campaign = { act, sortie: sortie + 1 };
    return { prestige: false, act: career.campaign.act, sortie: career.campaign.sortie };
  }
  if (act < 4) {
    career.campaign = { act: act + 1, sortie: 1 };
    syncGunshipUnlocks(career);
    evaluateAchievements(career);
    return { prestige: false, act: career.campaign.act, sortie: career.campaign.sortie };
  }

  career.prestige = (career.prestige || 0) + 1;
  career.campaign = { act: 1, sortie: 1 };
  career.pilot = createPilot((Math.random() * 0xffffffff) >>> 0);
  syncGunshipUnlocks(career);
  evaluateAchievements(career);
  return { prestige: true, act: 1, sortie: 1 };
}

/** Hangar purchase. Returns { ok, reason }. */
export function buyHangarLevel(career, slot) {
  const def = HANGAR_SLOTS[slot];
  if (!def) return { ok: false, reason: 'UNKNOWN SLOT' };
  if (slot === 'ordnance' && !gunshipHasMissiles(career.gunship)) {
    return { ok: false, reason: 'NO HARDPOINTS' };
  }
  const tree = career.hangar[career.gunship] || (career.hangar[career.gunship] = emptyHangarTree());
  career.hangar[career.gunship] = migrateHangarTree(tree);
  const live = career.hangar[career.gunship];
  const lvl = live[slot] || 0;
  if (lvl >= def.levels.length) return { ok: false, reason: 'MAX LEVEL' };
  const cost = def.levels[lvl].cost;
  if (career.dollars < cost) return { ok: false, reason: 'INSUFFICIENT FUNDS' };
  career.dollars -= cost;
  live[slot] = lvl + 1;
  evaluateAchievements(career);
  saveCareer(career);
  return { ok: true };
}

/** Spend one skill point on a pilot talent. */
export function levelSkill(career, skillId) {
  if (!career?.pilot) return { ok: false, reason: 'NO PILOT' };
  if (career.sandbox) return { ok: false, reason: 'RANGE PILOT IS FULLY RATED' };
  const def = PILOT_SKILLS.find((skill) => skill.id === skillId);
  if (!def) return { ok: false, reason: 'UNKNOWN SKILL' };
  migratePilotSkills(career.pilot);
  if (career.pilot.skillPoints <= 0) return { ok: false, reason: 'NO SKILL POINTS' };
  if ((career.pilot.skills[skillId] || 0) >= SKILL_MAX) return { ok: false, reason: 'MAX LEVEL' };
  career.pilot.skills[skillId] += 1;
  career.pilot.skillPoints -= 1;
  evaluateAchievements(career);
  saveCareer(career);
  return { ok: true, rank: career.pilot.skills[skillId] };
}

/** Free respec between sorties. */
export function respecSkills(career) {
  if (!career?.pilot || career.sandbox) return;
  migratePilotSkills(career.pilot);
  career.pilot.skillPoints += spentSkillPoints(career.pilot);
  career.pilot.skills = emptySkillMap();
  career.pilot.allocated = [];
  saveCareer(career);
}

export const ACHIEVEMENTS = [
  { id: 'first_blood', name: 'FIRST BLOOD', desc: 'Confirm a kill.' },
  { id: 'rtb', name: 'RTB', desc: 'Extract across the border.' },
  { id: 'wrench', name: 'WRENCH', desc: 'Fit a hangar part.' },
  { id: 'talent', name: 'TALENT', desc: 'Spend a skill point.' },
  { id: 'fifty', name: 'FIFTY CONFIRMED', desc: 'Log fifty kills.' },
  { id: 'new_ride', name: 'NEW RIDE', desc: 'Unlock a second airframe.' },
  { id: 'sector_clear', name: 'SECTOR CLEAR', desc: 'Finish an act.' },
  { id: 'next_pilot', name: 'NEXT PILOT', desc: 'A pilot is lost. The war continues.' },
];

export function achievementCount(career) {
  const unlocked = career?.achievements && typeof career.achievements === 'object' ? career.achievements : {};
  let n = 0;
  for (const row of ACHIEVEMENTS) if (unlocked[row.id]) n += 1;
  return n;
}

export function evaluateAchievements(career) {
  if (!career || career.sandbox) return [];
  if (!career.achievements || typeof career.achievements !== 'object') career.achievements = {};
  const newly = [];
  const unlock = (id) => {
    if (career.achievements[id]) return;
    career.achievements[id] = Date.now();
    newly.push(id);
  };
  const kills = career.pilot?.careerKills || 0;
  if (kills >= 1) unlock('first_blood');
  if (kills >= 50) unlock('fifty');
  if ((career.extracts || 0) >= 1) unlock('rtb');
  const hangar = career.hangar || {};
  let parts = 0;
  for (const tree of Object.values(hangar)) {
    if (!tree || typeof tree !== 'object') continue;
    for (const lvl of Object.values(tree)) if (lvl > 0) parts += 1;
  }
  if (parts >= 1) unlock('wrench');
  if (spentSkillPoints(career.pilot) >= 1) unlock('talent');
  if ((career.unlocked || []).length > 1) unlock('new_ride');
  if ((career.campaign?.act || 1) > 1 || (career.prestige || 0) > 0) unlock('sector_clear');
  if ((career.pilotsLost || 0) >= 1) unlock('next_pilot');
  return newly;
}

export { clamp };
