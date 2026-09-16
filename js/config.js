/** Centralized game constants. Every tunable number lives here. */

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

/** Act 1 operational area. Later acts use WORLD_SIZE_BY_ACT. */
export const WORLD_SIZE_BY_ACT = {
  1: 7200,
  2: 10800,
  3: 15200,
  4: 21000,
};
export const WORLD_SIZE = WORLD_SIZE_BY_ACT[1];
export const TILE_SIZE = 32;
export const CHUNK_SIZE = 32;
export const CHUNKS_PER_AXIS = Math.ceil(WORLD_SIZE / CHUNK_SIZE);
export const PLAYABLE_FRAC = 0.48;
export const EXTRACT_FRAC = 0.55;

export function worldSizeForAct(act = 1) {
  const n = Math.max(1, Math.min(4, Math.floor(Number(act) || 1)));
  return WORLD_SIZE_BY_ACT[n] || WORLD_SIZE;
}

function sizeOf(worldOrSize) {
  if (typeof worldOrSize === 'number' && Number.isFinite(worldOrSize)) return worldOrSize;
  if (Number.isFinite(worldOrSize?.worldSize)) return worldOrSize.worldSize;
  return WORLD_SIZE;
}

/** Soft wall until the objective is done. Crossing it after that extracts. */
export function playableLimit(worldOrSize) {
  return sizeOf(worldOrSize) * PLAYABLE_FRAC;
}

/** Extra slack past the border so the heli can actually leave. */
export function extractBound(worldOrSize) {
  return sizeOf(worldOrSize) * EXTRACT_FRAC;
}

export const PITCH_DEG = 24;

export const HELI = {
  accel: 760,
  drag: 0.91,
  maxSpeed: 220,
  turnSpeed: 1.55,
  brakeDrag: 0.8,
  // Cooldown seconds. 2 rds/sec at the start. Hangar mounts and Fear cards change the gun; skills do not.
  fireRate: 0.5,
  bulletSpeed: 400,
  bulletDamage: 5,
};

/** `?dev=1` shows unkilled dossier classes. Normal play hides them. */
export function isDevUnlock() {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).has('dev');
  } catch {
    return false;
  }
}

export const CAMERA = {
  lerpSpeed: 0.08,
  zoomMin: 0.5,
  zoomMax: 2.0,
  zoomDefault: 1.0,
  zoomCombat: 1.4,
  zoomExplore: 0.8,
  zoomLerp: 0.04,
  // Dynamic speed/combat zoom (sim tick)
  zoomSpeedNear: 1.1, // stationary / slow
  zoomSpeedFar: 0.75, // full speed
  zoomCombatFloor: 0.95, // minimum while firing at a target
};

/** Ground-combat tuning — aggro, leashes, civilian panic. */
export const COMBAT = {
  aggroBase: 330, // attack range at Heat tier 0
  aggroPerHeatTier: 25, // extra range per Heat tier
  alertExtra: 200, // alert band beyond aggro range
  leashInfantry: 480, // how far infantry pursue from their post
  leashVehicle: 900, // vehicles roam further
  leashGrace: 120, // alert grace beyond the leash
  returnHomeDist: 130, // beyond this, lost units walk back to post
  civilianPanicRadius: 500, // helo proximity that triggers panic (with combat)
  gunfireMemorySec: 4, // how long recent gunfire keeps civilians scared
  gunfireRadius: 900, // radius of that gunfire panic
};

/** HUD layout tuning. */
export const HUD = {
  scaleDivisor: 720, // uiScale = clamp(min(w,h)/this, 1, scaleMax)
  scaleMax: 1.85,
  narrowBreakpoint: 720, // W below this = stacked HUD layout
};

/**
 * Hunter ETA — live timer. Base time is scaled by difficulty/style/heat via
 * hunterClockRate() in sim/state.js. Some GDD fields are legacy (jammer etc.)
 * and kept for save compat but not wired to gameplay yet.
 */
export const TIMER = {
  baseTime: 165, // live — multiplied by difficulty.hunterEtaMultiplier & heatFactor
  jammerBonus: 60, // legacy — jammer meta upgrade not yet implemented
  maxJammerLevel: 3, // legacy
  fuelTankBonus: 20, // live — fuel depot chain explosion extends timer
  fuelTankerBonus: 10, // legacy — tanker subtype not separately spawned
  commandBuildingBonus: 30, // legacy — now merged into objective flow
  radarTowerBonus: 30, // legacy — radar disable reduces Heat instead
  bossSpawnDistance: 80, // legacy — Hunter now spawns via world-size ratio
  bossWarningTime: 5, // live — seconds of INCOMING warning
};

/** @deprecated — use FEAR_THRESHOLDS in sim/state.js. Kept for reference; values mirror live thresholds. */
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

/** Geometry-first Gulf generator. Older Site-based paths have been removed. */
export const WORLD_GEN_VERSION = 4;

/** Unarmed civilians who flee this far from their home post escape the
 * battle entirely and no longer affect contact resolution. */
export const CIVILIAN_ESCAPE_RADIUS = 900;
