/**
 * Enemy class catalogue.
 *
 * Counts and placement belong to world encounters; this module only defines
 * the simulation/render characteristics of each class.
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
  },
  rifleman: {
    hp: 15,
    speed: 30,
    points: 10,
    color: '#8a6a4a',
    size: 4,
    behavior: 'patrol',
    category: 'infantry',
  },
  assault: {
    hp: 20,
    speed: 35,
    points: 15,
    color: '#7a5a3a',
    size: 4,
    behavior: 'ambush',
    category: 'infantry',
  },
  mg: {
    hp: 25,
    speed: 0,
    points: 20,
    color: '#6a5a3a',
    size: 5,
    behavior: 'guard',
    category: 'infantry',
  },
  rpg: {
    hp: 18,
    speed: 25,
    points: 25,
    color: '#5a4a2a',
    size: 4,
    behavior: 'ambush',
    category: 'infantry',
  },
  manpads: {
    hp: 15,
    speed: 20,
    points: 40,
    color: '#4a3a1a',
    size: 4,
    behavior: 'guard',
    category: 'infantry',
  },
  lightAA: {
    hp: 40,
    speed: 0,
    points: 30,
    color: '#6a6a5a',
    size: 6,
    behavior: 'fixed',
    category: 'emplacement',
  },
  shilka: {
    hp: 60,
    speed: 40,
    points: 50,
    color: '#5a5a4a',
    size: 8,
    behavior: 'escort',
    category: 'vehicle',
  },
  tank: {
    hp: 120,
    speed: 25,
    points: 75,
    color: '#6a6a4a',
    size: 10,
    behavior: 'patrol',
    category: 'vehicle',
  },
  apc: {
    hp: 80,
    speed: 35,
    points: 40,
    color: '#7a7a5a',
    size: 9,
    behavior: 'escort',
    category: 'vehicle',
  },
  sam: {
    hp: 50,
    speed: 30,
    points: 60,
    color: '#5a6a5a',
    size: 8,
    behavior: 'mobile_def',
    category: 'vehicle',
  },
  technical: {
    hp: 45,
    speed: 55,
    points: 25,
    color: '#7a6040',
    size: 7,
    behavior: 'patrol',
    category: 'vehicle',
  },
};

export function classToEnemyType(className) {
  return ENEMY_CLASSES[className] ? className : 'rifleman';
}
