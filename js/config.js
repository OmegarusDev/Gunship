/** Centralized game constants. Every tunable number lives here. */

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

export const WORLD_SIZE = 6000;
export const TILE_SIZE = 32;
export const CHUNK_SIZE = 32;
export const CHUNKS_PER_AXIS = Math.ceil(WORLD_SIZE / CHUNK_SIZE);

export const PITCH_DEG = 24;

export const HELI = {
  accel: 1400,
  drag: 0.91,
  maxSpeed: 400,
  turnSpeed: 3.5,
  brakeDrag: 0.80,
  fireRate: 3,
  bulletSpeed: 500,
  bulletDamage: 10,
};

export const CAMERA = {
  lerpSpeed: 0.08,
  zoomMin: 0.5,
  zoomMax: 2.0,
  zoomDefault: 1.0,
  zoomCombat: 1.4,
  zoomExplore: 0.8,
  zoomLerp: 0.04,
};

export const TIMER = {
  baseTime: 180,
  jammerBonus: 60,
  maxJammerLevel: 3,
  clearPenalties: { rural: 15, town: 30, camp: 20, base: 45 },
  fuelTankBonus: 20,
  fuelTankerBonus: 10,
  commandBuildingBonus: 30,
  radarTowerBonus: 30,
  bossSpawnDistance: 80,
  bossWarningTime: 5,
};

export const INFAMY = [
  { level: 0, threshold: 0 },
  { level: 1, threshold: 10 },
  { level: 2, threshold: 25 },
  { level: 3, threshold: 50 },
  { level: 4, threshold: 85 },
  { level: 5, threshold: 130 },
  { level: 6, threshold: 190 },
  { level: 7, threshold: 270 },
  { level: 8, threshold: 370 },
  { level: 9, threshold: 500 },
  { level: 10, threshold: 660 },
];

export const PILOT_XP = [
  { level: 1, xpToNext: 0 },
  { level: 2, xpToNext: 100 },
  { level: 3, xpToNext: 250 },
  { level: 4, xpToNext: 500 },
  { level: 5, xpToNext: 850 },
  { level: 6, xpToNext: 1300 },
  { level: 7, xpToNext: 1900 },
  { level: 8, xpToNext: 2600 },
  { level: 9, xpToNext: 3500 },
  { level: 10, xpToNext: 5000 },
];

export const SETTLEMENT_DETECTION_RADIUS = 80;

/** Unarmed civilians who flee this far from their home site escape the
 *  battle entirely (removed, no longer block clearing the settlement). */
export const CIVILIAN_ESCAPE_RADIUS = 900;
