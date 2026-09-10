/**
 * Entry point — game loop, screen router, DPR-aware canvas.
 */
console.log('[Gunship] app.js loading...');

import { SIM_DT, WORLD_SIZE, TIMER, HUD } from './config.js';
import { WorldCamera } from './camera.js';
import { Input } from './input.js';
import { P, mats } from './palette.js';
import { VIEW25, deckRy } from './view25.js';
import { cyl25, box25, frustum25 } from './prims25.js';
import { withAlpha, fillCircle, drawLine, drawTextShadow } from './drawUtil.js';
import { mulberry32, clamp, pick } from './rng.js';
import { createNoise } from './noise.js';
import { generateWorld } from './world.js';
import { createTerrain } from './terrain.js';
import {
  drawCornerBrackets,
  drawBackButton,
  drawMenuButton,
  drawPanel,
  layoutOf,
  paintBackdrop,
  paintScreenBackdrop,
  footerPairRects,
  fearUpgradeRects,
  setMenuPointer,
  menuCursor,
  applyMenuHitTransform,
  paintMenuGlow,
} from './appBridge.js';
import {
  metaState,
  loadCareer,
  commitSortieOutcome,
  applyCareerToHeli,
  gainXp,
  xpToNext,
  saveCareer,
  syncGunshipUnlocks,
} from './meta.js';
import { hangarScreen, pilotScreen, handleHangarClick, handlePilotClick } from './screens_meta.js';
import {
  splashScreen,
  menuScreen,
  newPilotScreen,
  loadPilotScreen,
  hitFlowBox,
  confirmNewPilot,
  continueCareer,
  loadSlot,
  hideNameField,
  applyFlowBox,
} from './screens_flow.js';
import { createEnemyFromRoster } from './data/enemies.js';
import {
  createContractBoard,
  getDifficulty as getDifficultyProfile,
  getScenario,
  getStyle,
} from './contracts.js';
import { createUpgradeChoices } from './upgrades.js';
import {
  FEAR_THRESHOLDS as _FEAR_THRESHOLDS,
  HEAT_LABELS as _HEAT_LABELS,
  EQUIPMENT as _EQUIPMENT,
  hunterClockRate as _hunterClockRate,
} from './sim/state.js';
import {
  nearestRoadPoint as _nearestRoadPoint,
  steerAlongRoads as _steerAlongRoads,
  vehicleSpeedFactor as _vehicleSpeedFactor,
  pointAlongRoute as _pointAlongRoute,
  getConvoyMembers as _getConvoyMembers,
} from './sim/movement.js';
import {
  isTargetAlive as _isTargetAlive,
  objectiveComplete as _objectiveComplete,
  canExtract as _canExtract,
  getObjectiveFocus as _getObjectiveFocus,
  nearestExitPoint as _nearestExitPoint,
} from './sim/objectives.js';
import {
  setTerrain as _setTerrain,
  drawSmoothTerrain as _drawSmoothTerrain,
} from './render/terrain.js';
import { drawRoads as _drawRoads, getMiniRoads as _getMiniRoads } from './render/roads.js';
import {
  hudPlate as _hudPlate,
  plateHeader as _plateHeader,
  hudBar as _hudBar,
  drawOffscreenMarker as _drawOffscreenMarker,
} from './render/hud.js';
import {
  drawBuilding as _drawBuilding,
  drawPlaces as _drawPlaces,
  drawWorldGround as _drawWorldGround,
  drawDecorations as _drawDecorations,
  drawScenarioOverlays as _drawScenarioOverlays,
  setWorldState as _setWorldState,
} from './render/world.js';
import {
  drawHeliShadow as _drawHeliShadow,
  drawGunship as _drawGunship,
  drawEnemy as _drawEnemy,
  drawBoss as _drawBoss,
  drawHunter as _drawHunter,
  setBoss as _setBoss,
} from './render/entities.js';
import * as GameState from './sim/gameState.js';
import { tickSortie } from './sim/sortieTick.js';

const canvas = document.getElementById('game');
const camera = new WorldCamera(canvas);
const input = new Input(canvas);

const screens = {};
let currentScreen = null;

export function registerScreen(name, screen) {
  screens[name] = screen;
}

export function switchScreen(name, data) {
  if (currentScreen && currentScreen.exit) currentScreen.exit();
  currentScreen = screens[name];
  if (currentScreen && currentScreen.enter) currentScreen.enter(data);
}

function adoptCareer(career) {
  if (!career) return false;
  GameState.setCareer(career);
  metaState.career = career;
  return true;
}

let accumulator = 0;
let lastTime = performance.now();
let htmlSplashDismissed = false;

function dismissHtmlSplash() {
  if (htmlSplashDismissed || typeof document === 'undefined') return;
  const el = document.getElementById('html-splash');
  if (el) el.classList.add('gone');
  htmlSplashDismissed = true;
}

