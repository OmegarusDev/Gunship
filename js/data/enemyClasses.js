/**
 * Enemy class catalogue from GAME_DESIGN.md Appendix B, tuned to the
 * live gun (5 dmg, 2 rds/sec stock). Counts and placement belong to
 * world encounters; this module is simulation/render/dossier data.
 *
 * minAct gates field spawns. Dossier regulars hide until killed unless
 * ?dev=1. Bosses are a separate red row — see js/data/bosses.js.
 */
export const ENEMY_CLASSES = {
  unarmed: {
    hp: 8,
    speed: 20,
    points: 5,
    color: '#a08060',
    size: 3,
    behavior: 'patrol',
    category: 'infantry',
    minAct: 1,
    blurb: 'Unarmed. They run. Confirming them still logs a contact.',
  },
  rifleman: {
    hp: 15,
    speed: 30,
    points: 10,
    color: '#8a6a4a',
    size: 4,
    behavior: 'guard',
    category: 'infantry',
    minAct: 1,
    blurb: '7.62 rifle. The baseline infantryman.',
  },
  assault: {
    hp: 18,
    speed: 35,
    points: 15,
    color: '#7a5a3a',
    size: 4,
    behavior: 'patrol',
    category: 'infantry',
    minAct: 1,
    blurb: 'AK-pattern. Faster feet, faster trigger, thinner hull.',
  },
  mg: {
    hp: 22,
    speed: 22,
    points: 20,
    color: '#6a5a3a',
    size: 5,
    behavior: 'guard',
    category: 'infantry',
    minAct: 1,
    blurb: 'Belt-fed 7.62. Holds a post and hoses the approach.',
  },
  rpg: {
    hp: 18,
    speed: 25,
    points: 25,
    color: '#5a4a2a',
    size: 4,
    behavior: 'ambush',
    category: 'infantry',
    minAct: 1,
    blurb: 'RPG. Slow rocket, ugly if it connects.',
  },
  hmg: {
    hp: 32,
    speed: 0,
    points: 28,
    color: '#4a4a3a',
    size: 6,
    behavior: 'fixed',
    category: 'emplacement',
    minAct: 2,
    blurb: '12.7/14.5 on sandbags. Fixed. Reaches farther than a rifle.',
  },
  manpads: {
    hp: 16,
    speed: 22,
    points: 40,
    color: '#4a3a1a',
    size: 4,
    behavior: 'ambush',
    category: 'infantry',
    minAct: 2,
    blurb: 'SA-7 class. Hidden until the smoke trail. One hit hurts.',
  },
  lightAA: {
    hp: 40,
    speed: 0,
    points: 30,
    color: '#6a6a5a',
    size: 6,
    behavior: 'fixed',
    category: 'emplacement',
    minAct: 1,
    blurb: 'ZU-23. Twin barrels, sandbag pit, wall of tracers.',
  },
  twin23: {
    hp: 52,
    speed: 0,
    points: 38,
    color: '#5a5a4a',
    size: 7,
    behavior: 'fixed',
    category: 'emplacement',
    minAct: 2,
    blurb: 'Twin 23mm. Heavier bite than a ZU pit, still bolted down.',
  },
  aaTruck: {
    hp: 48,
    speed: 48,
    points: 36,
    color: '#6a5038',
    size: 7,
    behavior: 'mobile_def',
    category: 'vehicle',
    minAct: 2,
    blurb: 'Truck-mounted twin 23. Same guns as the pit, but it relocates.',
  },
  technical: {
    hp: 42,
    speed: 55,
    points: 25,
    color: '#7a6040',
    size: 7,
    behavior: 'patrol',
    category: 'vehicle',
    minAct: 1,
    blurb: 'Gun truck. Fast, thin, DShK in the bed.',
  },
  apc: {
    hp: 80,
    speed: 38,
    points: 40,
    color: '#7a7a5a',
    size: 9,
    behavior: 'escort',
    category: 'vehicle',
    minAct: 2,
    blurb: 'BMP/BTR pattern. Carries a cannon and the squad.',
  },
  shilka: {
    hp: 70,
    speed: 40,
    points: 50,
    color: '#5a5a4a',
    size: 8,
    behavior: 'mobile_def',
    category: 'vehicle',
    minAct: 3,
    blurb: 'ZSU-23-4. Four barrels and a radar dish. Do not hover in the bubble.',
  },
  heavyAA: {
    hp: 90,
    speed: 0,
    points: 55,
    color: '#3a3a32',
    size: 9,
    behavior: 'fixed',
    category: 'emplacement',
    minAct: 4,
    blurb: 'S-60 57mm. Slow thump, long reach, revetted battery.',
  },
  sam: {
    hp: 62,
    speed: 32,
    points: 60,
    color: '#5a6a5a',
    size: 8,
    behavior: 'mobile_def',
    category: 'vehicle',
    minAct: 3,
    blurb: 'SA-8/SA-9 class. Missile warning if you live long enough to hear it.',
  },
  tank: {
    hp: 120,
    speed: 26,
    points: 75,
    color: '#6a6a4a',
    size: 10,
    behavior: 'escort',
    category: 'vehicle',
    minAct: 3,
    blurb: 'T-series hull. Slow, thick, the main gun will ruin a hover.',
  },
};

export const ENEMY_CLASS_ORDER = [
  'rifleman',
  'assault',
  'mg',
  'rpg',
  'hmg',
  'manpads',
  'unarmed',
  'lightAA',
  'twin23',
  'aaTruck',
  'technical',
  'apc',
  'shilka',
  'heavyAA',
  'sam',
  'tank',
];

export const ENEMY_CLASS_LABELS = {
  unarmed: 'CIVILIAN',
  rifleman: 'RIFLEMAN',
  assault: 'ASSAULT',
  mg: 'GUNNER',
  rpg: 'RPG',
  hmg: 'HMG',
  manpads: 'MANPADS',
  lightAA: 'LIGHT AA',
  twin23: 'TWIN 23',
  aaTruck: 'AA TRUCK',
  technical: 'TECHNICAL',
  apc: 'APC',
  shilka: 'SHILKA',
  heavyAA: '57mm AA',
  sam: 'SAM',
  tank: 'TANK',
};

export const AA_CLASSES = ['lightAA', 'twin23', 'aaTruck', 'manpads', 'hmg', 'shilka', 'heavyAA', 'sam'];

export function classToEnemyType(className) {
  return ENEMY_CLASSES[className] ? className : 'rifleman';
}

export function isVehicleClass(className) {
  return ENEMY_CLASSES[className]?.category === 'vehicle';
}

export function classMinAct(className) {
  return ENEMY_CLASSES[className]?.minAct || 1;
}

export function classesForAct(act = 1) {
  const n = Math.max(1, Math.floor(act) || 1);
  return ENEMY_CLASS_ORDER.filter((id) => classMinAct(id) <= n);
}
