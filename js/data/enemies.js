/**
 * Enemy type definitions and factory.
 * Uses class-based system: class determines category (infantry/vehicle/emplacement),
 * loadout (weapon) is resolved on discovery based on difficulty.
 */

import { ENEMY_CLASSES } from '../world.js';
import { mulberry32, seededRng, weightedPick, randFloat } from '../rng.js';

// ══════════════════════════════════════════════════════════════
//  WEAPON LOADOUTS — resolved per difficulty level
// ══════════════════════════════════════════════════════════════

// Difficulty tiers: 0-2 = early, 3-5 = mid, 6+ = late
// Higher difficulty = better weapons

const INFANTRY_WEAPONS = {
  0: [ // Easy
    { name: 'Pistol', damage: 2, range: 80, fireRate: 1.8, color: '#8a6a4a', bulletLife: 0.8 },
    { name: 'Rifle', damage: 3, range: 120, fireRate: 1.2, color: '#8a6a4a', bulletLife: 1.0 },
  ],
  3: [ // Mid
    { name: 'Assault Rifle', damage: 4, range: 150, fireRate: 0.8, color: '#7a5a3a', bulletLife: 1.1 },
    { name: 'MG', damage: 6, range: 200, fireRate: 0.4, color: '#6a5a3a', bulletLife: 1.3 },
    { name: 'RPG', damage: 15, range: 180, fireRate: 2.0, color: '#5a4a2a', bulletLife: 0.9 },
  ],
  6: [ // Late
    { name: 'SAW', damage: 8, range: 220, fireRate: 0.25, color: '#6a5a3a', bulletLife: 1.4 },
    { name: 'ATGM', damage: 25, range: 250, fireRate: 3.0, color: '#4a3a1a', bulletLife: 1.3 },
    { name: 'MANPADS', damage: 20, range: 300, fireRate: 3.0, color: '#4a3a1a', bulletLife: 1.8 },
  ],
};

const VEHICLE_WEAPONS = {
  0: [
    { name: 'MG Truck', damage: 5, range: 180, fireRate: 0.5, color: '#7a7a5a', bulletLife: 1.0 },
  ],
  3: [
    { name: 'Cannon Truck', damage: 10, range: 250, fireRate: 0.3, color: '#5a5a4a', bulletLife: 1.3 },
    { name: 'Shilka', damage: 10, range: 280, fireRate: 0.15, color: '#5a5a4a', bulletLife: 1.4 },
    { name: 'APC', damage: 8, range: 200, fireRate: 0.5, color: '#7a7a5a', bulletLife: 1.1 },
  ],
  6: [
    { name: 'Tank', damage: 25, range: 300, fireRate: 2.5, color: '#6a6a4a', bulletLife: 1.5 },
    { name: 'SAM', damage: 30, range: 400, fireRate: 4.0, color: '#5a6a5a', bulletLife: 2.0 },
  ],
};

const EMPLACEMENT_WEAPONS = {
  0: [
    { name: 'HMG', damage: 6, range: 200, fireRate: 0.4, color: '#6a5a3a', bulletLife: 1.2 },
  ],
  3: [
    { name: 'ZU-23', damage: 8, range: 250, fireRate: 0.3, color: '#6a6a5a', bulletLife: 1.3 },
  ],
  6: [
    { name: 'S-60', damage: 12, range: 300, fireRate: 0.2, color: '#5a6a5a', bulletLife: 1.5 },
  ],
};

const WEAPON_TABLES = {
  infantry: INFANTRY_WEAPONS,
  vehicle: VEHICLE_WEAPONS,
  emplacement: EMPLACEMENT_WEAPONS,
};

/** Get the appropriate weapon tier for a difficulty level. */
function getWeaponTier(difficulty) {
  if (difficulty >= 6) return 6;
  if (difficulty >= 3) return 3;
  return 0;
}

/** Resolve a weapon loadout for an enemy class at given difficulty. */
export function resolveLoadout(className, difficulty, seed) {
  const cls = ENEMY_CLASSES[className];
  if (!cls) return null;

  const tier = getWeaponTier(difficulty);
  const table = WEAPON_TABLES[cls.category] || WEAPON_TABLES.infantry;
  const options = table[tier] || table[0];

  const rng = mulberry32(seed);
  const weapon = options[Math.floor(rng() * options.length)];

  return {
    name: weapon.name,
    damage: weapon.damage,
    range: weapon.range,
    fireRate: weapon.fireRate,
    color: weapon.color,
    bulletLife: weapon.bulletLife || 1.5,
  };
}

// ══════════════════════════════════════════════════════════════
//  ENEMY CREATION
// ══════════════════════════════════════════════════════════════

/** Create an enemy instance with resolved loadout. */
export function createEnemy(className, x, y, difficulty, seed, entry = null) {
  const cls = ENEMY_CLASSES[className];
  if (!cls) return null;

  const weapon = resolveLoadout(className, difficulty, seed);

  return {
    className,
    x, y,
    hp: cls.hp,
    maxHp: cls.hp,
    speed: cls.speed,
    damage: weapon.damage,
    range: weapon.range,
    fireRate: weapon.fireRate,
    fireCooldown: 0,
    points: cls.points,
    color: weapon.color,
    size: cls.size,
    behavior: cls.behavior,
    category: cls.category,
    weaponName: weapon.name,
    bulletLife: weapon.bulletLife,
    angle: seededRng(`enemy-angle:${seed}`)() * Math.PI * 2,
    id: entry?.id || `enemy-${Math.floor(x)}-${Math.floor(y)}-${className}`,
    objectiveTarget: Boolean(entry?.objectiveTarget),
    vx: 0, vy: 0,
    state: 'idle',
    alertTimer: 0,
    deathTimer: 0,
    flashTimer: 0,
  };
}

/** Create an enemy from a worldgen roster entry. */
export function createEnemyFromRoster(entry, villageX, villageY, difficulty) {
  const seed = `${entry.id || entry.className}:${difficulty}:${Math.floor(villageX)}:${Math.floor(villageY)}`;
  const x = villageX + entry.offsetX;
  const y = villageY + entry.offsetY;
  const enemy = createEnemy(entry.className, x, y, difficulty, seed, entry);
  if (enemy) {
    // Home site position — fleeing civilians escape once beyond
    // CIVILIAN_ESCAPE_RADIUS from here.
    enemy.homeX = x;
    enemy.homeY = y;
  }
  return enemy;
}