function loop(now) {
  try {
    const rawDt = (now - lastTime) / 1000;
    lastTime = now;
    const dt = Math.min(rawDt, 0.1);
    input.tick();
    if (input.pause) toggleSettings();
    if (settingsOpen && input.abandon && currentScreen === screens.sortie) abandonSortie();
    accumulator += dt;
    let safety = 0;
    while (accumulator >= SIM_DT && safety < 8) {
      if (!settingsOpen && !sortieState.levelUpOpen && currentScreen && currentScreen.tick) {
        const ev = currentScreen.tick(SIM_DT);
        if (ev && ev.type === 'switch') switchScreen(ev.name);
      }
      accumulator -= SIM_DT;
      safety++;
    }
    // Preserve sub-tick remainder for determinism; clamp spiral on long hitches
    if (accumulator > 0.1) accumulator = 0;
    accumulator = Math.max(0, accumulator);
    input.consumeOneShots();
    camera.tick(dt);
    camera.clear(camera.ctx, '#1a1a0a');
    setMenuPointer(input.mouseX, input.mouseY, {
      down: input.pointerDown,
      inside: input.mouseOnScreen,
    });
    if (currentScreen && currentScreen.draw) {
      currentScreen.draw(camera.ctx, camera, dt);
    }
    input.draw(camera.ctx);
    const fps = rawDt > 0 ? Math.round(1 / rawDt) : 0;
    GameState.setLastFps(fps);

    // ── Settings overlay ──
    if (settingsOpen) {
      drawSettings(camera.ctx, camera);
    }
    canvas.style.cursor =
      currentScreen !== screens.sortie || settingsOpen || sortieState.levelUpOpen
        ? menuCursor()
        : 'default';
    dismissHtmlSplash();
  } catch (err) {
    console.error('[Gunship]', err);
    if (typeof window !== 'undefined' && typeof window.showBootError === 'function') {
      window.showBootError(err);
    }
  }
  requestAnimationFrame(loop);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

let settingsOpen = false;
const IS_TOUCH = typeof window !== 'undefined' && 'ontouchstart' in window;
// Sortie clock, FPS, equipment, and gunfire memory live on GameState.

// ── Equipment — one usable item per sortie, chosen at briefing (now from sim/state) ────────────
const EQUIPMENT = _EQUIPMENT;
let briefingBackBox = null;
let briefingLaunchBox = null;
let contractsBackBox = null;
let debriefNextBox = null;
let debriefPilotBox = null;

// ── Road network queries — delegated to sim/movement (app.js stays thin) ──
let _roadSegsCache = null; // legacy shim — movement.js owns the real cache
let _miniRoadsCache = null; // minimap road layer now via render/roads
function getRoadSegs() {
  return null;
} // shim retained for any legacy callers
function nearestRoadPoint(x, y, maxDist) {
  return _nearestRoadPoint(world, x, y, maxDist);
}
function steerAlongRoads(desiredAngle, x, y) {
  return _steerAlongRoads(world, desiredAngle, x, y);
}
const TERRAIN_VEHICLE_SPEED = {
  hardpack: 1.1,
  sand: 1.0,
  gravel: 0.95,
  wadi: 0.9,
  oasis: 0.7,
  dunes: 0.6,
  rock: 0.5,
};
function vehicleSpeedFactor(x, y) {
  return _vehicleSpeedFactor(world, sharedTerrain, x, y);
}
const CONVOY_GAP_VEH = 30,
  CONVOY_GAP_INF = 17;
function pointAlongRoute(convoy, s) {
  return _pointAlongRoute(convoy, s);
}
function getConvoyMembers(convoy) {
  return _getConvoyMembers(convoy);
}

function toggleSettings() {
  settingsOpen = !settingsOpen;
}

// ══════════════════════════════════════════════════════════════
//  WORLD RENDERING — terrain, roads, physical places
// ══════════════════════════════════════════════════════════════

// Same object as GameState.world / GameState.sharedTerrain after initWorld.
let world = null;
let sharedTerrain = null;
const worldgenParams =
  typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const worldgenSeedText = worldgenParams.get('seed');
const worldgenSeedOverride = worldgenSeedText === null ? Number.NaN : Number(worldgenSeedText);
const debugWorldgen = worldgenParams.get('worldDebug') === '1';

let metaReturnScreen = 'title'; // hangar/pilot BACK returns here
let terrainNoise = null;
let moistureNoise = null;
let detailNoise = null;

const sortieState = GameState.sortieState; // shared

/** Pre-rendered minimap road layer at a given size (cached per world). */
function getMiniRoads(S) {
  return _getMiniRoads(world, S);
}
// minimap road cache now in render/roads.js

function initWorld(contract = null) {
  const seed = Number.isFinite(worldgenSeedOverride) ? worldgenSeedOverride : (contract?.seed ?? 42);
  sharedTerrain = createTerrain(seed, WORLD_SIZE);
  world = generateWorld({ seed, contract, terrain: sharedTerrain });
  world.debugWorldgen = debugWorldgen;
  _roadSegsCache = null;
  _miniRoadsCache = null;
  terrainNoise = createNoise(seed);
  moistureNoise = createNoise(seed + 777);
  detailNoise = createNoise(seed + 333);
  _setTerrain(sharedTerrain, terrainNoise, moistureNoise, detailNoise);
  GameState.setWorld(world);
  GameState.setSharedTerrain(sharedTerrain);
  GameState.setNoises(terrainNoise, moistureNoise, detailNoise);
}

/** Spawn visible sentries and mobile contacts when a sortie begins. */
function spawnOutdoorEnemies() {
  if (!world) return;
  for (const encounter of world.encounters) {
    const difficulty = getDifficultyForEnemy(encounter.x, encounter.y);
    for (const entry of encounter.roster) {
      if (entry.isIndoor) continue;
      const enemy = createEnemyFromRoster(entry, 0, 0, difficulty);
      if (enemy) {
        enemy.encounterId = encounter.id;
        enemy.placeId = encounter.placeId;
        enemy.isIndoor = false;
        applyEnemyDifficulty(enemy);
        enemies.push(enemy);
        entry.active = true;
      }
    }
  }
}

function getDifficultyForEnemy(worldX, worldY) {
  const dist = Math.hypot(worldX, worldY);
  const difficulty = getDifficultyProfile(GameState.activeContract?.difficultyId);
  return (1 + dist / 2500) * difficulty.radialMultiplier;
}

function applyEnemyDifficulty(enemy) {
  const difficulty = getDifficultyProfile(GameState.activeContract?.difficultyId);
  enemy.maxHp = Math.max(1, Math.round(enemy.maxHp * difficulty.enemyHpMultiplier));
  enemy.hp = enemy.maxHp;
  enemy.damage = Math.max(1, enemy.damage * difficulty.enemyDamageMultiplier);
}

// ── Terrain rendering — delegated to render/terrain.js ──
function drawSmoothTerrain(ctx, cam) {
  return _drawSmoothTerrain(ctx, cam);
}
// BIOME, sampleTerrain, updateTerrainGrid, grain/mottle/macro live in render/terrain.js
// Call _setTerrain(sharedTerrain, terrainNoise, moistureNoise, detailNoise) after initWorld.

// ── Roads — delegated to render/roads.js ──
function drawRoads(ctx, cam) {
  return _drawRoads(ctx, cam, world);
}
// ROAD_STYLE + shadeHex now live in render/roads.js

function drawPlaces(ctx, cam) {
  _setWorldState(world, heli, enemies, boss);
  return _drawPlaces(ctx, cam);
}

function drawWorldGround(ctx, cam) {
  _setWorldState(world, heli, enemies, boss);
  return _drawWorldGround(ctx, cam);
}

function drawDecorations(ctx, cam) {
  _setWorldState(world, heli, enemies, boss);
  return _drawDecorations(ctx, cam);
}

function drawScenarioOverlays(ctx, cam) {
  _setWorldState(world, heli, enemies, boss);
  return _drawScenarioOverlays(ctx, cam);
}

function drawBuilding(ctx, b) {
  return _drawBuilding(ctx, b);
}

function drawHeliShadow(ctx, h) {
  return _drawHeliShadow(ctx, h);
}

function drawGunship(ctx, h) {
  return _drawGunship(ctx, h);
}

// ══════════════════════════════════════════════════════════════
//  PROJECTILES
// ══════════════════════════════════════════════════════════════

const projectiles = GameState.projectiles; // shared
const explosions = GameState.explosions; // shared

function spawnProjectile(x, y, angle, speed, damage, isEnemy = false, life = 2.0) {
  projectiles.push({
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    damage,
    isEnemy,
    life,
    trail: [],
  });
}

function spawnExplosion(x, y, size = 1) {
  explosions.push({ x, y, size, life: 0.4, maxLife: 0.4 });
}

// ══════════════════════════════════════════════════════════════
//  ENEMIES — encounter-centric spawning
// ══════════════════════════════════════════════════════════════

const enemies = GameState.enemies; // shared
const floatingTexts = GameState.floatingTexts; // shared // CLEAR! popups and damage numbers

/** Calculate difficulty multiplier based on distance from center. */
function getDifficulty(worldX, worldY) {
  const dist = Math.hypot(worldX, worldY);
  const difficulty = getDifficultyProfile(GameState.activeContract?.difficultyId);
  return (1 + dist / 2500) * difficulty.radialMultiplier;
}

/** Discover an occupied district or field position and activate its hidden roster. */
function discoverEncounter(encounter) {
  if (encounter.discovered) return;
  encounter.discovered = true;
  encounter.state = 'active';
  sortieState.stats.encounters++;
  const place = world.places.find((candidate) => candidate.id === encounter.placeId);
  if (place) place.discovered = true;

  const difficulty = getDifficulty(encounter.x, encounter.y);

  for (const entry of encounter.roster) {
    if (!entry.isIndoor) continue;
    try {
      const enemy = createEnemyFromRoster(entry, 0, 0, difficulty);
      if (enemy) {
        enemy.encounterId = encounter.id;
        enemy.placeId = encounter.placeId;
        enemy.isIndoor = true;
        applyEnemyDifficulty(enemy);
        enemies.push(enemy);
        entry.active = true;
      }
    } catch (err) {
      console.error('[SPAWN ERROR]', entry.className, err);
    }
  }
}

/** Check if an individual contact has been secured. */
function checkEncounterClear(encounter) {
  if (encounter.cleared) return false;
  const alive = enemies.filter(
    (enemy) =>
      enemy.encounterId === encounter.id && enemy.className !== 'unarmed' && enemy.state !== 'dead'
  );
  const armedRoster = encounter.roster.filter((entry) => entry.className !== 'unarmed');
  if (alive.length === 0 && encounter.discovered && armedRoster.length > 0) {
    encounter.cleared = true;
    encounter.state = 'cleared';
    // Spawn CLEAR! popup
    floatingTexts.push({
      x: encounter.x,
      y: encounter.y - 30,
      text: 'CONTACT SECURED',
      color: '#44ff44',
      life: 1.5,
      maxLife: 1.5,
      vy: -40, // float upward
    });
    // Score bonus
    const reward = encounter.reward || {};
    const score = reward.score || Math.floor(50 + Math.hypot(encounter.x, encounter.y) * 0.02);
    heli.score += score;
    GameState.setSortieDollars(GameState.sortieDollarsEarned + (reward.dollars || 0));
    GameState.setSortieXp(GameState.sortieXpEarned + (reward.xp || 30));
    floatingTexts.push({
      x: encounter.x,
      y: encounter.y - 50,
      text: `+${score}`,
      color: '#ffcc44',
      life: 1.2,
      maxLife: 1.2,
      vy: -30,
    });
    return true;
  }
  return false;
}

/** Spawn a floating text popup (CLEAR!, damage numbers, etc). */
function spawnFloatingText(x, y, text, color) {
  floatingTexts.push({
    x,
    y,
    text,
    color,
    life: 1.0,
    maxLife: 1.0,
    vy: -30,
  });
}

// ══════════════════════════════════════════════════════════════
//  HELICOPTER STATE
// ══════════════════════════════════════════════════════════════

const heli = GameState.heli; // shared with js/sim/gameState.js

// ══════════════════════════════════════════════════════════════
//  BOSS TIMER + BOSS ENTITY
// ══════════════════════════════════════════════════════════════

const bossState = GameState.bossState; // shared

const boss = GameState.boss; // shared

function resetBossTimer() {
  const difficulty = getDifficultyProfile(GameState.activeContract?.difficultyId);
  bossState.timeRemaining = TIMER.baseTime * difficulty.hunterEtaMultiplier;
  bossState.active = true;
  bossState.warning = false;
  bossState.warningTimer = 0;
  bossState.spawned = false;
  bossState.defeated = false;
  bossState.clearedEncounters = 0;
}

function resetBoss() {
  boss.hp = 0;
  boss.maxHp = 0;
  boss.state = 'approach';
  boss.spawned = false;
}

/** Spawn the boss from a random map edge direction. */
function spawnBoss() {
  const seed = GameState.activeContract?.seed ?? 42;
  const rng = mulberry32((seed + 8800) >>> 0);
  const angle = rng() * Math.PI * 2;
  const spawnDist = WORLD_SIZE * 0.55; // just outside playable area
  boss.x = Math.cos(angle) * spawnDist;
  boss.y = Math.sin(angle) * spawnDist;
  boss.spawnAngle = angle;
  boss.angle = angle + Math.PI; // face toward the theatre
  const difficulty = getDifficultyProfile(GameState.activeContract?.difficultyId);
  // A Hind-pattern pursuit gunship: fast enough to pressure extraction,
  // but still readable through attack passes and a long firing cooldown.
  boss.hp = Math.round(280 * difficulty.hunterHpMultiplier);
  boss.maxHp = boss.hp;
  boss.speed = 145;
  boss.damage = Math.max(1, 14 * difficulty.hunterDamageMultiplier);
  boss.range = 430;
  boss.fireRate = 1.8;
  boss.fireCooldown = 2.0;
  boss.state = 'approach';
  boss.flashTimer = 0;
  boss.deathTimer = 0;
  boss.phaseTimer = 0;
  boss.size = 22;
  boss.turretAngle = angle + Math.PI;
  boss.spawned = true;
  bossState.spawned = true;
}

/** Securing a contact raises the response level without changing place identity. */
function applyClearPenalty(encounter) {
  const heat = encounter.reward?.heat || 5;
  bossState.clearedEncounters++;
  floatingTexts.push({
    x: encounter.x,
    y: encounter.y - 70,
    text: `HEAT +${Math.round(heat)}`,
    color: '#ff8844',
    life: 1.5,
    maxLife: 1.5,
    vy: -25,
  });
  addHeat(Math.min(12, heat), 'contact secured');
}

const FEAR_THRESHOLDS = _FEAR_THRESHOLDS;
const HEAT_LABELS = _HEAT_LABELS;

function resetSortieState() {
  const difficulty = getDifficultyProfile(GameState.activeContract?.difficultyId);
  GameState.setSortieStartedAt(performance.now());
  hudAnim.hp = 100;
  hudAnim.fear = 0;
  hudAnim.heat = 0;
  hudAnim.hpFlash = 0;
  sortieState.status = 'active';
  sortieState.objectiveComplete = false;
  sortieState.fearLevel = 0;
  sortieState.levelUpOpen = false;
  sortieState.upgradeChoices = [];
  sortieState.pendingLevelUps = 0;
  sortieState.appliedUpgrades = [];
  sortieState.heat.value = 0;
  sortieState.heat.tier = 0;
  sortieState.heat.lastContact = 0;
  sortieState.heat.lastEvent = '';
  sortieState.heat.eventTimer = 0;
  sortieState.heat.decayMultiplier = 1;
  sortieState.rewards.objective = 0;
  sortieState.rewards.supplies = 0;
  sortieState.rewards.hunter = 0;
  sortieState.rewards.secured = 0;
  sortieState.stats.kills = 0;
  sortieState.stats.crates = 0;
  sortieState.stats.places = 0;
  sortieState.stats.encounters = 0;
  sortieState.endTimer = 0;
}

function getHeatTier(value = sortieState.heat.value) {
  if (value >= 80) return 4;
  if (value >= 60) return 3;
  if (value >= 35) return 2;
  if (value >= 15) return 1;
  return 0;
}

function addHeat(amount, reason = 'combat activity') {
  if (!Number.isFinite(amount) || amount <= 0 || sortieState.status !== 'active') return;
  const style = getStyle(GameState.activeContract?.styleId);
  sortieState.heat.value = clamp(
    sortieState.heat.value + amount * (style.heatGainMultiplier || 1),
    0,
    100
  );
  sortieState.heat.lastContact = 0;
  sortieState.heat.lastEvent = reason;
  sortieState.heat.eventTimer = 1.8;
  updateHeatTier();
}

function reduceHeat(amount, reason = 'signal suppressed') {
  if (!Number.isFinite(amount) || amount <= 0 || sortieState.status !== 'active') return;
  sortieState.heat.value = clamp(sortieState.heat.value - amount, 0, 100);
  sortieState.heat.lastEvent = reason;
  sortieState.heat.eventTimer = 1.8;
  updateHeatTier();
}

function updateHeatTier() {
  const nextTier = getHeatTier();
  if (nextTier === sortieState.heat.tier) return;
  sortieState.heat.tier = nextTier;
  const event = world?.responsePlan?.tierEvents?.find((item) => item.tier === nextTier);
  if (event && nextTier > 0) {
    spawnFloatingText(heli.x, heli.y - 38, event.label, '#ff8844');
  }
}

function getFearThreshold() {
  return FEAR_THRESHOLDS[Math.min(sortieState.fearLevel || 0, FEAR_THRESHOLDS.length - 1)] || 660;
}

function addFear(amount, reason = 'confirmed hostile') {
  if (!Number.isFinite(amount) || amount <= 0 || sortieState.status !== 'active') return;
  heli.fear += amount;
  while (heli.fear >= getFearThreshold() && (sortieState.fearLevel || 0) < FEAR_THRESHOLDS.length) {
    heli.fear -= getFearThreshold();
    sortieState.fearLevel = (sortieState.fearLevel || 0) + 1;
    sortieState.pendingLevelUps++;
  }
  if (sortieState.pendingLevelUps > 0 && !sortieState.levelUpOpen) openFearUpgrade();
  if (reason && amount >= 5)
    spawnFloatingText(heli.x, heli.y - 24, `+${Math.round(amount)} FEAR`, '#ff8844');
}

function openFearUpgrade() {
  const level = sortieState.fearLevel || 1;
  const seed =
    ((GameState.activeContract?.seed ?? 42) + level * 7919 + sortieState.pendingLevelUps * 97) >>> 0;
  sortieState.upgradeChoices = createUpgradeChoices(seed, sortieState.appliedUpgrades);
  if (sortieState.upgradeChoices.length > 0) sortieState.levelUpOpen = true;
}

function chooseFearUpgrade(index) {
  if (!sortieState.levelUpOpen) return;
  const card = sortieState.upgradeChoices[index];
  if (!card) return;
  card.apply(heli);
  sortieState.appliedUpgrades.push(card.id);
  sortieState.pendingLevelUps = Math.max(0, sortieState.pendingLevelUps - 1);
  sortieState.levelUpOpen = false;
  sortieState.upgradeChoices = [];
  floatingTexts.push({
    x: heli.x,
    y: heli.y - 30,
    text: card.name,
    color: '#aaff88',
    life: 1.5,
    maxLife: 1.5,
    vy: -25,
  });
  if (sortieState.pendingLevelUps > 0) openFearUpgrade();
}

function isTargetAlive(target) {
  return _isTargetAlive(world, boss, target, enemies);
}

/** Semi-transparent backing plate for a HUD cluster, with corner ticks. */
function hudPlate(ctx, x, y, w, h, accent = 'rgba(90,140,80,0.55)') {
  return _hudPlate(ctx, x, y, w, h, accent);
}
function plateHeader(ctx, px, py, pw, title, accent = P.ui.textDim) {
  return _plateHeader(ctx, px, py, pw, title, accent);
}
function hudBar(ctx, x, y, w, h, frac, col, opts = {}) {
  return _hudBar(ctx, x, y, w, h, frac, col, opts);
}
function drawOffscreenMarker(ctx, cam, w, h, wx, wy, color, textColor, tag, uiScale = 1) {
  return _drawOffscreenMarker(ctx, cam, w, h, wx, wy, color, textColor, tag, uiScale);
}
// hud primitives now in render/hud.js

// Per-sortie HUD animation state (smooth bar chase + hit flash).
const hudAnim = { hp: 100, fear: 0, heat: 0, hpFlash: 0 };

function posInBox(pos, box, dpr) {
  return (
    box &&
    pos.x >= box.x * dpr &&
    pos.x <= (box.x + box.w) * dpr &&
    pos.y >= box.y * dpr &&
    pos.y <= (box.y + box.h) * dpr
  );
}

function getObjectiveFocus() {
  return _getObjectiveFocus(world, boss, enemies, heli);
}
function damageWorldTarget(target, damage, x, y) {
  if (!isTargetAlive(target) || target.hp === undefined) return false;

  // ── Convoys: shared HP pool, distinct rewards, wreck + supply drop ──
  if (Array.isArray(target.route)) {
    target.hp -= damage;
    target.flashTimer = 0.1;
    spawnExplosion(x, y, 0.3);
    if (target.hp > 0) return true;
    target.hp = 0;
    target.destroyed = true;
    // Wreckage explosions along the column
    const members = getConvoyMembers(target);
    spawnExplosion(target.x, target.y, 1.6);
    for (const m of members) {
      if (m.isVeh && Math.random() < 0.7) spawnExplosion(m.x, m.y, 0.8);
    }
    addHeat(3, 'supply convoy destroyed');
    reduceHeat(10, 'supply line severed');
    if (target === world?.objective?.target) {
      heli.score += 300;
      addFear(6, 'high-value convoy');
      spawnFloatingText(target.x, target.y - 30, '+300 BOUNTY', '#ffcc44');
      completeObjective();
    } else {
      // Different reward track from buildings: bounty + fear, and the
      // burning tailings drop salvage.
      heli.score += 150;
      GameState.setSortieXp(GameState.sortieXpEarned + 40);
      GameState.setSortieDollars(GameState.sortieDollarsEarned + 60);
      addFear(3, 'convoy ambushed');
      spawnFloatingText(target.x, target.y - 30, 'CONVOY DESTROYED', '#aaff88');
      spawnFloatingText(target.x, target.y - 48, '+150', '#ffcc44');
    }
    world.supplyCrates.push({
      id: `crate-wreck-${target.id}`,
      x: target.x + (Math.random() - 0.5) * 30,
      y: target.y + (Math.random() - 0.5) * 30,
      encounterId: target.encounterId || null,
      placeId: target.placeId || null,
      collected: false,
      objective: false,
      rewardType: pick(['repair', 'damage', 'speed', 'fear'], mulberry32(Date.now() & 0xffff)),
    });
    return true;
  }

  target.hp -= damage;
  target.flashTimer = 0.1;
  spawnExplosion(x, y, 0.3);
  if (target.hp <= 0) {
    target.hp = 0;
    target.destroyed = true;
    spawnExplosion(target.x, target.y, target.objectiveTag === 'command' ? 1.8 : 1.2);

    // ── Fuel tank: chain-detonating timer bonus (GDD +20s) ──
    if (target.special === 'fuel') {
      spawnExplosion(target.x, target.y, 2.4);
      addHeat(1.5, 'secondary explosions');
      reduceHeat(6, 'fuel reserves destroyed');
      bossState.timeRemaining += TIMER.fuelTankBonus;
      spawnFloatingText(target.x, target.y - 28, `FUEL DEPOT +${TIMER.fuelTankBonus}s`, '#44ddff');
      // Blast damage: nearby hostiles, the pilot if careless, and any
      // other building in reach (chain-reacting tanks).
      for (const e of enemies) {
        if (e.state === 'dead') continue;
        if (Math.hypot(e.x - target.x, e.y - target.y) < 70) {
          e.hp -= 45;
          e.flashTimer = 0.1;
          if (e.hp <= 0) {
            e.state = 'dead';
            e.deathTimer = 0.5;
            heli.score += e.points;
            sortieState.stats.kills++;
            spawnFloatingText(e.x, e.y - 10, `+${e.points}`, '#ffcc44');
          }
        }
      }
      if (Math.hypot(heli.x - target.x, heli.y - target.y) < 70) {
        heli.hp -= Math.max(1, Math.round(25 * (1 - (heli.dmgResist || 0))));
        spawnExplosion(heli.x, heli.y, 0.5);
        spawnFloatingText(heli.x, heli.y - 30, 'TOO CLOSE!', '#ff4444');
        if (heli.hp <= 0) {
          heli.hp = 0;
          finishSortie('failed');
        }
      }
      for (const b of world.buildings) {
        if (b === target || b.destroyed) continue;
        if (Math.hypot(b.x - target.x, b.y - target.y) < 60) {
          damageWorldTarget(b, 45, b.x, b.y);
        }
      }
      // Depot fully flattened? Mark it for the minimap.
      if (target.depotId) {
        const depot = world.fuelDepots?.find((d) => d.id === target.depotId);
        if (depot && world.buildings.every((b) => b.depotId !== depot.id || b.destroyed)) {
          depot.destroyed = true;
        }
      }
      return true;
    }

    if (target.special === 'radar') {
      addHeat(5, 'radar installation attacked');
      reduceHeat(24, 'radar disabled');
      spawnFloatingText(target.x, target.y - 25, 'RADAR DISABLED', '#aaff88');
    } else {
      addHeat(4, 'priority target destroyed');
    }
    if (target === world?.objective?.target) completeObjective();
  }
  return true;
}

function hitDestructibleWorldTarget(projectile) {
  if (!world) return false;
  const objectiveTarget = world.objective?.target;
  if (objectiveTarget && objectiveTarget !== boss && isTargetAlive(objectiveTarget)) {
    const radius = objectiveTarget.w ? Math.max(objectiveTarget.w, objectiveTarget.d) * 0.55 : 14;
    if (Math.hypot(objectiveTarget.x - projectile.x, objectiveTarget.y - projectile.y) < radius) {
      return damageWorldTarget(objectiveTarget, projectile.damage, projectile.x, projectile.y);
    }
  }
  for (const building of world.buildings) {
    if (!building.destructible || building.destroyed || building === objectiveTarget) continue;
    const radius = Math.max(building.w, building.d) * 0.55;
    if (Math.hypot(building.x - projectile.x, building.y - projectile.y) < radius) {
      return damageWorldTarget(building, projectile.damage, projectile.x, projectile.y);
    }
  }
  for (const convoy of world.convoys) {
    if (!convoy.active || convoy.destroyed) continue;
    // Test every member of the column, not just the lead vehicle.
    for (const m of getConvoyMembers(convoy)) {
      const r = m.isVeh ? 12 : 6;
      if (Math.hypot(m.x - projectile.x, m.y - projectile.y) < r) {
        return damageWorldTarget(convoy, projectile.damage, projectile.x, projectile.y);
      }
    }
  }
  return false;
}

function completeObjective() {
  if (sortieState.objectiveComplete || sortieState.status !== 'active') return;
  sortieState.objectiveComplete = true;
  if (world?.objective) {
    world.objective.complete = true;
    world.objective.progress = world.objective.requiredCount || 1;
  }
  if (world?.extraction) world.extraction.active = true;
  sortieState.rewards.objective = GameState.activeContract?.reward || 0;
  addFear(8, 'primary objective complete');
  addHeat(6, 'primary objective reported');
  spawnFloatingText(heli.x, heli.y - 42, 'OBJECTIVE COMPLETE', '#aaff88');
  spawnFloatingText(heli.x, heli.y - 58, 'EXIT THE MAP', '#44ddff');
}

function checkObjectiveProgress() {
  if (!world?.objective || sortieState.objectiveComplete) return;
  const objective = world.objective;
  if (objective.type === 'suppression') {
    const targetEnemies = enemies.filter((enemy) => enemy.objectiveTarget);
    const destroyed = targetEnemies.filter((enemy) => enemy.state === 'dead').length;
    objective.progress = destroyed;
    if (destroyed >= objective.requiredCount) completeObjective();
  } else if (objective.type === 'recovery') {
    if (objective.target?.collected) completeObjective();
  } else if (objective.target && !isTargetAlive(objective.target)) {
    completeObjective();
  }
}

function objectiveHudText() {
  if (!world?.objective) return 'STANDBY';
  if (world.objective.type === 'strike')
    return `DESTROY ${world.objective.targetPlaceName || 'COMMAND TARGET'}`;
  if (world.objective.type === 'sabotage')
    return `DISABLE ${world.objective.targetPlaceName || 'RADAR RELAY'}`;
  if (world.objective.type === 'intercept') return 'INTERCEPT SUPPLY CONVOY';
  if (world.objective.type === 'suppression') return 'DESTROY AIR DEFENSE UNITS';
  if (world.objective.type === 'recovery') return 'RECOVER SUPPLY CACHE';
  return 'COMPLETE OPERATION';
}

function collectSupplyCrates() {
  if (!world?.supplyCrates) return;
  for (const crate of world.supplyCrates) {
    if (crate.collected || Math.hypot(crate.x - heli.x, crate.y - heli.y) > 24) continue;
    crate.collected = true;
    sortieState.stats.crates++;
    sortieState.rewards.supplies += 60;
    addHeat(1.5, 'supply recovery reported');
    if (crate.rewardType === 'repair') {
      heli.hp = Math.min(heli.maxHp, heli.hp + 25);
      spawnFloatingText(crate.x, crate.y - 12, 'FIELD REPAIR +25', '#44ff44');
    } else if (crate.rewardType === 'damage') {
      heli.bulletDamage *= 1.2;
      spawnFloatingText(crate.x, crate.y - 12, 'AMMO UPGRADE', '#ffcc44');
    } else if (crate.rewardType === 'speed') {
      heli.maxSpeed *= 1.12;
      heli.accel *= 1.12;
      spawnFloatingText(crate.x, crate.y - 12, 'TURBINE BOOST', '#44ddff');
    } else {
      addFear(8, 'supply cache recovered');
      spawnFloatingText(crate.x, crate.y - 12, 'FEAR CACHE +8', '#ff8844');
    }
    if (crate.objective) completeObjective();
  }
}

/** Extraction = cross the map boundary. No LZ, no hold timer. */
function updateExtraction(dt) {
  if (
    !world?.extraction?.active ||
    !sortieState.objectiveComplete ||
    sortieState.status !== 'active'
  )
    return;
  const lim = WORLD_SIZE * 0.48;
  if (Math.abs(heli.x) > lim || Math.abs(heli.y) > lim) finishSortie('complete');
}

/** Nearest boundary exit from the helicopter, with compass cardinal. */
function nearestExitPoint() {
  return _nearestExitPoint(heli);
}

function finishSortie(status) {
  if (sortieState.status !== 'active') return;
  sortieState.status = status;
  bossState.active = false;
  sortieState.rewards.secured =
    status === 'complete'
      ? sortieState.rewards.objective + sortieState.rewards.supplies + sortieState.rewards.hunter
      : 0;
  sortieState.endTimer = 1.0;
  projectiles.length = 0;
  heli.target = null;
  heli.manualTarget = null;
  spawnFloatingText(
    heli.x,
    heli.y - 45,
    status === 'complete' ? 'SORTIE COMPLETE' : 'PILOT KIA',
    status === 'complete' ? '#aaff88' : '#ff4444'
  );
}

/** Pilot aborts the sortie and returns to base alive. No rewards secured. */
function abandonSortie() {
  if (sortieState.status !== 'active') return;
  sortieState.status = 'abandoned';
  bossState.active = false;
  sortieState.rewards.secured = 0;
  projectiles.length = 0;
  heli.target = null;
  heli.manualTarget = null;
  settingsOpen = false;
  switchScreen('debrief');
}

function updateHeat(dt) {
  if (sortieState.status !== 'active') return;
  const inContact = enemies.some((enemy) => enemy.state === 'attack') || boss.spawned;
  if (inContact) {
    sortieState.heat.lastContact = 0;
  } else {
    sortieState.heat.lastContact += dt;
    if (sortieState.heat.lastContact > 3) {
      sortieState.heat.value = clamp(
        sortieState.heat.value - dt * 1.6 * heli.heatDecayMultiplier,
        0,
        100
      );
      updateHeatTier();
    }
  }
  if (sortieState.heat.eventTimer > 0) sortieState.heat.eventTimer -= dt;
}

function hunterClockRate() {
  return _hunterClockRate(sortieState, GameState.activeContract);
}

// ══════════════════════════════════════════════════════════════
//  SCREENS
// ══════════════════════════════════════════════════════════════

function drawTitleWordmark(ctx, cx, cy, titleSize) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${titleSize}px "Courier New", monospace`;
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillText('GUNSHIP', cx + 4, cy + 4);
  ctx.fillStyle = P.ui.borderHi;
  ctx.fillText('GUNSHIP', cx + 2, cy + 2);
  ctx.fillStyle = P.ui.textBright;
  ctx.fillText('GUNSHIP', cx, cy);

  const subY = cy + titleSize * 0.62;
  ctx.font = `bold ${titleSize >= 48 ? 15 : 12}px "Courier New", monospace`;
  const sub = 'FREEDOM PROTOCOL';
  const subW = ctx.measureText(sub).width + 44;
  ctx.fillStyle = 'rgba(10,20,8,0.8)';
  ctx.fillRect(cx - subW / 2, subY - 13, subW, 26);
  ctx.strokeStyle = P.ui.infamy;
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - subW / 2, subY - 13, subW, 26);
  drawCornerBrackets(ctx, cx - subW / 2, subY - 13, subW, 26, 'rgba(204,136,51,0.6)', 7, 1.5);
  ctx.fillStyle = P.ui.infamy;
  ctx.fillText(sub, cx, subY);
  return subY + 18;
}

registerScreen('title', {
  draw(ctx, cam) {
    const dpr = cam.dpr;
    const w = cam.screenW;
    const h = cam.screenH;
    const L = layoutOf(w, h);
    ctx.save();
    ctx.scale(dpr, dpr);
    paintBackdrop(ctx, w, h);

    const t = performance.now() / 1000;
    const split = L.landscape && h < 600;
    const brandCx = split ? L.content.x + L.content.w * 0.3 : w / 2;
    const brandCy = split ? h * 0.48 : L.content.y + Math.min(L.phone ? 56 : 72, L.content.h * 0.22);
    const sweepR = Math.min(w, h) * (split ? 0.26 : 0.28);
    ctx.globalAlpha = 0.5;
    drawRadarSweep(ctx, brandCx, brandCy, sweepR, t);
    ctx.globalAlpha = 1;

    const titleSize = split
      ? Math.min(48, Math.max(32, Math.floor(w / 15)))
      : Math.min(58, Math.max(36, Math.floor(Math.min(w, h) / 10)));
    const wordBottom = drawTitleWordmark(ctx, brandCx, brandCy, titleSize);

    const entries = [
      { label: 'OPERATIONS', sub: 'SELECT CONTRACT', target: 'contracts' },
      { label: 'HANGAR', sub: 'BUY CHOPPER PARTS', target: 'hangar' },
      { label: 'SKILLS', sub: 'LEVEL & TALENTS', target: 'pilot' },
    ];
    const menuW = split
      ? Math.min(340, L.content.w * 0.44)
      : Math.min(400, L.content.w);
    const menuX = split ? L.content.x + L.content.w - menuW : (w - menuW) / 2;
    const btnH = L.btnH;
    const stackH = entries.length * btnH + (entries.length - 1) * L.btnGap;
    let my = split
      ? Math.max(L.content.y + 8, (h - L.footerH - stackH) / 2 - 8)
      : wordBottom + (L.phone ? 22 : 32);

    GameState.titleMenuBoxes.length = 0;
    for (const entry of entries) {
      const rect = { x: menuX, y: my, w: menuW, h: btnH };
      drawMenuButton(ctx, rect, { label: entry.label, sub: entry.sub });
      GameState.titleMenuBoxes.push({ ...rect, action: 'screen', target: entry.target });
      my += btnH + L.btnGap;
    }

    const c = GameState.career || metaState.career;
    if (c) {
      ctx.font = `bold ${L.phone ? 12 : 13}px "Courier New", monospace`;
      ctx.fillStyle = P.ui.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`${c.pilot.name}  ·  LV ${c.pilot.level}`, menuX + menuW / 2, my + 10);
      ctx.fillStyle = '#ffcc44';
      ctx.fillText(`$ ${c.dollars}`, menuX + menuW / 2, my + 30);
    }

    const menuBack = drawBackButton(ctx, w, h, '◂ MENU');
    GameState.titleMenuBoxes.push({ ...menuBack, action: 'menu' });
    ctx.restore();
  },
});

function drawFearUpgradeOverlay(ctx, cam) {
  const dpr = cam.dpr;
  const w = cam.screenW;
  const h = cam.screenH;
  const L = layoutOf(w, h);
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(0, 0, w, h);
  drawPanel(ctx, L.content.x - 4, 12 + L.inset.t, L.content.w + 8, h - 24 - L.inset.t - L.inset.b, {
    fill: '#0a1a0a',
    stroke: '#cc8833',
  });
  ctx.fillStyle = '#ffcc66';
  ctx.font = `bold ${L.compact ? 18 : 20}px "Courier New", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('FEAR GROWS', w / 2, 22 + L.inset.t);
  ctx.fillStyle = P.ui.textDim;
  ctx.font = '11px "Courier New", monospace';
  ctx.fillText('SELECT ONE FIELD UPGRADE', w / 2, 48 + L.inset.t);

  const rects = fearUpgradeRects(w, h);
  for (let i = 0; i < sortieState.upgradeChoices.length; i++) {
    const card = sortieState.upgradeChoices[i];
    const r = rects[i];
    ctx.save();
    const fearHit = applyMenuHitTransform(ctx, r);
    ctx.fillStyle = fearHit.hover ? '#1a3a1c' : '#132a16';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = fearHit.hover ? '#aaff88' : '#5a7a3a';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    drawCornerBrackets(ctx, r.x, r.y, r.w, r.h, fearHit.hover ? '#ffcc66' : '#cc8833', 10, 1.5);
    paintMenuGlow(ctx, r, fearHit, 'rgba(255,204,102,0.75)');
    ctx.fillStyle = '#aaff88';
    ctx.font = 'bold 13px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${i + 1}. ${card.name}`, r.x + r.w / 2, r.y + 14);
    ctx.fillStyle = P.ui.text;
    ctx.font = '11px "Courier New", monospace';
    const lines = wrapText(card.description, Math.max(14, Math.floor(r.w / 7)));
    for (let line = 0; line < lines.length; line++) {
      ctx.fillText(lines[line], r.x + r.w / 2, r.y + 42 + line * 16);
    }
    ctx.fillStyle = P.ui.textDim;
    ctx.textBaseline = 'bottom';
    ctx.fillText(IS_TOUCH ? 'TAP TO INSTALL' : 'CLICK TO INSTALL', r.x + r.w / 2, r.y + r.h - 12);
    ctx.restore();
  }
  ctx.restore();
}

