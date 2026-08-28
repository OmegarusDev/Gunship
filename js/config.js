/** Centralized game constants. Every tunable number lives here. */

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

export const WORLD_SIZE = 6000;
export const TILE_SIZE = 32;
export const CHUNK_SIZE = 32;
export const CHUNKS_PER_AXIS = Math.ceil(WORLD_SIZE / CHUNK_SIZE);

/** World-gen version — safe fork for the streets rebuild. 1 = blobs-on-roads (prototype, main), 2 = streets form settlements (feature/streets). */
export const WORLD_GEN_VERSION = 2;

export const PITCH_DEG = 24;

export const HELI = {
  accel: 1400,
  drag: 0.91,
  maxSpeed: 400,
  turnSpeed: 3.5,
  brakeDrag: 0.8,
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
  scaleMax: 1.7,
  narrowBreakpoint: 720, // W below this = stacked HUD layout
};

/**
 * Hunter ETA — live timer. Base time is scaled by difficulty/style/heat via
 * hunterClockRate() in sim/state.js. Some GDD fields are legacy (jammer etc.)
 * and kept for save compat but not wired to gameplay yet.
 */
export const TIMER = {
  baseTime: 180, // live — multiplied by difficulty.hunterEtaMultiplier & heatFactor
  jammerBonus: 60, // legacy — jammer meta upgrade not yet implemented
  maxJammerLevel: 3, // legacy
  clearPenalties: { rural: 15, town: 30, camp: 20, base: 45 }, // legacy — now drives Heat, not direct timer
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

export const SETTLEMENT_DETECTION_RADIUS = 80;

/** Unarmed civilians who flee this far from their home site escape the
 *  battle entirely (removed, no longer block clearing the settlement). */
export const CIVILIAN_ESCAPE_RADIUS = 900;
