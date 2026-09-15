/**
 * Enemy type definitions and factory.
 * Class determines category, hull, and the weapon that class actually carries.
 * Contract/radial difficulty then scales that loadout — it does not swap a
 * tank onto a truck MG.
 */

import { ENEMY_CLASSES } from './enemyClasses.js';
import { seededRng } from '../rng.js';

const CLASS_WEAPONS = {
  unarmed: {
    name: 'Unarmed',
    damage: 0,
    range: 0,
    fireRate: 9,
    color: '#a08060',
    bulletLife: 0.4,
    bulletSpeed: 0,
  },
  rifleman: {
    name: 'Rifle',
    damage: 8,
    range: 170,
    fireRate: 0.85,
    color: '#8a6a4a',
    bulletLife: 1.2,
    bulletSpeed: 260,
  },
  assault: {
    name: 'Assault Rifle',
    damage: 7,
    range: 160,
    fireRate: 0.42,
    color: '#7a5a3a',
    bulletLife: 1.15,
    bulletSpeed: 270,
  },
  mg: {
    name: 'MG',
    damage: 9,
    range: 230,
    fireRate: 0.2,
    color: '#6a5a3a',
    bulletLife: 1.35,
    bulletSpeed: 280,
  },
  rpg: {
    name: 'RPG',
    damage: 28,
    range: 210,
    fireRate: 2.1,
    color: '#5a4a2a',
    bulletLife: 1.2,
    bulletSpeed: 240,
  },
  manpads: {
    name: 'MANPADS',
    damage: 34,
    range: 340,
    fireRate: 2.7,
    color: '#4a3a1a',
    bulletLife: 2.0,
    bulletSpeed: 300,
  },
  lightAA: {
    name: 'ZU-23',
    damage: 12,
    range: 280,
    fireRate: 0.26,
    color: '#6a6a5a',
    bulletLife: 1.4,
    bulletSpeed: 300,
  },
  technical: {
    name: 'DShK',
    damage: 12,
    range: 220,
    fireRate: 0.26,
    color: '#7a6040',
    bulletLife: 1.25,
    bulletSpeed: 280,
  },
  apc: {
    name: 'APC Cannon',
    damage: 18,
    range: 240,
    fireRate: 0.55,
    color: '#7a7a5a',
    bulletLife: 1.3,
    bulletSpeed: 290,
  },
  shilka: {
    name: 'Shilka',
    damage: 7,
    range: 310,
    fireRate: 0.12,
    color: '#5a5a4a',
    bulletLife: 1.45,
    bulletSpeed: 320,
  },
  tank: {
    name: 'Tank Cannon',
    damage: 42,
    range: 340,
    fireRate: 2.15,
    color: '#6a6a4a',
    bulletLife: 1.7,
    bulletSpeed: 340,
  },
  sam: {
    name: 'SAM',
    damage: 48,
    range: 440,
    fireRate: 3.1,
    color: '#5a6a5a',
    bulletLife: 2.2,
    bulletSpeed: 360,
  },
};

/** Resolve the weapon this class fires, then scale it with radial difficulty. */
export function resolveLoadout(className, difficulty) {
  const cls = ENEMY_CLASSES[className];
  if (!cls) return null;
  const weapon = CLASS_WEAPONS[className] || CLASS_WEAPONS.rifleman;
  const t = Number.isFinite(difficulty) ? difficulty : 1;
  const dmgScale = 1 + 0.14 * Math.max(0, t - 1);
  return {
    name: weapon.name,
    damage: Math.max(0, Math.round(weapon.damage * dmgScale)),
    range: weapon.range,
    fireRate: weapon.fireRate,
    color: weapon.color,
    bulletLife: weapon.bulletLife || 1.5,
    bulletSpeed: weapon.bulletSpeed || 260,
  };
}

/** Create an enemy instance with resolved loadout. */
export function createEnemy(className, x, y, difficulty, seed, entry = null) {
  const cls = ENEMY_CLASSES[className];
  if (!cls) return null;

  const weapon = resolveLoadout(className, difficulty);

  return {
    className,
    x,
    y,
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
    bulletSpeed: weapon.bulletSpeed,
    angle: seededRng(`enemy-angle:${seed}`)() * Math.PI * 2,
    id: entry?.id || `enemy-${Math.floor(x)}-${Math.floor(y)}-${className}`,
    objectiveTarget: Boolean(entry?.objectiveTarget),
    vx: 0,
    vy: 0,
    state: 'idle',
    alertTimer: 0,
    deathTimer: 0,
    flashTimer: 0,
  };
}

/**
 * Create an enemy from a worldgen roster entry.
 *
 * V4 encounter rosters carry absolute positions. The origin/offset fallback
 * keeps old generated worlds usable while the compatibility flag exists.
 */
export function createEnemyFromRoster(entry, originX = 0, originY = 0, difficulty = 0) {
  const x = Number.isFinite(entry.x) ? entry.x : originX + (entry.offsetX || 0);
  const y = Number.isFinite(entry.y) ? entry.y : originY + (entry.offsetY || 0);
  const seed = `${entry.id || entry.className}:${difficulty}:${Math.floor(x)}:${Math.floor(y)}`;
  const enemy = createEnemy(entry.className, x, y, difficulty, seed, entry);
  if (enemy) {
    enemy.homeX = x;
    enemy.homeY = y;
    enemy.encounterId = entry.encounterId || null;
    enemy.placeId = entry.placeId || null;
    enemy.districtId = entry.districtId || null;
    enemy.parcelId = entry.parcelId || null;
    enemy.post = entry.post || 'street';
  }
  return enemy;
}