let debriefInfo = null;

registerScreen('debrief', {
  enter() {
    // Commit the sortie to the career: XP/levels if the pilot survived,
    // fresh pilot if KIA. Dollars always banked. Campaign advances on win.
    const res = commitSortieOutcome(
      GameState.career,
      sortieState.status,
      GameState.sortieXpEarned,
      GameState.sortieDollarsEarned
    );
    if (sortieState.status === 'complete') {
      GameState.career.campaign.sortie += 1;
      if (GameState.career.campaign.sortie > 4) {
        GameState.career.campaign.sortie = 1;
        GameState.career.campaign.act += 1;
      }
      syncGunshipUnlocks(GameState.career);
      saveCareer(GameState.career);
    }
    debriefInfo = {
      ...res,
      xp: GameState.sortieXpEarned,
      dollars: GameState.sortieDollarsEarned,
      level: GameState.career.pilot.level,
      pilotName: GameState.career.pilot.name,
      sp: GameState.career.pilot.skillPoints,
    };
    metaState.career = GameState.career;
  },
  draw(ctx, cam) {
    const w = cam.screenW;
    const h = cam.screenH;
    const success = sortieState.status === 'complete';
    const aborted = sortieState.status === 'abandoned';
    drawScreenBackground(
      ctx,
      cam,
      success ? 'SORTIE COMPLETE' : aborted ? 'SORTIE ABORTED' : 'PILOT KIA',
      success ? 'OPERATIONAL REPORT' : aborted ? 'PILOT RECOVERED' : 'SIGNAL LOST'
    );
    ctx.save();
    ctx.scale(cam.dpr, cam.dpr);
    const L = layoutOf(w, h);
    const padIn = L.inner;
    const x = L.content.x;
    const y = L.content.y;
    const panelW = L.content.w;
    const panelH = L.content.h;
    drawPanel(ctx, x, y, panelW, panelH, {
      stroke: success ? P.ui.border : aborted ? '#aa8844' : '#883333',
    });
    drawCornerBrackets(
      ctx,
      x,
      y,
      panelW,
      panelH,
      success ? P.ui.borderHi : aborted ? '#cc9944' : '#aa4444',
      16,
      2
    );
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = success ? '#aaff88' : aborted ? '#ffcc44' : '#ff6666';
    ctx.font = `bold ${L.compact ? 14 : 16}px "Courier New", monospace`;
    ctx.fillText(
      success ? 'MISSION SUCCESS' : aborted ? 'MISSION ABORTED' : 'MISSION FAILURE',
      x + padIn,
      y + padIn
    );
    const rows = [
      ['CONTRACT', GameState.activeContract?.name || 'UNKNOWN'],
      ['OBJECTIVE', sortieState.objectiveComplete ? 'COMPLETE' : 'INCOMPLETE'],
      ['KILLS', `${sortieState.stats.kills}`],
      ['PLACES VISITED', `${sortieState.stats.places}`],
      ['CONTACTS FOUND', `${sortieState.stats.encounters}`],
      ['SUPPLY CACHES', `${sortieState.stats.crates}`],
      ['FEAR LEVEL', `${sortieState.fearLevel || 0}`],
      ['PEAK HEAT', `${Math.round(sortieState.heat.value)}`],
      ['SECURED PAY', `$${sortieState.rewards.secured}`],
      [
        'XP EARNED',
        debriefInfo ? `${debriefInfo.xp}${debriefInfo.died ? ' (LOST — KIA)' : ''}` : '0',
      ],
      ['DOLLARS EARNED', `$${debriefInfo ? debriefInfo.dollars : 0}`],
      [
        'PILOT LEVEL',
        debriefInfo
          ? `LV ${debriefInfo.level}${debriefInfo.levelsGained ? ` (+${debriefInfo.levelsGained})` : ''}`
          : '—',
      ],
    ];
    const cols = panelW >= 520 ? 2 : 1;
    const rowH = L.compact ? 20 : 24;
    const colW = (panelW - padIn * 2) / cols;
    ctx.font = `${L.compact ? 10 : 12}px "Courier New", monospace`;
    for (let i = 0; i < rows.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      ctx.fillStyle = i === rows.length - 1 ? '#ffcc44' : P.ui.text;
      ctx.fillText(
        `${rows[i][0].padEnd(16, ' ')} ${rows[i][1]}`,
        x + padIn + col * colW,
        y + padIn + 36 + row * rowH
      );
    }
    const afterRows = y + padIn + 36 + Math.ceil(rows.length / cols) * rowH + 14;
    ctx.font = `bold ${L.compact ? 10 : 11}px "Courier New", monospace`;
    if (debriefInfo?.died) {
      ctx.fillStyle = '#ff6666';
      ctx.fillText('PILOT KIA — NEW PILOT ASSIGNED', x + padIn, afterRows);
    } else if (debriefInfo?.levelsGained) {
      ctx.fillStyle = '#44cccc';
      ctx.fillText(
        `LEVEL UP — ${debriefInfo.sp} SKILL POINT${debriefInfo.sp === 1 ? '' : 'S'} AVAILABLE`,
        x + padIn,
        afterRows
      );
    } else if (debriefInfo && debriefInfo.sp > 0) {
      ctx.fillStyle = '#44cccc';
      ctx.fillText(
        `${debriefInfo.sp} UNSPENT SKILL POINT${debriefInfo.sp === 1 ? '' : 'S'}`,
        x + padIn,
        afterRows
      );
    }

    const showPilot =
      debriefInfo && (debriefInfo.sp > 0 || debriefInfo.levelsGained) && !debriefInfo.died;
    const blink2 = Math.sin(performance.now() / 500) > -0.4;
    if (showPilot) {
      const pair = footerPairRects(L, { backLabel: 'SKILLS ▸', primaryMinW: 200 });
      drawMenuButton(ctx, pair.back, { label: 'SKILLS ▸', kind: 'accent' });
      drawMenuButton(ctx, pair.primary, { label: 'CAMPAIGN', kind: 'primary', blink: blink2 });
      debriefPilotBox = pair.back;
      debriefNextBox = pair.primary;
    } else {
      debriefPilotBox = null;
      const next = {
        x: L.content.x + Math.max(0, (L.content.w - Math.min(280, L.content.w)) / 2),
        y: L.h - L.footerH + L.pad * 0.35,
        w: Math.min(280, L.content.w),
        h: L.btnH,
      };
      drawMenuButton(ctx, next, { label: 'CAMPAIGN', kind: 'primary', blink: blink2 });
      debriefNextBox = next;
    }
    ctx.restore();
  },
});

// ── Shared UI decoration helpers ──────────────────────────────────────────

/** Rotating radar sweep disc — returns nothing, animated by time. */
function drawRadarSweep(ctx, cx, cy, radius, tSec) {
  ctx.save();
  // Range rings
  ctx.strokeStyle = 'rgba(90,160,80,0.16)';
  ctx.lineWidth = 1;
  for (const rr of [0.33, 0.66, 1]) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.stroke();
  // Sweep wedge with trailing fade
  const ang = (tSec * 1.1) % (Math.PI * 2);
  for (let i = 0; i < 24; i++) {
    const a = ang - i * 0.05;
    ctx.strokeStyle = `rgba(110,220,100,${0.3 * (1 - i / 24)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    ctx.stroke();
  }
  // Blips
  const blips = [
    [0.55, 0.8],
    [0.72, 2.6],
    [0.85, 4.9],
    [0.4, 3.7],
  ];
  for (const [rr, ba] of blips) {
    const bAng = ba + Math.sin(tSec * 0.23) * 0.2;
    const fade = 0.25 + 0.55 * Math.max(0, Math.cos(ang - ba));
    ctx.fillStyle = `rgba(150,255,120,${fade})`;
    ctx.beginPath();
    ctx.arc(
      cx + Math.cos(bAng) * radius * rr,
      cy + Math.sin(bAng) * radius * rr,
      2.4,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  ctx.restore();
}

function drawScreenBackground(ctx, cam, title, subtitle = '') {
  ctx.save();
  ctx.scale(cam.dpr, cam.dpr);
  paintScreenBackdrop(ctx, cam.screenW, cam.screenH, title, subtitle);
  ctx.restore();
}

function contractCardRect(index, w, h) {
  const L = layoutOf(w, h);
  const cols = L.landscape || w >= 700 ? 2 : 1;
  const rows = Math.ceil(4 / cols);
  const gap = L.btnGap;
  const cardW = Math.min(400, (L.content.w - gap * (cols - 1)) / cols);
  const cardH = Math.min(176, (L.content.h - gap * (rows - 1)) / rows);
  const row = Math.floor(index / cols);
  const col = index % cols;
  const totalW = cardW * cols + gap * (cols - 1);
  const left = L.content.x + (L.content.w - totalW) / 2;
  return {
    x: left + col * (cardW + gap),
    y: L.content.y + row * (cardH + gap),
    w: cardW,
    h: cardH,
  };
}

function drawContractCard(ctx, card, rect, selected = false) {
  ctx.save();
  const hit = applyMenuHitTransform(ctx, rect);
  ctx.fillStyle = selected || hit.hover ? '#1e3a1e' : '#0d210f';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  // Header strip
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(rect.x, rect.y, rect.w, 28);
  // Risk-colored accent stripe
  const riskCol =
    card.difficultyRating >= 4 ? '#cc3333' : card.difficultyRating >= 3 ? '#ff8844' : '#88aa55';
  ctx.fillStyle = riskCol;
  ctx.fillRect(rect.x, rect.y, 4, rect.h);
  ctx.strokeStyle = selected || hit.hover ? P.ui.textBright : P.ui.border;
  ctx.lineWidth = selected || hit.hover ? 2 : 1;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  drawCornerBrackets(
    ctx,
    rect.x,
    rect.y,
    rect.w,
    rect.h,
    selected || hit.hover ? P.ui.textBright : 'rgba(90,140,80,0.45)',
    10,
    1.5
  );
  paintMenuGlow(ctx, rect, hit);

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x + 6, rect.y, rect.w - 12, rect.h);
  ctx.clip();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = P.ui.infamy;
  ctx.font = 'bold 14px "Courier New", monospace';
  ctx.fillText(card.name, rect.x + 16, rect.y + 8);
  ctx.fillStyle = P.ui.textDim;
  ctx.font = '9px "Courier New", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`NO.${String(card.seed % 97).padStart(2, '0')}`, rect.x + rect.w - 14, rect.y + 10);
  ctx.textAlign = 'left';
  ctx.fillStyle = P.ui.textBright;
  ctx.font = 'bold 10px "Courier New", monospace';
  ctx.fillText(card.objectiveLabel, rect.x + 16, rect.y + 34);
  ctx.fillStyle = P.ui.text;
  ctx.font = '10px "Courier New", monospace';
  const lines = wrapText(card.description, Math.max(24, Math.floor((rect.w - 24) / 7.2)));
  for (let i = 0; i < lines.length && i < 2; i++) {
    ctx.fillText(lines[i], rect.x + 16, rect.y + 52 + i * 13);
  }
  // Footer stats with divider rule
  ctx.strokeStyle = 'rgba(90,140,80,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rect.x + 16, rect.y + rect.h - 52);
  ctx.lineTo(rect.x + rect.w - 14, rect.y + rect.h - 52);
  ctx.stroke();
  ctx.fillStyle = P.ui.rocket;
  ctx.fillText(`STYLE  ${card.styleName}`, rect.x + 16, rect.y + rect.h - 42);
  ctx.fillStyle = riskCol;
  ctx.fillText(
    `RISK   ${'◆'.repeat(card.difficultyRating)}${'◇'.repeat(4 - card.difficultyRating)}  ${card.difficultyName}`,
    rect.x + 16,
    rect.y + rect.h - 28
  );
  ctx.fillStyle = '#ffcc44';
  ctx.fillText(`PAY    $${card.reward}`, rect.x + 16, rect.y + rect.h - 14);
  ctx.restore();
  ctx.restore();
}

function wrapText(text, maxChars) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

registerScreen('contracts', {
  enter() {
    const seed = (mulberry32(Date.now())() * 0xffffffff) >>> 0;
    GameState.setContractBoard(createContractBoard(seed, { act: 1, sortie: 1 }));
  },
  draw(ctx, cam) {
    const w = cam.screenW;
    const h = cam.screenH;
    const camp = GameState.career?.campaign || { act: 1, sortie: 1 };
    drawScreenBackground(
      ctx,
      cam,
      'AVAILABLE OPERATIONS',
      `ACT ${camp.act} · SORTIE ${camp.sortie} — SELECT ONE CONTRACT`
    );
    ctx.save();
    ctx.scale(cam.dpr, cam.dpr);
    for (let i = 0; i < GameState.contractBoard.length; i++) {
      drawContractCard(ctx, GameState.contractBoard[i], contractCardRect(i, w, h));
    }
    contractsBackBox = drawBackButton(ctx, w, h, '◂ CAMPAIGN');
    ctx.restore();
  },
});

registerScreen('briefing', {
  enter(contract) {
    GameState.setActiveContract(contract);
  },
  draw(ctx, cam) {
    const w = cam.screenW;
    const h = cam.screenH;
    const scenario = getScenario(GameState.activeContract?.scenarioId);
    const style = getStyle(GameState.activeContract?.styleId);
    const difficulty = getDifficultyProfile(GameState.activeContract?.difficultyId);
    drawScreenBackground(
      ctx,
      cam,
      'SORTIE BRIEFING',
      GameState.activeContract ? `CONTRACT SEED ${GameState.activeContract.seed}` : 'NO CONTRACT'
    );
    ctx.save();
    ctx.scale(cam.dpr, cam.dpr);
    const L = layoutOf(w, h);
    const split = L.landscape;
    const gap = L.btnGap;
    const leftW = split ? L.content.w * 0.54 : L.content.w;
    const rightW = split ? L.content.w - leftW - gap : L.content.w;
    const leftX = L.content.x;
    const rightX = split ? L.content.x + leftW + gap : L.content.x;
    const panelY = L.content.y;
    const panelH = L.content.h;

    drawPanel(ctx, leftX, panelY, leftW, split ? panelH : Math.min(panelH, panelH * 0.52));
    if (split) drawPanel(ctx, rightX, panelY, rightW, panelH);

    const infoH = split ? panelH : Math.min(panelH, panelH * 0.52);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = P.ui.infamy;
    ctx.font = `bold ${L.compact ? 16 : 18}px "Courier New", monospace`;
    const name = GameState.activeContract?.name || 'NO CONTRACT';
    ctx.fillText(name, leftX + 20, panelY + 18);
    ctx.strokeStyle = 'rgba(204,136,51,0.5)';
    ctx.beginPath();
    ctx.moveTo(leftX + 20, panelY + 40);
    ctx.lineTo(leftX + 20 + ctx.measureText(name).width, panelY + 40);
    ctx.stroke();
    ctx.fillStyle = P.ui.textBright;
    ctx.font = `bold ${L.compact ? 11 : 13}px "Courier New", monospace`;
    ctx.fillText(scenario.objectiveLabel, leftX + 20, panelY + 50);
    ctx.fillStyle = P.ui.text;
    ctx.font = `${L.compact ? 10 : 11}px "Courier New", monospace`;
    const descriptionLines = wrapText(scenario.description, Math.max(22, Math.floor((leftW - 40) / 7.2)));
    const maxDesc = L.compact ? 2 : 3;
    for (let i = 0; i < descriptionLines.length && i < maxDesc; i++)
      ctx.fillText(descriptionLines[i], leftX + 20, panelY + 72 + i * 16);
    const detailY = panelY + 72 + Math.min(descriptionLines.length, maxDesc) * 16 + 14;
    ctx.fillStyle = P.ui.rocket;
    ctx.fillText(`STYLE       ${style.name}`, leftX + 20, detailY);
    ctx.fillText(`DIFFICULTY  ${difficulty.name}`, leftX + 20, detailY + 20);
    ctx.fillText(
      `THREAT      ${(GameState.activeContract?.threatTags || []).join(' / ').toUpperCase()}`,
      leftX + 20,
      detailY + 40
    );
    ctx.fillStyle = '#ffcc44';
    ctx.fillText(`BASE PAY    $${GameState.activeContract?.reward || 0}`, leftX + 20, detailY + 60);
    ctx.fillStyle = P.ui.textDim;
    ctx.fillText('Fear levels you up. Heat accelerates the Hunter.', leftX + 20, detailY + 86);
    ctx.fillText('Complete the objective, then leave the map.', leftX + 20, detailY + 104);

    const eqKeys = Object.keys(EQUIPMENT);
    const eqPanelX = rightX;
    const eqPanelY = split ? panelY : panelY + infoH + gap;
    const eqPanelW = rightW;
    const eqPanelH = split ? panelH : panelH - infoH - gap;
    if (!split) drawPanel(ctx, eqPanelX, eqPanelY, eqPanelW, eqPanelH);
    ctx.fillStyle = P.ui.textDim;
    ctx.font = 'bold 11px "Courier New", monospace';
    ctx.fillText('FIELD EQUIPMENT', eqPanelX + 20, eqPanelY + 16);
    GameState.briefingEquipmentBoxes.length = 0;
    const eqGap = 12;
    const eqW = (eqPanelW - 40 - eqGap) / 2;
    const eqH = Math.max(56, Math.min(72, (eqPanelH - 48 - eqGap) / 2));
    for (let i = 0; i < eqKeys.length; i++) {
      const key = eqKeys[i];
      const bx = eqPanelX + 20 + (i % 2) * (eqW + eqGap);
      const by = eqPanelY + 40 + Math.floor(i / 2) * (eqH + eqGap);
      const isSel = GameState.selectedEquipment === key;
      const eqRect = { x: bx, y: by, w: eqW, h: eqH };
      ctx.save();
      const eqHit = applyMenuHitTransform(ctx, eqRect);
      ctx.fillStyle = isSel || eqHit.hover ? 'rgba(68,204,204,0.16)' : 'rgba(0,0,0,0.25)';
      ctx.fillRect(bx, by, eqW, eqH);
      ctx.strokeStyle = isSel || eqHit.hover ? '#44cccc' : P.ui.border;
      ctx.lineWidth = isSel || eqHit.hover ? 1.6 : 1;
      ctx.strokeRect(bx, by, eqW, eqH);
      if (isSel || eqHit.hover) drawCornerBrackets(ctx, bx, by, eqW, eqH, '#44cccc', 7, 1.5);
      paintMenuGlow(ctx, eqRect, eqHit, 'rgba(68,238,238,0.75)');
      ctx.textAlign = 'left';
      ctx.fillStyle = isSel ? '#88eeee' : P.ui.text;
      ctx.font = 'bold 12px "Courier New", monospace';
      ctx.fillText(EQUIPMENT[key].name, bx + 10, by + 10);
      ctx.fillStyle = P.ui.textDim;
      ctx.font = '10px "Courier New", monospace';
      ctx.fillText(EQUIPMENT[key].desc, bx + 10, by + 30);
      ctx.restore();
      GameState.briefingEquipmentBoxes.push({ x: bx, y: by, w: eqW, h: eqH, key });
    }

    const pair = footerPairRects(L, { backLabel: '◂ CONTRACTS', primaryMinW: 200 });
    briefingBackBox = pair.back;
    briefingLaunchBox = pair.primary;
    drawMenuButton(ctx, pair.back, { label: '◂ CONTRACTS' });
    const blink = Math.sin(performance.now() / 500) > -0.4;
    drawMenuButton(ctx, pair.primary, { label: 'LAUNCH', kind: 'primary', blink });
    ctx.restore();
  },
});

registerScreen('sortie', {
  enter(contract) {
    GameState.setActiveContract(contract || GameState.activeContract);
    resetSortieState();
    enemies.length = 0;
    projectiles.length = 0;
    explosions.length = 0;
    floatingTexts.length = 0;
    heli.x = 0;
    heli.y = 0;
    heli.vx = 0;
    heli.vy = 0;
    heli.angle = -Math.PI / 2;
    heli.hp = 100;
    heli.maxHp = 100;
    heli.score = 0;
    heli.fear = 0;
    heli.bladeAngle = 0;
    heli.targetMode = 'closest';
    heli.targetCycleIndex = 0;
    heli.fireCooldown = 0;
    heli.fireRate = 0.15;
    heli.bulletSpeed = 500;
    heli.bulletDamage = 8;
    heli.weaponRange = 350;
    heli.accel = 1400;
    heli.maxSpeed = 400;
    heli.heatDecayMultiplier = 1;
    heli.targetAssist = 0;
    heli.target = null;
    heli.manualTarget = null;
    // Equipment — one use per sortie, chosen at briefing.
    heli.equipmentType = GameState.selectedEquipment;
    heli.equipmentUsed = false;
    heli.salvoShots = 0;
    heli.salvoTimer = 0;
    heli.adrenalineT = 0;
    heli.flareT = 0;
    applyCareerToHeli(heli, GameState.career.pilot, GameState.career.hangar, GameState.career.gunship);
    GameState.setSortieXp(0);
    GameState.setSortieDollars(0);
    try {
      initWorld(GameState.activeContract);
    } catch (e) {
      console.error('[Gunship] initWorld failed', e);
      const seed = GameState.activeContract?.seed ?? 42;
      const fallback = generateWorld({ seed, contract: GameState.activeContract });
      fallback.debugWorldgen = debugWorldgen;
      world = fallback;
      terrainNoise = createNoise(seed);
      moistureNoise = createNoise(seed + 777);
      detailNoise = createNoise(seed + 333);
      _setTerrain(null, terrainNoise, moistureNoise, detailNoise);
      GameState.setWorld(world);
      GameState.setNoises(terrainNoise, moistureNoise, detailNoise);
    }
    if (world) {
      for (const place of world.places) place.discovered = false;
      for (const encounter of world.encounters) {
        encounter.discovered = false;
        encounter.cleared = false;
        encounter.state = 'hidden';
        for (const entry of encounter.roster) entry.active = false;
      }
    }
    spawnOutdoorEnemies();
    resetBossTimer();
    resetBoss();
  },

  tick(dt) {
    tickSortie(dt, {
      camera,
      input,
      switchScreen,
      hudAnim,
      spawnProjectile,
      spawnExplosion,
      spawnFloatingText,
      addHeat,
      addFear,
      reduceHeat,
      discoverEncounter,
      checkEncounterClear,
      applyClearPenalty,
      checkObjectiveProgress,
      collectSupplyCrates,
      updateHeat,
      hunterClockRate,
      spawnBoss,
      hitDestructibleWorldTarget,
      finishSortie,
      isTargetAlive,
      getConvoyMembers,
      pointAlongRoute,
      updateExtraction,
    });
  },

  draw(ctx, cam, dt = 0) {
    const dpr = cam.dpr,
      w = cam.screenW,
      h = cam.screenH;
    cam.begin(ctx);

    drawSmoothTerrain(ctx, cam);
    drawWorldGround(ctx, cam);
    drawRoads(ctx, cam);
    drawDecorations(ctx, cam);

    // Draw convoys as a path-bound vehicle column (before helicopter so
    // they appear underneath). Every member sits ON the route polyline.
    if (world) {
      const VEHICLE_CLASSES = {
        technical: '#7a6040',
        apc: '#7a7a5a',
        shilka: '#5a5a4a',
        sam: '#5a6a5a',
      };
      for (const convoy of world.convoys) {
        if (!convoy.active) continue;
        // Cull by column bounding box
        let colMinX = Infinity,
          colMinY = Infinity,
          colMaxX = -Infinity,
          colMaxY = -Infinity;
        const members = getConvoyMembers(convoy);
        for (const m of members) {
          if (m.x < colMinX) colMinX = m.x;
          if (m.x > colMaxX) colMaxX = m.x;
          if (m.y < colMinY) colMinY = m.y;
          if (m.y > colMaxY) colMaxY = m.y;
        }
        if (
          colMaxX < cam.x - 1200 ||
          colMinX > cam.x + 1200 ||
          colMaxY < cam.y - 1200 ||
          colMinY > cam.y + 1200
        )
          continue;

        if (convoy.destroyed) {
          // Burnt-out wrecks scattered along the road
          for (const m of members) {
            if (!m.isVeh) continue;
            ctx.save();
            ctx.translate(m.x, m.y);
            ctx.rotate(m.angle + ((m.x * 7 + m.y * 3) % 10) / 30 - 0.15);
            ctx.fillStyle = 'rgba(20,16,12,0.55)';
            ctx.beginPath();
            ctx.ellipse(0, 0, 14, 8, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#2e2a24';
            ctx.fillRect(-9, -5, 18, 10);
            ctx.restore();
          }
          continue;
        }

        // Column: draw tail-first so lead sits on top.
        for (let i = members.length - 1; i >= 0; i--) {
          const m = members[i];
          if (!cam.isVisible(m.x, m.y, 40)) continue;
          ctx.save();
          ctx.translate(m.x, m.y);
          ctx.rotate(m.angle);
          if (m.isVeh) {
            const len = m.cls === 'shilka' ? 24 : 20,
              wid = m.cls === 'shilka' ? 12 : 10;
            ctx.fillStyle = withAlpha('#000000', 0.18); // shadow
            ctx.beginPath();
            ctx.ellipse(2, 3, len * 0.55, wid * 0.5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = VEHICLE_CLASSES[m.cls];
            ctx.fillRect(-len / 2, -wid / 2, len, wid);
            if (convoy.flashTimer > 0) {
              ctx.fillStyle = 'rgba(255,255,255,0.7)';
              ctx.fillRect(-len / 2, -wid / 2, len, wid);
            }
            ctx.fillStyle = 'rgba(0,0,0,0.35)'; // cab / front block
            ctx.fillRect(len / 2 - 6, -wid / 2 + 1.5, 5, wid - 3);
            if (m.cls === 'shilka') {
              // gun barrels
              ctx.strokeStyle = '#3a3a2a';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(len / 2 - 4, -3);
              ctx.lineTo(len / 2 + 8, -4);
              ctx.moveTo(len / 2 - 4, 3);
              ctx.lineTo(len / 2 + 8, 4);
              ctx.stroke();
            }
          } else {
            ctx.fillStyle = '#8a6a4a';
            ctx.beginPath();
            ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }

        if (convoy.objectiveTarget) {
          ctx.strokeStyle = '#ff4444';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(convoy.x, convoy.y, 16, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#ff8844';
          ctx.font = 'bold 9px "Courier New", monospace';
          ctx.textAlign = 'center';
          ctx.fillText('CONVOY TARGET', convoy.x, convoy.y - 22);
        }
      }
    }

    if (world) {
      world.buildings.sort((a, b) => a.y + a.d / 2 - (b.y + b.d / 2));
      for (const b of world.buildings) {
        if (cam.isVisible(b.x, b.y, 80)) drawBuilding(ctx, b);
      }
    }
    drawPlaces(ctx, cam);
    drawScenarioOverlays(ctx, cam);

    // Draw enemies
    for (const e of enemies) {
      if (!cam.isVisible(e.x, e.y, 30)) continue;
      drawEnemy(ctx, e);
    }

    // Draw boss
    if (boss.spawned && cam.isVisible(boss.x, boss.y, 60)) {
      drawHunter(ctx);
    }

    // Draw projectiles
    for (const p of projectiles) {
      // Trail
      ctx.strokeStyle = p.isEnemy
        ? withAlpha(P.projectile.enemyTrail, 0.4)
        : withAlpha(P.projectile.bulletTrail, 0.4);
      ctx.lineWidth = 2;
      if (p.trail.length > 1) {
        ctx.beginPath();
        ctx.moveTo(p.trail[0].x, p.trail[0].y);
        for (let i = 1; i < p.trail.length; i++) ctx.lineTo(p.trail[i].x, p.trail[i].y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      // Bullet
      ctx.fillStyle = p.isEnemy ? P.projectile.enemy : P.projectile.bullet;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw explosions
    for (const ex of explosions) {
      const t = 1 - ex.life / ex.maxLife;
      const r = ex.size * 20 * (0.5 + t * 0.5);
      const alpha = (1 - t) * 0.8;
      // Outer glow
      ctx.fillStyle = withAlpha(P.vfx.explosion[1], alpha * 0.3);
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, r * 1.5, 0, Math.PI * 2);
      ctx.fill();
      // Core
      ctx.fillStyle = withAlpha(P.vfx.explosion[0], alpha);
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, r, 0, Math.PI * 2);
      ctx.fill();
      // Inner bright
      ctx.fillStyle = withAlpha(P.vfx.sparkHi, alpha * 0.6);
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw helicopter shadow
    drawHeliShadow(ctx, heli);
    // Draw helicopter
    drawGunship(ctx, heli);
    // Flares: bright falling sparks around the airframe
    if (heli.flareT > 0) {
      for (let f = 0; f < 5; f++) {
        const fa = performance.now() / 130 + f * 1.256;
        const fr = 18 + (f % 3) * 9;
        const fx = heli.x + Math.cos(fa) * fr;
        const fy = heli.y + Math.sin(fa) * fr * 0.7 + ((performance.now() / 60 + f * 13) % 14);
        ctx.fillStyle = withAlpha('#ffdd66', 0.85);
        ctx.beginPath();
        ctx.arc(fx, fy, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = withAlpha('#ff8833', 0.4);
        ctx.beginPath();
        ctx.arc(fx, fy + 2, 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw floating texts (CLEAR!, damage numbers)
    for (const ft of floatingTexts) {
      const alpha = clamp((ft.life / ft.maxLife) * 2, 0, 1); // fade in fast, fade out
      const scale = 1 + (1 - ft.life / ft.maxLife) * 0.3; // grow slightly
      ctx.save();
      ctx.translate(ft.x, ft.y);
      ctx.scale(scale, scale);
      ctx.font = 'bold 14px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Shadow
      ctx.fillStyle = withAlpha('#000000', alpha * 0.5);
      ctx.fillText(ft.text, 1, 1);
      // Text
      ctx.fillStyle = withAlpha(ft.color, alpha);
      ctx.fillText(ft.text, 0, 0);
      ctx.restore();
    }

    cam.end(ctx);

    // ── HUD ──
    ctx.save();
    ctx.scale(dpr, dpr);

    // Scale the HUD with viewport size so it stays readable on big screens
    // and still fits on small ones. All HUD code below uses W/H (logical).
    const uiS = clamp(Math.min(w, h) / HUD.scaleDivisor, 1, HUD.scaleMax);
    ctx.scale(uiS, uiS);

    // ── HUD layout metrics (responsive; no plate overlaps) ──
    const W = w / uiS,
      H = h / uiS;
    const narrow = W < HUD.narrowBreakpoint;
    const hudPad = narrow ? 12 : 18;
    const lpw = narrow ? 188 : 272;
    const rpw = narrow ? 172 : 228;
    const rph = narrow ? 118 : 124;
    const rpx = W - rpw - hudPad;

    const nToggles = (input.autofire ? 1 : 0) + (input.clickToTarget ? 1 : 0);
    const equipReady = sortieState.status === 'active' && heli.equipmentType && !heli.equipmentUsed;
    const objText =
      world?.objective && !sortieState.objectiveComplete
        ? objectiveHudText()
        : sortieState.objectiveComplete
          ? 'RTB — EXIT THE MAP'
          : null;
    const objWrap = objText
        ? wrapText(objText, Math.max(16, Math.floor((lpw - 32) / 6))).slice(0, 2)
      : [];
    const showProgress = !!(
      world?.objective &&
      !sortieState.objectiveComplete &&
      world.objective.type === 'suppression'
    );
    const sysH =
      46 +
      nToggles * 16 +
      (equipReady ? 16 : 0) +
      objWrap.length * 14 +
      (showProgress ? 14 : 0) +
      8;

    // Centre stack drops below the side plates on narrow screens.
    const hpY0 = narrow ? hudPad + Math.max(sysH, rph) + 14 : hudPad;
    const hudEtaY = hpY0 + 40;

    // Bottom row metrics (radar / compass / sortie stats)
    const mmS = narrow ? 118 : 176;
    const mmX = hudPad;
    const mmY = H - mmS - hudPad - 12;
    const stW = narrow ? 148 : 192;
    const stH = narrow ? 58 : 68;
    const stX = W - stW - hudPad;
    const stY = H - stH - hudPad;
    const cpW = Math.max(0, Math.min(W - mmS - stW - hudPad * 2 - 48, 360));
    const cpH = narrow ? 36 : 42;

    // ── Damage vignette — screen edges bleed red as the airframe fails ──
    {
      const hpPctV = heli.hp / heli.maxHp;
      if (hpPctV < 0.35) {
        const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 160);
        const a = (1 - hpPctV / 0.35) * 0.38 * pulse * (1 - (heli.redScreenRed || 0));
        const vg = ctx.createRadialGradient(
          W / 2,
          H / 2,
          Math.min(W, H) * 0.32,
          W / 2,
          H / 2,
          Math.max(W, H) * 0.72
        );
        vg.addColorStop(0, 'rgba(180,20,20,0)');
        vg.addColorStop(1, `rgba(180,20,20,${a.toFixed(3)})`);
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, W, H);
      }
    }

    // ── Targeting-mode toast — explains what the mode does ──
    {
      const now = performance.now();
      if (now < GameState.modeToastUntil) {
        const MODE_HELP = {
          closest: 'nearest hostile in weapons range',
          strongest: 'hostile with highest damage per second',
          infrastructure: 'buildings & convoys only',
        };
        const alpha = Math.min(1, (GameState.modeToastUntil - now) / 600);
        const modeLabel =
          { closest: 'CLOSEST', strongest: 'STRONGEST', infrastructure: 'INFRA' }[
            heli.targetMode
          ] || heli.targetMode;
        const ty0 = hpY0 + 44;
        ctx.globalAlpha = alpha;
        ctx.font = 'bold 12px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#44cccc';
        ctx.fillText(`TARGETING: ${modeLabel}`, W / 2, ty0);
        ctx.font = '9px "Courier New", monospace';
        ctx.fillStyle = P.ui.textDim;
        ctx.fillText(MODE_HELP[heli.targetMode] || '', W / 2, ty0 + 15);
        ctx.globalAlpha = 1;
      }
    }

    // Hull plate (centred — animated bar, segments, damage flash)
    {
      const hpBarW = narrow ? 110 : 132,
        hpBarH = 9;
      const plateW = narrow ? 228 : 280,
        plateH = 34;
      const px = W / 2 - plateW / 2,
        py = hpY0;
      const hpPct = heli.hp / heli.maxHp;
      hudPlate(
        ctx,
        px,
        py,
        plateW,
        plateH,
        hpPct <= 0.25
          ? 'rgba(255,68,68,0.7)'
          : hpPct <= 0.5
            ? 'rgba(204,170,51,0.55)'
            : 'rgba(90,140,80,0.55)'
      );
      const lowPulse = hpPct <= 0.25 ? 0.55 + 0.45 * Math.sin(performance.now() / 120) : 1;

      // Animate the displayed value toward the real one; flash on damage.
      hudAnim.hp += (heli.hp - hudAnim.hp) * Math.min(1, 10 * (dt || 0.016));
      hudAnim.hpFlash = Math.max(0, (hudAnim.hpFlash || 0) - (dt || 0.016));

      let label = 'HULL',
        labelCol = P.ui.text;
      if (hpPct <= 0.25) {
        label = 'CRIT';
        labelCol = '#ff4444';
      } else if (hpPct <= 0.5) {
        label = 'DMGD';
        labelCol = P.ui.hpMed;
      }

      const num = `${Math.round(Math.max(0, heli.hp))}/${Math.round(heli.maxHp)}`;
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const labelW = ctx.measureText(label).width;
      const numW = ctx.measureText(num).width;
      const gap = 9;
      const total = labelW + gap + hpBarW + gap + numW;

      const midY = py + plateH / 2 + 0.5;
      const cx0 = px + (plateW - total) / 2;

      ctx.fillStyle = labelCol;
      ctx.globalAlpha = hpPct <= 0.25 ? lowPulse : 1;
      ctx.fillText(label, cx0, midY);
      ctx.globalAlpha = 1;
      const barX = cx0 + labelW + gap,
        barY = py + (plateH - hpBarH) / 2;
      const hpCol = hpPct > 0.5 ? P.ui.hp : hpPct > 0.25 ? P.ui.hpMed : P.ui.hpLow;
      hudBar(ctx, barX, barY, hpBarW, hpBarH, hpPct, hpCol, {
        shown: hudAnim.hp / heli.maxHp,
        flash: hudAnim.hpFlash,
        border: P.ui.hpBorder,
      });
      ctx.fillStyle = P.ui.text;
      ctx.fillText(num, barX + hpBarW + gap, midY);
    }

    // Score / Fear / Heat — right status plate
    {
      const px = rpx,
        py = hudPad,
        pw = rpw,
        ph = rph;
      hudPlate(ctx, px, py, pw, ph, 'rgba(90,140,80,0.55)');
      plateHeader(ctx, px, py, pw, 'STATUS');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const fbW = pw - 28;

      // Animate bars toward real values
      const fearThreshold = getFearThreshold();
      hudAnim.fear +=
        (clamp(heli.fear / fearThreshold, 0, 1) - hudAnim.fear) * Math.min(1, 8 * (dt || 0.016));
      hudAnim.heat +=
        (sortieState.heat.value / 100 - hudAnim.heat) * Math.min(1, 8 * (dt || 0.016));

      // SCORE — big number, right-aligned
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.fillStyle = P.ui.textDim;
      ctx.fillText('SCORE', px + 14, py + 22);
      ctx.font = 'bold 15px "Courier New", monospace';
      ctx.fillStyle = P.ui.infamy;
      ctx.textAlign = 'right';
      ctx.fillText(`${heli.score}`, px + pw - 14, py + 20);
      ctx.textAlign = 'left';

      // FEAR
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.fillStyle = '#ff8844';
      ctx.fillText(`FEAR LV ${sortieState.fearLevel || 0}`, px + 14, py + 46);
      hudBar(ctx, px + 14, py + 60, fbW, 5, heli.fear / fearThreshold, '#cc8833', {
        shown: hudAnim.fear,
      });

      // HEAT (tier-colored)
      const heatCols = [P.ui.hp, P.ui.hpMed, '#ff8844', '#ff5533', '#ff2222'];
      ctx.fillStyle = heatCols[Math.min(sortieState.heat.tier, heatCols.length - 1)];
      ctx.fillText(`HEAT ${HEAT_LABELS[sortieState.heat.tier]}`, px + 14, py + 74);
      hudBar(
        ctx,
        px + 14,
        py + 88,
        fbW,
        6,
        sortieState.heat.value / 100,
        sortieState.heat.tier >= 3 ? '#ff4444' : '#cc6633',
        { shown: hudAnim.heat }
      );
      if (sortieState.heat.eventTimer > 0 && sortieState.heat.lastEvent) {
        ctx.fillStyle = '#ffcc88';
        ctx.font = '8px "Courier New", monospace';
        const ev = sortieState.heat.lastEvent.toUpperCase();
        ctx.fillText(ev.length > 34 ? ev.slice(0, 33) + '…' : ev, px + 14, py + 100);
      }
    }

    // ── Boss timer ──
    if (bossState.active && !bossState.defeated) {
      const secs = Math.max(0, Math.ceil(bossState.timeRemaining));
      const mins = Math.floor(secs / 60);
      const rem = secs % 60;
      const timerStr = `${mins}:${rem.toString().padStart(2, '0')}`;
      const urgent = bossState.timeRemaining < 30;
      const flash = urgent && Math.sin(performance.now() / 200) > 0;
      const bw = 190,
        bx = W / 2 - bw / 2,
        by = hudEtaY;
      hudPlate(ctx, bx, by, bw, 24, urgent ? 'rgba(255,68,68,0.7)' : 'rgba(90,140,80,0.55)');
      ctx.fillStyle = flash ? '#ff4444' : P.ui.textBright;
      ctx.font = 'bold 13px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`HUNTER ETA ${timerStr}`, W / 2, by + 5);
      // Time-remaining underline (normalized against base timer)
      const baseT = Math.max(1, TIMER.baseTime);
      const frac = clamp(bossState.timeRemaining / baseT, 0, 1);
      ctx.fillStyle = urgent ? 'rgba(255,68,68,0.8)' : 'rgba(120,180,100,0.6)';
      ctx.fillRect(bx + 8, by + 20, (bw - 16) * frac, 2);
    }

    // ── Boss HP bar (when spawned) — sits clear of the ETA plate ──
    if (boss.spawned && boss.state !== 'dead') {
      const bossBarW = 220,
        bossBarH = 9;
      const bossBarX = W / 2 - bossBarW / 2;
      const etaShowing = bossState.active && !bossState.defeated;
      const bossBarY = etaShowing ? hudEtaY + 40 : hudEtaY;
      hudPlate(ctx, bossBarX - 8, bossBarY - 16, bossBarW + 16, 30, 'rgba(255,68,68,0.55)');
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(bossBarX, bossBarY, bossBarW, bossBarH);
      const bossHpPct = boss.hp / boss.maxHp;
      ctx.fillStyle = bossHpPct > 0.5 ? '#cc4444' : bossHpPct > 0.25 ? '#ff6644' : '#ff2222';
      ctx.fillRect(bossBarX, bossBarY, bossBarW * bossHpPct, bossBarH);
      ctx.strokeStyle = '#880000';
      ctx.lineWidth = 1;
      ctx.strokeRect(bossBarX + 0.5, bossBarY + 0.5, bossBarW - 1, bossBarH - 1);
      ctx.fillStyle = '#ff6666';
      ctx.font = 'bold 9px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('HIND PURSUIT GUNSHIP', W / 2, bossBarY - 12);
    }

    // Target indicator + mode
    if (heli.target) {
      const ts = cam.worldToScreen(heli.target.x, heli.target.y);
      ts.x /= uiS;
      ts.y /= uiS; // convert to HUD-logical space
      // Reticle color follows the targeting mode (boss always red)
      const retCol =
        heli.target === boss
          ? P.ui.enemy
          : heli.targetMode === 'infrastructure'
            ? '#44cccc'
            : heli.targetMode === 'strongest'
              ? '#ff8844'
              : P.ui.enemy;
      ctx.save();
      ctx.translate(ts.x, ts.y);
      ctx.rotate(performance.now() / 2400); // slow instrument rotation
      ctx.strokeStyle = retCol;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.stroke();
      // Crosshair ticks (rotate with the ring)
      for (let i = 0; i < 4; i++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(9, 0);
        ctx.lineTo(22, 0);
        ctx.stroke();
      }
      ctx.restore();
      // Center dot
      ctx.fillStyle = retCol;
      ctx.beginPath();
      ctx.arc(ts.x, ts.y, 2, 0, Math.PI * 2);
      ctx.fill();
      // Target HP mini-bar (when the target has one)
      if (heli.target.hp !== undefined && heli.target.maxHp) {
        const bw2 = 40;
        ctx.fillStyle = 'rgba(10,16,10,0.85)';
        ctx.fillRect(ts.x - bw2 / 2, ts.y + 14, bw2, 3);
        ctx.fillStyle = retCol;
        ctx.fillRect(
          ts.x - bw2 / 2,
          ts.y + 14,
          bw2 * clamp(heli.target.hp / heli.target.maxHp, 0, 1),
          3
        );
      }
      // Label + range-to-target (+ lock indicator when click-locked)
      const tRange =
        Math.round(Math.hypot(heli.target.x - heli.x, heli.target.y - heli.y) / 10) * 10;
      ctx.font = '9px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = retCol;
      let label = 'TARGET';
      if (heli.target === boss) label = 'HIND PURSUIT GUNSHIP';
      else if (Array.isArray(heli.target.route)) label = 'CONVOY';
      else if (heli.target.type)
        label =
          heli.target.special === 'radar'
            ? 'RADAR'
            : heli.target.special === 'fuel'
              ? 'FUEL TANK'
              : heli.target.type.toUpperCase();
      else if (heli.target.category === 'vehicle')
        label = (heli.target.weaponName || heli.target.className || 'VEHICLE').toUpperCase();
      else if (heli.target.category === 'emplacement')
        label = (heli.target.weaponName || heli.target.className || 'EMPLACEMENT').toUpperCase();
      else if (heli.target.weaponName) label = heli.target.weaponName;
      else if (heli.target.className) label = heli.target.className.toUpperCase();
      if (heli.manualTarget === heli.target) label = 'LCK · ' + label;
      ctx.fillText(label, ts.x, ts.y - 26);
      ctx.fillStyle = '#ffaa88';
      ctx.fillText(`${tRange} m`, ts.x, ts.y + 22);
    }

    // Systems plate — targeting, toggles, equipment, objective
    {
      const px = hudPad,
        py = hudPad,
        pw = lpw;
      hudPlate(ctx, px, py, pw, sysH, 'rgba(90,140,80,0.55)');
      plateHeader(ctx, px, py, pw, 'SYSTEMS');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = 'bold 10px "Courier New", monospace';
      // Mode-colored targeting readout
      const modeCol =
        { closest: P.ui.text, strongest: '#ff8844', infrastructure: '#44cccc' }[heli.targetMode] ||
        P.ui.text;
      const modeLabel =
        { closest: 'CLOSEST', strongest: 'STRONGEST', infrastructure: 'INFRA' }[heli.targetMode] ||
        'CLOSEST';
      ctx.fillStyle = modeCol;
      ctx.fillText(`TGT ${modeLabel}`, px + 14, py + 22);
      if (!narrow) {
        ctx.fillStyle = P.ui.textDim;
        ctx.fillText('[SHIFT/V]', px + 108, py + 22);
      }
      let ty = py + 40;
      for (let i = 0; i < nToggles; i++) {
        ctx.fillStyle = P.ui.rocket;
        ctx.fillText(i === 0 && input.autofire ? 'AUTOFIRE' : 'CLICK-TARGET', px + 14, ty);
        ty += 16;
      }
      if (equipReady) {
        ctx.fillStyle = '#44cccc';
        ctx.fillText(`E · ${EQUIPMENT[heli.equipmentType].name}`, px + 14, ty);
        ty += 16;
      }
      ctx.font = 'bold 10px "Courier New", monospace';
      for (const line of objWrap) {
        ctx.fillStyle = sortieState.objectiveComplete ? '#44ddff' : '#ffcc44';
        ctx.fillText(line, px + 14, ty);
        ty += 14;
      }
      if (showProgress) {
        ctx.fillStyle = P.ui.textDim;
        ctx.fillText(
          `PROGRESS ${world.objective.progress}/${world.objective.requiredCount}`,
          px + 14,
          ty
        );
      }
    }

    // ── BOTTOM-LEFT: circular tactical radar ───────────────────────────
    if (world) {
      const R = mmS / 2;
      const ccx = mmX + R,
        ccy = mmY + R;
      // Circular backdrop + bezel
      ctx.fillStyle = 'rgba(6,14,6,0.78)';
      ctx.beginPath();
      ctx.arc(ccx, ccy, R + 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(90,140,80,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ccx, ccy, R + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.save();
      ctx.beginPath();
      ctx.arc(ccx, ccy, R, 0, Math.PI * 2);
      ctx.clip();

      const half = world.worldSize / 2;
      const k = mmS / world.worldSize;
      const mx = (wx) => mmX + (wx + half) * k;
      const my = (wy) => mmY + (wy + half) * k;

      // Range rings + crosshair
      ctx.strokeStyle = 'rgba(90,160,80,0.22)';
      ctx.lineWidth = 1;
      for (const rr of [0.33, 0.66, 1]) {
        ctx.beginPath();
        ctx.arc(ccx, ccy, R * rr, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(ccx - R, ccy);
      ctx.lineTo(ccx + R, ccy);
      ctx.moveTo(ccx, ccy - R);
      ctx.lineTo(ccx, ccy + R);
      ctx.stroke();

      // Roads (cached layer)
      ctx.drawImage(getMiniRoads(mmS), mmX, mmY);

      // Radar sweep
      const sweepAng = performance.now() / 900;
      ctx.save();
      ctx.translate(ccx, ccy);
      ctx.rotate(sweepAng);
      const sw = ctx.createLinearGradient(0, 0, R, 0);
      sw.addColorStop(0, 'rgba(120,220,110,0.30)');
      sw.addColorStop(1, 'rgba(120,220,110,0)');
      ctx.strokeStyle = 'rgba(120,220,110,0.25)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(R, 0);
      ctx.stroke();
      ctx.restore();

      // Camera view rectangle
      {
        const vb = camera.getVisibleBounds();
        ctx.strokeStyle = 'rgba(200,255,180,0.30)';
        ctx.lineWidth = 1;
        ctx.strokeRect(mx(vb.left), my(vb.top), (vb.right - vb.left) * k, (vb.bottom - vb.top) * k);
      }

      // Awareness: blips outside the pilot's radar detail range dim down.
      const nowMs = performance.now();
      if (heli.reconPulse) {
        if (!heli._nextPulse) heli._nextPulse = nowMs + 30000;
        if (nowMs > heli._nextPulse) {
          heli._reconUntil = nowMs + 10000;
          heli._nextPulse = nowMs + 30000;
        }
      }
      const reconActive = heli._reconUntil > nowMs;
      const revealR = 1900 * (heli.radarRange || 1);
      const blipAlpha = (wx, wy) => {
        if (reconActive || heli.fullSpectrum) return 1;
        const d = Math.hypot(wx - heli.x, wy - heli.y);
        return d < revealR ? 1 : 0.25;
      };

      // Places are geography on the map, not hostile icons.
      for (const place of world.places) {
        ctx.globalAlpha = blipAlpha(place.x, place.y) * (place.discovered ? 0.9 : 0.38);
        ctx.fillStyle =
          place.category === 'military'
            ? 'rgba(190,120,70,0.42)'
            : place.category === 'industrial'
              ? 'rgba(190,165,95,0.38)'
              : 'rgba(220,195,120,0.30)';
        ctx.strokeStyle =
          place.category === 'military'
            ? 'rgba(255,130,90,0.75)'
            : 'rgba(225,205,145,0.62)';
        ctx.lineWidth = 0.8;
        const polygon = place.footprint || [];
        if (polygon.length >= 3) {
          ctx.beginPath();
          ctx.moveTo(mx(polygon[0].x), my(polygon[0].y));
          for (let i = 1; i < polygon.length; i++) ctx.lineTo(mx(polygon[i].x), my(polygon[i].y));
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillRect(mx(place.x) - 1.5, my(place.y) - 1.5, 3, 3);
        }
      }
      ctx.globalAlpha = 1;

      // Contacts are a tactical layer, revealed separately from place identity.
      for (const encounter of world.encounters) {
        if (!encounter.discovered && blipAlpha(encounter.x, encounter.y) < 1) continue;
        ctx.globalAlpha = encounter.discovered ? 1 : 0.35;
        ctx.fillStyle = encounter.cleared ? '#3f7f3f' : '#ff5544';
        const ex = mx(encounter.x);
        const ey = my(encounter.y);
        ctx.beginPath();
        ctx.arc(ex, ey, encounter.cleared ? 1.8 : 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      const objectiveTarget = world.objective?.target;
      if (objectiveTarget) {
        const pr = 4 + Math.sin(performance.now() / 180) * 1.5;
        ctx.strokeStyle = '#ffcc44';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(mx(objectiveTarget.x), my(objectiveTarget.y), pr, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Convoys — heading ticks
      for (const c of world.convoys) {
        if (c.destroyed || !c.active) continue;
        ctx.globalAlpha = blipAlpha(c.x, c.y);
        const cx2 = mx(c.x),
          cy2 = my(c.y);
        ctx.strokeStyle = '#ff8844';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx2 - Math.cos(c.angle) * 3, cy2 - Math.sin(c.angle) * 3);
        ctx.lineTo(cx2 + Math.cos(c.angle) * 3, cy2 + Math.sin(c.angle) * 3);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // Fuel depots (orange diamonds — timer bonuses)
      for (const d of world.fuelDepots || []) {
        if (d.destroyed) continue;
        ctx.globalAlpha = blipAlpha(d.x, d.y);
        ctx.fillStyle = '#ff8844';
        ctx.save();
        ctx.translate(mx(d.x), my(d.y));
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-2, -2, 4, 4);
        ctx.restore();
        ctx.globalAlpha = 1;
      }
      // Extraction = leave the map: highlight the nearest map edge
      if (world.extraction?.active) {
        const lim = WORLD_SIZE * 0.48;
        const ep = nearestExitPoint();
        ctx.strokeStyle = '#44ddff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        if (ep.card === 'N') {
          ctx.moveTo(mx(-lim), my(-lim));
          ctx.lineTo(mx(lim), my(-lim));
        } else if (ep.card === 'S') {
          ctx.moveTo(mx(-lim), my(lim));
          ctx.lineTo(mx(lim), my(lim));
        } else if (ep.card === 'W') {
          ctx.moveTo(mx(-lim), my(-lim));
          ctx.lineTo(mx(-lim), my(lim));
        } else {
          ctx.moveTo(mx(lim), my(-lim));
          ctx.lineTo(mx(lim), my(lim));
        }
        ctx.stroke();
      }
      // Boss
      if (boss.spawned && boss.state !== 'dead') {
        ctx.fillStyle = '#ff2222';
        ctx.beginPath();
        ctx.arc(mx(boss.x), my(boss.y), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Player wedge
      ctx.save();
      ctx.translate(mx(heli.x), my(heli.y));
      ctx.rotate(heli.angle);
      ctx.fillStyle = '#66ff66';
      ctx.beginPath();
      ctx.moveTo(5, 0);
      ctx.lineTo(-4, -3.5);
      ctx.lineTo(-4, 3.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.restore(); // circular clip

      // Cardinal N marker on the bezel
      ctx.fillStyle = 'rgba(170,255,136,0.8)';
      ctx.font = 'bold 8px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('N', ccx, mmY - 8);
      drawCornerBrackets(ctx, mmX - 4, mmY - 4, mmS + 8, mmS + 8, 'rgba(90,140,80,0.55)', 10, 1.5);
    }

    // ── BOTTOM-CENTRE: compass tape + speed ─────────────────────────────
    if (cpW >= 130) {
      const cx = W / 2,
        cy = stY + stH / 2;
      hudPlate(ctx, cx - cpW / 2, cy - cpH / 2, cpW, cpH, 'rgba(90,140,80,0.55)');
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx - cpW / 2 + 6, cy - cpH / 2, cpW - 12, cpH);
      ctx.clip();
      const headingDeg = ((heli.angle * 180) / Math.PI + 90 + 360) % 360;
      const pxPerDeg = 2.1;
      ctx.font = 'bold 9px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let d = Math.floor((headingDeg - 70) / 15) * 15; d <= headingDeg + 70; d += 15) {
        const x = cx + (d - headingDeg) * pxPerDeg;
        const dd = ((d % 360) + 360) % 360;
        const major = dd % 90 === 0;
        ctx.strokeStyle = major ? 'rgba(170,255,136,0.8)' : 'rgba(120,160,100,0.45)';
        ctx.lineWidth = major ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(x, cy - cpH / 2 + 6);
        ctx.lineTo(x, cy - cpH / 2 + (major ? 14 : 10));
        ctx.stroke();
        if (major) {
          const lbl = ['N', 'E', 'S', 'W'][dd / 90];
          ctx.fillStyle = lbl === 'N' ? '#aaff88' : P.ui.textDim;
          ctx.fillText(lbl, x, cy - cpH / 2 + 22);
        }
      }
      // Bearing markers: objective (amber) / exit (cyan) — clamped to tape ends
      const bearingMarker = (wx, wy, col) => {
        const b = ((Math.atan2(wy - heli.y, wx - heli.x) * 180) / Math.PI + 90 + 360) % 360;
        let off = b - headingDeg;
        while (off > 180) off -= 360;
        while (off < -180) off += 360;
        const x = cx + clamp(off, -68, 68) * pxPerDeg;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(x, cy - cpH / 2 + 4);
        ctx.lineTo(x - 3.5, cy - cpH / 2 - 1);
        ctx.lineTo(x + 3.5, cy - cpH / 2 - 1);
        ctx.closePath();
        ctx.fill();
      };
      const objFocusC = getObjectiveFocus();
      if (objFocusC) bearingMarker(objFocusC.x, objFocusC.y, '#ffcc44');
      if (world?.extraction?.active) {
        const ep = nearestExitPoint();
        bearingMarker(ep.x, ep.y, '#44ddff');
      }
      // Caret + numeric heading
      ctx.fillStyle = P.ui.textBright;
      ctx.beginPath();
      ctx.moveTo(cx, cy - cpH / 2 + 2);
      ctx.lineTo(cx - 4, cy - cpH / 2 - 3);
      ctx.lineTo(cx + 4, cy - cpH / 2 - 3);
      ctx.closePath();
      ctx.fill();
      ctx.font = 'bold 9px "Courier New", monospace';
      ctx.fillStyle = P.ui.text;
      ctx.fillText(`${Math.round(headingDeg)}°`, cx, cy + cpH / 2 - 8);
      ctx.restore();

      // Speed readout at the right end of the compass plate
      const spdNow = Math.round(Math.hypot(heli.vx, heli.vy));
      ctx.font = 'bold 9px "Courier New", monospace';
      ctx.fillStyle = P.ui.textDim;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${spdNow}`, cx + cpW / 2 - 26, cy);
      ctx.fillStyle = 'rgba(120,160,100,0.6)';
      ctx.fillText('SPD', cx + cpW / 2 - 26, cy + 10);
    }

    // ── BOTTOM-RIGHT: sortie stats ──────────────────────────────────────
    {
      hudPlate(ctx, stX, stY, stW, stH, 'rgba(90,140,80,0.55)');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const secs = Math.floor((performance.now() - GameState.sortieStartedAt) / 1000);
      const tStr = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      const clearedN = world ? world.encounters.filter((encounter) => encounter.cleared).length : 0;
      const totalEncounters = world ? world.encounters.length : 0;
      ctx.font = 'bold 11px "Courier New", monospace';
      ctx.fillStyle = P.ui.text;
      ctx.fillText(`KILLS ${sortieState.stats.kills}`, stX + 14, stY + 12);
      ctx.fillText(`TIME ${tStr}`, stX + 14, stY + 32);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffcc44';
      ctx.fillText(`CONTACTS ${clearedN}/${totalEncounters}`, stX + stW - 14, stY + 12);
      ctx.font = 'bold 9px "Courier New", monospace';
      ctx.fillStyle = 'rgba(90,130,80,0.8)';
      ctx.fillText(`FPS ${GameState.lastFps}`, stX + stW - 14, stY + 32);
      ctx.textAlign = 'left';
    }

    // ── Target-MODE chip (touch: sits on the mode tap-zone near fire) ──
    if (IS_TOUCH) {
      const chipW = 118,
        chipH = 24;
      const chipX = W - chipW - 10,
        chipY = H * 0.36 - chipH / 2;
      hudPlate(ctx, chipX, chipY, chipW, chipH, 'rgba(90,140,80,0.55)');
      const modeLabel =
        { closest: 'CLOSEST', strongest: 'STRONGEST', infrastructure: 'INFRA' }[heli.targetMode] ||
        'CLOSEST';
      ctx.font = 'bold 9px "Courier New", monospace';
      ctx.fillStyle = P.ui.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`MODE ▸ ${modeLabel}`, chipX + chipW / 2, chipY + chipH / 2 + 0.5);
    }

    // ── Objective + extraction direction markers (drawn above all plates) ──
    {
      const focus = getObjectiveFocus();
      if (focus)
        drawOffscreenMarker(ctx, camera, W, H, focus.x, focus.y, '#ff5544', '#ff9966', null, uiS);
      if (world?.extraction?.active) {
        const ep = nearestExitPoint();
        drawOffscreenMarker(
          ctx,
          camera,
          W,
          H,
          ep.x,
          ep.y,
          '#44ddff',
          '#88ddff',
          `EXIT ${ep.card}`,
          uiS
        );
      }
    }

    // Controls hint — fades out after the first seconds of a sortie,
    // lifted above the bottom HUD row.
    {
      const age = (performance.now() - GameState.sortieStartedAt) / 1000;
      const alpha = clamp(1 - (age - 10) / 3, 0, 1) * 0.55;
      if (alpha > 0.01) {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = P.ui.text;
        ctx.font = '9px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('MOUSE STEER · CLICK FIRE · V MODE · E EQUIP · P SETTINGS', W / 2, mmY - 10);
        ctx.globalAlpha = 1;
      }
    }

    // ── Boss warning (pointing toward spawn direction) ──
    if (bossState.warning && !bossState.spawned) {
      // Flashing corner brackets instead of a full border
      const flash = Math.sin(performance.now() / 150) > 0;
      if (flash) {
        drawCornerBrackets(ctx, 4, 4, W - 8, H - 8, '#ff4444', 42, 5);
      }
      // Warning text
      ctx.fillStyle = '#ff4444';
      ctx.font = 'bold 16px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('! INCOMING HOSTILE !', W / 2, H / 2 - 60);
      ctx.font = '12px "Courier New", monospace';
      ctx.fillText(`ARRIVING IN ${Math.ceil(bossState.warningTimer)}s`, W / 2, H / 2 - 40);
    }

    ctx.restore();
    if (sortieState.levelUpOpen) drawFearUpgradeOverlay(ctx, cam);
  },
});

function drawSettings(ctx, cam) {
  const dpr = cam.dpr;
  const w = cam.screenW;
  const h = cam.screenH;
  ctx.save();
  ctx.scale(dpr, dpr);

  // Dimmed backdrop
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, w, h);

  const L = layoutOf(w, h);
  const cx = w / 2,
    cy = h / 2;
  const panelW = Math.min(460, L.content.w);
  const panelH = Math.min(360, h - L.pad * 2);
  ctx.fillStyle = '#0a1a0a';
  ctx.fillRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH);
  ctx.strokeStyle = '#3a5a2a';
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH);
  drawCornerBrackets(ctx, cx - panelW / 2, cy - panelH / 2, panelW, panelH, P.ui.borderHi, 14, 2);

  // Title
  ctx.fillStyle = P.ui.textBright;
  ctx.font = 'bold 16px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('PAUSE — SETTINGS', cx, cy - panelH / 2 + 14);

  ctx.strokeStyle = '#3a5a2a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 100, cy - panelH / 2 + 38);
  ctx.lineTo(cx + 100, cy - panelH / 2 + 38);
  ctx.stroke();

  const optX = cx - panelW / 2 + 24;
  let optY = cy - panelH / 2 + 52;
  const lineH = 36;

  function drawOption(label, enabled) {
    ctx.fillStyle = '#1a2a1a';
    ctx.fillRect(optX, optY, 22, 22);
    ctx.strokeStyle = enabled ? P.ui.textBright : '#446633';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(optX, optY, 22, 22);
    if (enabled) {
      ctx.fillStyle = P.ui.textBright;
      ctx.fillRect(optX + 5, optY + 5, 12, 12);
    }
    // Label
    ctx.fillStyle = P.ui.text;
    ctx.font = '12px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(label, optX + 32, optY + 4);
    optY += lineH;
  }

  drawOption('Autofire (F key)', input.autofire);
  drawOption('Click to Target (T key)', input.clickToTarget);
  optY += 8;

  // Abandon option (in-sortie only)
  if (currentScreen === screens.sortie && sortieState.status === 'active') {
    ctx.fillStyle = '#ff7744';
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Q — ABANDON SORTIE', optX, optY);
    optY += lineH;
  }

  // Close hint
  ctx.fillStyle = P.ui.textDim;
  ctx.font = '11px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Press ESC or P to close', cx, cy + panelH / 2 - 24);

  // Controls reference
  ctx.fillStyle = P.ui.textDim;
  ctx.font = '10px "Courier New", monospace';
  ctx.textAlign = 'left';
  const refX = cx - panelW / 2 + 24;
  optY = cy + panelH / 2 - 70;
  ctx.fillText('Mouse: steer', refX, optY);
  optY += 16;
  ctx.fillText('Click / Space: fire', refX, optY);
  optY += 16;
  ctx.fillText('Shift: cycle target', refX, optY);
  optY += 16;
  ctx.fillText('WASD: move', refX, optY);
  optY += 16;

  ctx.restore();
}

function drawEnemy(ctx, e) {
  return _drawEnemy(ctx, e);
}

function drawBoss(ctx) {
  _setBoss(boss);
  return _drawBoss(ctx);
}

function drawHunter(ctx) {
  _setBoss(boss);
  return _drawHunter(ctx);
}

function getCanvasClickPos(e) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return {
    x: (e.clientX - rect.left) * dpr,
    y: (e.clientY - rect.top) * dpr,
  };
}

function pointInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

canvas.addEventListener('click', (e) => {
  if (sortieState.levelUpOpen) {
    const cam = camera;
    const w = cam.screenW;
    const pos = getCanvasClickPos(e);
    const dpr = cam.dpr;
    const rects = fearUpgradeRects(w, cam.screenH);
    for (let i = 0; i < sortieState.upgradeChoices.length; i++) {
      const r = rects[i];
      if (
        pos.x >= r.x * dpr &&
        pos.x <= (r.x + r.w) * dpr &&
        pos.y >= r.y * dpr &&
        pos.y <= (r.y + r.h) * dpr
      ) {
        chooseFearUpgrade(i);
        return;
      }
    }
    return;
  }

  const pos = getCanvasClickPos(e);
  const cam = camera;
  if (settingsOpen) {
    toggleSettings();
    return;
  }
  const w = cam.screenW * cam.dpr;
  const h = cam.screenH * cam.dpr;
  if (currentScreen === screens.hangar) {
    const r = handleHangarClick(pos.x, pos.y, cam.dpr);
    if (r === 'back') switchScreen(metaReturnScreen);
    return;
  }
  if (currentScreen === screens.pilot) {
    const r = handlePilotClick(pos.x, pos.y, cam.dpr);
    if (r === 'back') switchScreen(metaReturnScreen);
    return;
  }
  if (currentScreen === screens.splash) {
    switchScreen('menu');
    return;
  }
  if (
    currentScreen === screens.menu ||
    currentScreen === screens.newPilot ||
    currentScreen === screens.loadPilot
  ) {
    const box = hitFlowBox(pos, cam.dpr);
    if (!box) return;
    const ev = applyFlowBox(box);
    if (!ev || ev.type === 'stay') return;
    if (ev.type === 'settings') {
      toggleSettings();
      return;
    }
    if (ev.type === 'quit') {
      switchScreen('splash');
      return;
    }
    if (ev.type === 'menu') {
      hideNameField();
      switchScreen('menu');
      return;
    }
    if (ev.type === 'newPilot') {
      switchScreen('newPilot');
      return;
    }
    if (ev.type === 'loadPilot') {
      switchScreen('loadPilot');
      return;
    }
    if (ev.type === 'continue') {
      if (adoptCareer(continueCareer())) switchScreen('title');
      return;
    }
    if (ev.type === 'confirm') {
      if (adoptCareer(confirmNewPilot())) switchScreen('title');
      return;
    }
    if (ev.type === 'load' && ev.id) {
      if (adoptCareer(loadSlot(ev.id))) switchScreen('title');
    }
    return;
  }
  if (currentScreen === screens.title) {
    for (const box of GameState.titleMenuBoxes) {
      if (
        pos.x >= box.x * cam.dpr &&
        pos.x <= (box.x + box.w) * cam.dpr &&
        pos.y >= box.y * cam.dpr &&
        pos.y <= (box.y + box.h) * cam.dpr
      ) {
        if (box.action === 'menu') {
          hideNameField();
          switchScreen('menu');
          return;
        }
        metaReturnScreen = 'title';
        switchScreen(box.target);
        return;
      }
    }
    return;
  } else if (currentScreen === screens.contracts) {
    if (posInBox(pos, contractsBackBox, cam.dpr)) {
      switchScreen('title');
      return;
    }
    for (let i = 0; i < GameState.contractBoard.length; i++) {
      const r = contractCardRect(i, w / cam.dpr, h / cam.dpr);
      const scaled = { x: r.x * cam.dpr, y: r.y * cam.dpr, w: r.w * cam.dpr, h: r.h * cam.dpr };
      if (pointInRect(pos.x, pos.y, scaled)) {
        switchScreen('briefing', GameState.contractBoard[i]);
        break;
      }
    }
  } else if (currentScreen === screens.briefing) {
    if (posInBox(pos, briefingBackBox, cam.dpr)) {
      switchScreen('contracts');
      return;
    }
    // Equipment selector first — a click on a box selects instead of launching.
    for (const box of GameState.briefingEquipmentBoxes) {
      if (posInBox(pos, box, cam.dpr)) {
        GameState.setSelectedEquipment(box.key);
        return;
      }
    }
    if (posInBox(pos, briefingLaunchBox, cam.dpr)) switchScreen('sortie', GameState.activeContract);
  } else if (currentScreen === screens.debrief) {
    if (posInBox(pos, debriefPilotBox, cam.dpr)) {
      metaReturnScreen = 'title';
      switchScreen('pilot');
      return;
    }
    if (posInBox(pos, debriefNextBox, cam.dpr)) switchScreen('title');
  }
});

canvas.addEventListener('touchstart', (e) => {
  const touch = e.touches[0];
  canvas.dispatchEvent(
    new MouseEvent('click', {
      clientX: touch.clientX,
      clientY: touch.clientY,
    })
  );
});

const existingCareer = loadCareer();
if (existingCareer) {
  GameState.setCareer(existingCareer);
  metaState.career = existingCareer;
}
registerScreen('splash', splashScreen);
registerScreen('menu', menuScreen);
registerScreen('newPilot', newPilotScreen);
registerScreen('loadPilot', loadPilotScreen);
registerScreen('hangar', hangarScreen);
registerScreen('pilot', pilotScreen);

switchScreen('splash');
console.log('[Gunship] starting loop');
requestAnimationFrame(loop);
