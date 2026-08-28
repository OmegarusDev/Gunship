/**
 * Entry point — game loop, screen router, DPR-aware canvas.
 */
console.log('[Gunship] app.js loading...');

import { SIM_HZ, SIM_DT, WORLD_SIZE, TIMER, CIVILIAN_ESCAPE_RADIUS, CAMERA, COMBAT, HUD } from './config.js';
import { WorldCamera } from './camera.js';
import { Input } from './input.js';
import { P, mats } from './palette.js';
import { VIEW25, deckRy } from './view25.js';
import { cyl25, box25, frustum25 } from './prims25.js';
import { withAlpha, fillCircle, drawLine, drawTextShadow } from './drawUtil.js';
import { mulberry32 } from './rng.js';
import { clamp } from './rng.js';
import { createNoise } from './noise.js';
import { generateWorld, getBuildingTemplate, getSpeedMod, ARCHETYPES } from './world.js';
import { createTerrain } from './terrain.js';
import { drawCornerBrackets, drawBackButton } from './appBridge.js';
import {
  metaState, createCareer, loadCareer, commitSortieOutcome, applyCareerToHeli,
  gainXp, xpToNext, saveCareer,
} from './meta.js';
import { hangarScreen, pilotScreen, handleHangarClick, handlePilotClick } from './screens_meta.js';
import { createEnemyFromRoster } from './data/enemies.js';
import { createContractBoard, getDifficulty as getDifficultyProfile, getScenario, getStyle } from './contracts.js';
import { createUpgradeChoices } from './upgrades.js';
import { FEAR_THRESHOLDS as _FEAR_THRESHOLDS, HEAT_LABELS as _HEAT_LABELS, EQUIPMENT as _EQUIPMENT, hunterClockRate as _hunterClockRate } from './sim/state.js';
import { nearestRoadPoint as _nearestRoadPoint, steerAlongRoads as _steerAlongRoads, vehicleSpeedFactor as _vehicleSpeedFactor, pointAlongRoute as _pointAlongRoute, getConvoyMembers as _getConvoyMembers } from './sim/movement.js';
import { isTargetAlive as _isTargetAlive, objectiveComplete as _objectiveComplete, canExtract as _canExtract, getObjectiveFocus as _getObjectiveFocus, nearestExitPoint as _nearestExitPoint } from './sim/objectives.js';
import { setTerrain as _setTerrain, drawSmoothTerrain as _drawSmoothTerrain } from './render/terrain.js';
import { drawRoads as _drawRoads, getMiniRoads as _getMiniRoads } from './render/roads.js';
import { hudPlate as _hudPlate, plateHeader as _plateHeader, hudBar as _hudBar, drawOffscreenMarker as _drawOffscreenMarker } from './render/hud.js';
import { drawBuilding as _drawBuilding, drawSites as _drawSites, drawDecorations as _drawDecorations, drawScenarioOverlays as _drawScenarioOverlays, setWorldState as _setWorldState } from './render/world.js';
import { drawHeliShadow as _drawHeliShadow, drawGunship as _drawGunship, drawEnemy as _drawEnemy, drawBoss as _drawBoss, drawHunter as _drawHunter, setBoss as _setBoss } from './render/entities.js';
import * as GameState from './sim/gameState.js';

const canvas = document.getElementById('game');
const camera = new WorldCamera(canvas);
const input = new Input(canvas);

const screens = {};
let currentScreen = null;

export function registerScreen(name, screen) { screens[name] = screen; }

export function switchScreen(name, data) {
  if (currentScreen && currentScreen.exit) currentScreen.exit();
  currentScreen = screens[name];
  if (currentScreen && currentScreen.enter) currentScreen.enter(data);
}

let accumulator = 0;
let lastTime = performance.now();

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
      if (!settingsOpen && !sortieState.levelUpOpen && currentScreen && currentScreen.tick) currentScreen.tick(SIM_DT);
      accumulator -= SIM_DT;
      safety++;
    }
    // Preserve sub-tick remainder for determinism; clamp spiral on long hitches
    if (accumulator > 0.1) accumulator = 0;
    accumulator = Math.max(0, accumulator);
    input.consumeOneShots();
    camera.tick(dt);
    camera.clear(camera.ctx, '#1a1a0a');
    if (currentScreen && currentScreen.draw) {
      currentScreen.draw(camera.ctx, camera, dt);
    }
    input.draw(camera.ctx);
    const fps = rawDt > 0 ? Math.round(1 / rawDt) : 0;
    lastFps = fps;

    // ── Settings overlay ──
    if (settingsOpen) {
      drawSettings(camera.ctx, camera);
    }
  } catch (err) {
    console.error('[Gunship]', err);
  }
  requestAnimationFrame(loop);
}

function lerp(a, b, t) { return a + (b - a) * t; }

let settingsOpen = false;
// Sortie start timestamp — used to fade the on-screen controls hint.
let sortieStartedAt = performance.now();
let lastFps = 0;
const IS_TOUCH = typeof window !== 'undefined' && ('ontouchstart' in window);
let modeToastUntil = 0; // targeting-mode banner expiry (performance.now clock)

// Position of the player's most recent gunshot — civilians panic only
// when gunfire happens near them (or their site's defenders open up).
let lastShotX = 0, lastShotY = 0, lastShotT = -999;

// ── Equipment — one usable item per sortie, chosen at briefing (now from sim/state) ────────────
const EQUIPMENT = _EQUIPMENT;
let selectedEquipment = 'rocket';
let briefingEquipmentBoxes = [];
let briefingBackBox = null;
let briefingInsertBox = null;
let contractsBackBox = null;
let debriefNextBox = null;
let debriefPilotBox = null;

// ── Road network queries — delegated to sim/movement (app.js stays thin) ──
let _roadSegsCache = null; // legacy shim — movement.js owns the real cache
let _miniRoadsCache = null; // minimap road layer now via render/roads
function getRoadSegs() { return null; } // shim retained for any legacy callers
function nearestRoadPoint(x, y, maxDist) { return _nearestRoadPoint(world, x, y, maxDist); }
function steerAlongRoads(desiredAngle, x, y) { return _steerAlongRoads(world, desiredAngle, x, y); }
const TERRAIN_VEHICLE_SPEED = { hardpack: 1.1, sand: 1.0, gravel: 0.95, wadi: 0.9, oasis: 0.7, dunes: 0.6, rock: 0.5 };
function vehicleSpeedFactor(x, y) { return _vehicleSpeedFactor(world, sharedTerrain, x, y); }
const CONVOY_GAP_VEH = 30, CONVOY_GAP_INF = 17;
function pointAlongRoute(convoy, s) { return _pointAlongRoute(convoy, s); }
function getConvoyMembers(convoy) { return _getConvoyMembers(convoy); }

function toggleSettings() {
  settingsOpen = !settingsOpen;
}

// ══════════════════════════════════════════════════════════════
//  WORLD RENDERING — smooth noise terrain, roads, sites
// ══════════════════════════════════════════════════════════════

let world = null;
let sharedTerrain = null;

// ── Career (pilot + wallet + hangar) — persisted, loaded at boot ──
let career = null;
let sortieXpEarned = 0;
let sortieDollarsEarned = 0;
let metaReturnScreen = 'title'; // hangar/pilot BACK returns here
let titleMenuBoxes = [];
let terrainNoise = null;
let moistureNoise = null;
let detailNoise = null;
// Sync to GameState for sortie screen sharing (see js/sim/gameState.js)

let contractBoard = [];
let activeContract = null;

const sortieState = GameState.sortieState; // shared

/** Pre-rendered minimap road layer at a given size (cached per world). */
function getMiniRoads(S) { return _getMiniRoads(world, S); }
// minimap road cache now in render/roads.js

function initWorld(contract = null) {
  const seed = contract?.seed ?? 42;
  sharedTerrain = createTerrain(seed, WORLD_SIZE);
  world = generateWorld({ seed, contract, terrain: sharedTerrain });
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

/** Spawn all outdoor (non-indoor) enemies at sites immediately. */
function spawnOutdoorEnemies() {
  if (!world) return;
  for (const s of world.sites) {
    const difficulty = getDifficultyForEnemy(s.x, s.y);
    for (const entry of s.enemies) {
      if (entry.isIndoor) continue;
      const enemy = createEnemyFromRoster(entry, s.x, s.y, difficulty);
      if (enemy) {
        enemy.siteId = s.id;
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
  const difficulty = getDifficultyProfile(activeContract?.difficultyId);
  return (1 + dist / 2500) * difficulty.radialMultiplier;
}

function applyEnemyDifficulty(enemy) {
  const difficulty = getDifficultyProfile(activeContract?.difficultyId);
  enemy.maxHp = Math.max(1, Math.round(enemy.maxHp * difficulty.enemyHpMultiplier));
  enemy.hp = enemy.maxHp;
  enemy.damage = Math.max(1, enemy.damage * difficulty.enemyDamageMultiplier);
}

// ── Terrain rendering — delegated to render/terrain.js ──
function drawSmoothTerrain(ctx, cam) { return _drawSmoothTerrain(ctx, cam); }
// BIOME, sampleTerrain, updateTerrainGrid, grain/mottle/macro live in render/terrain.js
// Call _setTerrain(sharedTerrain, terrainNoise, moistureNoise, detailNoise) after initWorld.

// ── Roads — delegated to render/roads.js ──
function drawRoads(ctx, cam) { return _drawRoads(ctx, cam, world); }
// ROAD_STYLE + shadeHex now live in render/roads.js

function drawSites(ctx, cam) { _setWorldState(world, heli, enemies, boss); return _drawSites(ctx, cam); }

function drawDecorations(ctx, cam) { _setWorldState(world, heli, enemies, boss); return _drawDecorations(ctx, cam); }

function drawScenarioOverlays(ctx, cam) { _setWorldState(world, heli, enemies, boss); return _drawScenarioOverlays(ctx, cam); }

function drawBuilding(ctx, b) { return _drawBuilding(ctx, b); }

function drawHeliShadow(ctx, h) { return _drawHeliShadow(ctx, h); }

function drawGunship(ctx, h) { return _drawGunship(ctx, h); }

// ══════════════════════════════════════════════════════════════
//  PROJECTILES
// ══════════════════════════════════════════════════════════════

const projectiles = GameState.projectiles; // shared
const explosions = GameState.explosions; // shared

function spawnProjectile(x, y, angle, speed, damage, isEnemy = false, life = 2.0) {
  projectiles.push({
    x, y,
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
//  ENEMIES — site-centric spawning
// ══════════════════════════════════════════════════════════════

const enemies = GameState.enemies; // shared
const floatingTexts = GameState.floatingTexts; // shared // CLEAR! popups and damage numbers

/** Calculate difficulty multiplier based on distance from center. */
function getDifficulty(worldX, worldY) {
  const dist = Math.hypot(worldX, worldY);
  const difficulty = getDifficultyProfile(activeContract?.difficultyId);
  return (1 + (dist / 2500)) * difficulty.radialMultiplier;
}

/** Discover a site: spawn indoor enemies who burst from buildings. */
function discoverSettlement(settlement) {
  if (settlement.discovered) return;
  settlement.discovered = true;
  sortieState.stats.sites++;

  const difficulty = getDifficulty(settlement.x, settlement.y);

  for (const entry of settlement.enemies) {
    if (!entry.isIndoor) continue;
    try {
      const enemy = createEnemyFromRoster(entry, settlement.x, settlement.y, difficulty);
      if (enemy) {
        enemy.siteId = settlement.id;
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

/** Check if a settlement is cleared (all enemies dead). */
function checkSettlementClear(settlement) {
  if (settlement.cleared) return false;
  const alive = enemies.filter(e => e.siteId === settlement.id && e.state !== 'dead');
  if (alive.length === 0 && settlement.discovered && settlement.enemies.length > 0) {
    settlement.cleared = true;
    // Spawn CLEAR! popup
    floatingTexts.push({
      x: settlement.x,
      y: settlement.y - 30,
      text: 'CLEAR!',
      color: '#44ff44',
      life: 1.5,
      maxLife: 1.5,
      vy: -40, // float upward
    });
    // Score bonus
    const arch = world.sites.find(v => v.id === settlement.id);
    if (arch) {
      const dist = Math.hypot(settlement.x, settlement.y);
      const bonus = Math.floor(50 + dist * 0.02);
      heli.score += bonus;
      // Career earnings: Dollars from the site's wealth range, XP bonus.
      if (arch && ARCHETYPES[arch.archetype]) {
        const range = ARCHETYPES[arch.archetype].dollars;
        sortieDollarsEarned += Math.floor(range[0] + Math.random() * (range[1] - range[0]));
        GameState.setSortieDollars(sortieDollarsEarned);
        sortieXpEarned += 30;
        GameState.setSortieXp(sortieXpEarned);
      }
      floatingTexts.push({
        x: settlement.x,
        y: settlement.y - 50,
        text: `+${bonus}`,
        color: '#ffcc44',
        life: 1.2,
        maxLife: 1.2,
        vy: -30,
      });
    }
    return true;
  }
  return false;
}

/** Spawn a floating text popup (CLEAR!, damage numbers, etc). */
function spawnFloatingText(x, y, text, color) {
  floatingTexts.push({
    x, y, text, color,
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
  const difficulty = getDifficultyProfile(activeContract?.difficultyId);
  bossState.timeRemaining = TIMER.baseTime * difficulty.hunterEtaMultiplier;
  bossState.active = true;
  bossState.warning = false;
  bossState.warningTimer = 0;
  bossState.spawned = false;
  bossState.defeated = false;
  bossState.clearedSettlements = 0;
}

function resetBoss() {
  boss.hp = 0; boss.maxHp = 0;
  boss.state = 'approach';
  boss.spawned = false;
}

/** Spawn the boss from a random map edge direction. */
function spawnBoss() {
  const seed = activeContract?.seed ?? 42;
  const rng = mulberry32((seed + 8800) >>> 0);
  const angle = rng() * Math.PI * 2;
  const spawnDist = WORLD_SIZE * 0.55; // just outside playable area
  boss.x = Math.cos(angle) * spawnDist;
  boss.y = Math.sin(angle) * spawnDist;
  boss.spawnAngle = angle;
  boss.angle = angle + Math.PI; // face toward the theatre
  const difficulty = getDifficultyProfile(activeContract?.difficultyId);
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

/** Apply settlement clear penalty to boss timer. */
function applyClearPenalty(village) {
  const archetype = village.archetype;
  const penalty = TIMER.clearPenalties[archetype] || 15;
  bossState.clearedSettlements++;
  floatingTexts.push({
    x: village.x,
    y: village.y - 70,
    text: `TIMER -${penalty}s`,
    color: '#ff8844',
    life: 1.5,
    maxLife: 1.5,
    vy: -25,
  });
  addHeat(Math.min(12, penalty * 0.35), 'site cleared');
}

const FEAR_THRESHOLDS = _FEAR_THRESHOLDS;
const HEAT_LABELS = _HEAT_LABELS;

function resetSortieState() {
  const difficulty = getDifficultyProfile(activeContract?.difficultyId);
  sortieStartedAt = performance.now();
  hudAnim.hp = 100; hudAnim.fear = 0; hudAnim.heat = 0; hudAnim.hpFlash = 0;
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
  sortieState.stats.sites = 0;
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
  const style = getStyle(activeContract?.styleId);
  sortieState.heat.value = clamp(sortieState.heat.value + amount * (style.heatGainMultiplier || 1), 0, 100);
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
  if (reason && amount >= 5) spawnFloatingText(heli.x, heli.y - 24, `+${Math.round(amount)} FEAR`, '#ff8844');
}

function openFearUpgrade() {
  const level = sortieState.fearLevel || 1;
  const seed = ((activeContract?.seed ?? 42) + level * 7919 + sortieState.pendingLevelUps * 97) >>> 0;
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
  floatingTexts.push({ x: heli.x, y: heli.y - 30, text: card.name, color: '#aaff88', life: 1.5, maxLife: 1.5, vy: -25 });
  if (sortieState.pendingLevelUps > 0) openFearUpgrade();
}

function isTargetAlive(target) { return _isTargetAlive(world, boss, target); }

/** Semi-transparent backing plate for a HUD cluster, with corner ticks. */
function hudPlate(ctx, x, y, w, h, accent = 'rgba(90,140,80,0.55)') { return _hudPlate(ctx, x, y, w, h, accent); }
function plateHeader(ctx, px, py, pw, title, accent = P.ui.textDim) { return _plateHeader(ctx, px, py, pw, title, accent); }
function hudBar(ctx, x, y, w, h, frac, col, opts = {}) { return _hudBar(ctx, x, y, w, h, frac, col, opts); }
function drawOffscreenMarker(ctx, cam, w, h, wx, wy, color, textColor, tag, uiScale = 1) { return _drawOffscreenMarker(ctx, cam, w, h, wx, wy, color, textColor, tag, uiScale); }
// hud primitives now in render/hud.js

// Per-sortie HUD animation state (smooth bar chase + hit flash).
const hudAnim = { hp: 100, fear: 0, heat: 0, hpFlash: 0 };

function posInBox(pos, box, dpr) {
  return box && pos.x >= box.x * dpr && pos.x <= (box.x + box.w) * dpr &&
         pos.y >= box.y * dpr && pos.y <= (box.y + box.h) * dpr;
}

function getObjectiveFocus() { return _getObjectiveFocus(world, boss, enemies, heli); }
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
      sortieXpEarned += 40;
      GameState.setSortieXp(sortieXpEarned);
      sortieDollarsEarned += 60;
      GameState.setSortieDollars(sortieDollarsEarned);
      addFear(3, 'convoy ambushed');
      spawnFloatingText(target.x, target.y - 30, 'CONVOY DESTROYED', '#aaff88');
      spawnFloatingText(target.x, target.y - 48, '+150', '#ffcc44');
    }
    world.supplyCrates.push({
      id: `crate-wreck-${target.id}`,
      x: target.x + (Math.random() - 0.5) * 30,
      y: target.y + (Math.random() - 0.5) * 30,
      siteId: null,
      collected: false,
      objective: false,
      rewardType: pick(['repair', 'damage', 'speed', 'fear'], mulberry32((Date.now() & 0xffff))),
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
        if (heli.hp <= 0) { heli.hp = 0; finishSortie('failed'); }
      }
      for (const b of world.buildings) {
        if (b === target || b.destroyed) continue;
        if (Math.hypot(b.x - target.x, b.y - target.y) < 60) {
          damageWorldTarget(b, 45, b.x, b.y);
        }
      }
      // Depot fully flattened? Mark it for the minimap.
      if (target.depotId) {
        const depot = world.fuelDepots?.find(d => d.id === target.depotId);
        if (depot && world.buildings.every(b => b.depotId !== depot.id || b.destroyed)) {
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
  sortieState.rewards.objective = activeContract?.reward || 0;
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
  if (world.objective.type === 'strike') return `DESTROY ${world.objective.targetSiteName || 'COMMAND TARGET'}`;
  if (world.objective.type === 'sabotage') return `DISABLE ${world.objective.targetSiteName || 'RADAR RELAY'}`;
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
  if (!world?.extraction?.active || !sortieState.objectiveComplete || sortieState.status !== 'active') return;
  const lim = WORLD_SIZE * 0.48;
  if (Math.abs(heli.x) > lim || Math.abs(heli.y) > lim) finishSortie('complete');
}

/** Nearest boundary exit from the helicopter, with compass cardinal. */
function nearestExitPoint() { return _nearestExitPoint(heli); }

function finishSortie(status) {
  if (sortieState.status !== 'active') return;
  sortieState.status = status;
  bossState.active = false;
  sortieState.rewards.secured = status === 'complete'
    ? sortieState.rewards.objective + sortieState.rewards.supplies + sortieState.rewards.hunter
    : 0;
  sortieState.endTimer = 1.0;
  projectiles.length = 0;
  heli.target = null;
  heli.manualTarget = null;
  spawnFloatingText(heli.x, heli.y - 45, status === 'complete' ? 'SORTIE COMPLETE' : 'PILOT KIA', status === 'complete' ? '#aaff88' : '#ff4444');
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
      sortieState.heat.value = clamp(sortieState.heat.value - dt * 1.6 * heli.heatDecayMultiplier, 0, 100);
      updateHeatTier();
    }
  }
  if (sortieState.heat.eventTimer > 0) sortieState.heat.eventTimer -= dt;
}

function hunterClockRate() { return _hunterClockRate(sortieState, activeContract); }

// ══════════════════════════════════════════════════════════════
//  SCREENS
// ══════════════════════════════════════════════════════════════

registerScreen('title', {
  draw(ctx, cam) {
    const dpr = cam.dpr;
    const w = cam.screenW;
    const h = cam.screenH;
    ctx.save(); ctx.scale(dpr, dpr);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0a120a');
    grad.addColorStop(1, '#16240f');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    drawTacticalGrid(ctx, w, h);

    const cx = w / 2;
    const t = performance.now() / 1000;

    // Radar sweep backdrop behind the wordmark
    const sweepR = Math.min(w, h) * 0.34;
    ctx.globalAlpha = 0.5;
    drawRadarSweep(ctx, cx, h * 0.34, sweepR, t);
    ctx.globalAlpha = 1;

    // ── Wordmark ──
    const cy = h * 0.32;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const titleSize = Math.min(64, Math.max(40, Math.floor(w / 9)));
    ctx.font = `bold ${titleSize}px "Courier New", monospace`;
    // Layered shadow for depth
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillText('GUNSHIP', cx + 4, cy + 4);
    ctx.fillStyle = P.ui.borderHi;
    ctx.fillText('GUNSHIP', cx + 2, cy + 2);
    ctx.fillStyle = P.ui.textBright;
    ctx.fillText('GUNSHIP', cx, cy);

    // Subtitle bar
    const subY = cy + titleSize * 0.62;
    ctx.font = 'bold 15px "Courier New", monospace';
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

    // ── Main menu entries ──
    const menuW = Math.min(260, w - 60);
    const menuX = cx - menuW / 2;
    let my2 = h * 0.58;
    titleMenuBoxes = [];
    const entries = [
      { label: 'OPERATIONS', sub: 'SELECT CONTRACT', target: 'contracts' },
      { label: 'HANGAR', sub: 'BUY CHOPPER PARTS', target: 'hangar' },
      { label: 'PILOT RECORD', sub: 'LEVEL & SKILLS', target: 'pilot' },
    ];
    for (const entry of entries) {
      const mh = 42;
      ctx.fillStyle = 'rgba(20,40,16,0.65)';
      ctx.fillRect(menuX, my2, menuW, mh);
      ctx.strokeStyle = P.ui.borderHi;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(menuX, my2, menuW, mh);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = P.ui.textBright;
      ctx.font = 'bold 13px "Courier New", monospace';
      ctx.fillText(entry.label, cx, my2 + 14);
      ctx.font = '9px "Courier New", monospace';
      ctx.fillStyle = P.ui.textDim;
      ctx.fillText(entry.sub, cx, my2 + 30);
      titleMenuBoxes.push({ x: menuX, y: my2, w: menuW, h: mh, target: entry.target });
      my2 += mh + 10;
    }

    // Pilot + wallet readout
    const c = career || metaState.career;
    if (c) {
      ctx.font = 'bold 11px "Courier New", monospace';
      ctx.fillStyle = P.ui.text;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(`${c.pilot.name}  ·  LV ${c.pilot.level}`, cx, my2 + 8);
      ctx.fillStyle = '#ffcc44';
      ctx.fillText(`$ ${c.dollars}`, cx, my2 + 26);
    }

    // Footer
    ctx.textBaseline = 'bottom';
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = P.ui.textDim;
    ctx.fillText('A 90s GULF WAR ACTION-MOVIE HELICOPTER ROGUELITE', cx, h - 40);
    ctx.fillText('MOUSE STEER · CLICK FIRE · SHIFT TARGET · P PAUSE', cx, h - 24);

    drawCornerBrackets(ctx, 8, 8, w - 16, h - 16, 'rgba(90,140,80,0.5)', 22, 2);
    drawScanlines(ctx, w, h);
    ctx.restore();
  },
});

function drawFearUpgradeOverlay(ctx, cam) {
  const dpr = cam.dpr;
  const w = cam.screenW;
  const h = cam.screenH;
  ctx.save(); ctx.scale(dpr, dpr);
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#0a1a0a';
  ctx.fillRect(18, 28, w - 36, h - 56);
  ctx.strokeStyle = '#cc8833';
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 28, w - 36, h - 56);
  ctx.fillStyle = '#ffcc66';
  ctx.font = 'bold 20px "Courier New", monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('FEAR GROWS', w / 2, 48);
  ctx.fillStyle = P.ui.textDim;
  ctx.font = '10px "Courier New", monospace';
  ctx.fillText('SELECT ONE FIELD UPGRADE', w / 2, 76);

  const gap = 10;
  const cardW = Math.min(190, (w - 56 - gap * 2) / 3);
  const cardH = Math.min(190, h - 150);
  const left = (w - (cardW * 3 + gap * 2)) / 2;
  for (let i = 0; i < sortieState.upgradeChoices.length; i++) {
    const card = sortieState.upgradeChoices[i];
    const x = left + i * (cardW + gap);
    const y = 106;
    ctx.fillStyle = '#132a16';
    ctx.fillRect(x, y, cardW, cardH);
    ctx.strokeStyle = '#5a7a3a';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, cardW, cardH);
    ctx.fillStyle = '#aaff88';
    ctx.font = 'bold 11px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${i + 1}. ${card.name}`, x + cardW / 2, y + 18);
    ctx.fillStyle = P.ui.text;
    ctx.font = '10px "Courier New", monospace';
    const lines = wrapText(card.description, Math.max(14, Math.floor(cardW / 7)));
    for (let line = 0; line < lines.length; line++) {
      ctx.fillText(lines[line], x + cardW / 2, y + 58 + line * 16);
    }
    ctx.fillStyle = P.ui.textDim;
    ctx.fillText('CLICK TO INSTALL', x + cardW / 2, y + cardH - 22);
  }
  ctx.restore();
}

let debriefInfo = null;

registerScreen('debrief', {
  enter() {
    // Commit the sortie to the career: XP/levels if the pilot survived,
    // fresh pilot if KIA. Dollars always banked. Campaign advances on win.
    const res = commitSortieOutcome(career, sortieState.status, sortieXpEarned, sortieDollarsEarned);
    if (sortieState.status === 'complete') {
      career.campaign.sortie += 1;
      if (career.campaign.sortie > 4) { career.campaign.sortie = 1; career.campaign.act += 1; }
      saveCareer(career);
    }
    debriefInfo = {
      ...res,
      xp: sortieXpEarned,
      dollars: sortieDollarsEarned,
      level: career.pilot.level,
      pilotName: career.pilot.name,
      sp: career.pilot.skillPoints,
    };
    metaState.career = career;
  },
  draw(ctx, cam) {
    const w = cam.screenW;
    const h = cam.screenH;
    const success = sortieState.status === 'complete';
    const aborted = sortieState.status === 'abandoned';
    drawScreenBackground(ctx, cam,
      success ? 'SORTIE COMPLETE' : aborted ? 'SORTIE ABORTED' : 'PILOT KIA',
      success ? 'OPERATIONAL REPORT' : aborted ? 'PILOT RECOVERED' : 'SIGNAL LOST');
    ctx.save(); ctx.scale(cam.dpr, cam.dpr);
    const panelW = Math.min(420, w - 32);
    const panelH = Math.min(420, h - 130);
    const x = (w - panelW) / 2;
    const y = 84;
    ctx.fillStyle = '#0d210f'; ctx.fillRect(x, y, panelW, panelH);
    ctx.strokeStyle = success ? P.ui.border : aborted ? '#aa8844' : '#883333';
    ctx.lineWidth = 1.5; ctx.strokeRect(x, y, panelW, panelH);
    drawCornerBrackets(ctx, x, y, panelW, panelH,
      success ? P.ui.borderHi : aborted ? '#cc9944' : '#aa4444', 16, 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = success ? '#aaff88' : aborted ? '#ffcc44' : '#ff6666';
    ctx.font = 'bold 16px "Courier New", monospace';
    ctx.fillText(success ? 'MISSION SUCCESS' : aborted ? 'MISSION ABORTED' : 'MISSION FAILURE', x + 18, y + 18);
    ctx.fillStyle = P.ui.text;
    ctx.font = '11px "Courier New", monospace';
    const rows = [
      ['CONTRACT', activeContract?.name || 'UNKNOWN'],
      ['OBJECTIVE', sortieState.objectiveComplete ? 'COMPLETE' : 'INCOMPLETE'],
      ['KILLS', `${sortieState.stats.kills}`],
      ['SITES VISITED', `${sortieState.stats.sites}`],
      ['SUPPLY CACHES', `${sortieState.stats.crates}`],
      ['FEAR LEVEL', `${sortieState.fearLevel || 0}`],
      ['PEAK HEAT', `${Math.round(sortieState.heat.value)}`],
      ['SECURED PAY', `$${sortieState.rewards.secured}`],
      ['XP EARNED', debriefInfo ? `${debriefInfo.xp}${debriefInfo.died ? ' (LOST — KIA)' : ''}` : '0'],
      ['DOLLARS EARNED', `$${debriefInfo ? debriefInfo.dollars : 0}`],
      ['PILOT LEVEL', debriefInfo ? `LV ${debriefInfo.level}${debriefInfo.levelsGained ? ` (+${debriefInfo.levelsGained})` : ''}` : '—'],
    ];
    for (let i = 0; i < rows.length; i++) {
      ctx.fillStyle = i === rows.length - 1 ? '#ffcc44' : P.ui.text;
      ctx.fillText(`${rows[i][0].padEnd(16, ' ')} ${rows[i][1]}`, x + 18, y + 58 + i * 22);
    }
    // Career callouts flow below the rows
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    let cy2 = y + 58 + rows.length * 22 + 12;
    if (debriefInfo?.died) {
      ctx.fillStyle = '#ff6666';
      ctx.font = 'bold 11px "Courier New", monospace';
      ctx.fillText('PILOT KIA — NEW PILOT ASSIGNED TO THE CAMPAIGN', x + 18, cy2);
      cy2 += 20;
    } else if (debriefInfo?.levelsGained) {
      ctx.fillStyle = '#44cccc';
      ctx.font = 'bold 11px "Courier New", monospace';
      ctx.fillText(`LEVEL UP — ${debriefInfo.sp} SKILL POINT${debriefInfo.sp === 1 ? '' : 'S'} AVAILABLE`, x + 18, cy2);
      cy2 += 20;
    } else if (debriefInfo && debriefInfo.sp > 0) {
      ctx.fillStyle = '#44cccc';
      ctx.font = 'bold 11px "Courier New", monospace';
      ctx.fillText(`${debriefInfo.sp} UNSPENT SKILL POINT${debriefInfo.sp === 1 ? '' : 'S'}`, x + 18, cy2);
      cy2 += 20;
    }

    // Action buttons: PILOT RECORD (when it has something to offer) + NEXT BOARD
    const btnH = 32;
    const showPilot = debriefInfo && (debriefInfo.sp > 0 || debriefInfo.levelsGained) && !debriefInfo.died;
    const nbW = showPilot ? 190 : 220;
    const nbH = btnH;
    const gap = 14;
    const totalW = nbW + (showPilot ? 190 + gap : 0);
    let bx2 = w / 2 - totalW / 2;
    const by2 = cy2 + 8;

    if (showPilot) {
      ctx.fillStyle = 'rgba(68,204,204,0.12)';
      ctx.fillRect(bx2, by2, 190, nbH);
      ctx.strokeStyle = '#44cccc';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(bx2, by2, 190, nbH);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#88eeee';
      ctx.font = 'bold 12px "Courier New", monospace';
      ctx.fillText('PILOT RECORD ▸', bx2 + 95, by2 + nbH / 2 + 0.5);
      debriefPilotBox = { x: bx2, y: by2, w: 190, h: nbH };
      bx2 += 190 + gap;
    } else {
      debriefPilotBox = null;
    }

    const blink2 = Math.sin(performance.now() / 500) > -0.4;
    ctx.fillStyle = 'rgba(20,40,16,0.65)';
    ctx.fillRect(bx2, by2, nbW, nbH);
    ctx.strokeStyle = blink2 ? P.ui.textBright : P.ui.borderHi;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(bx2, by2, nbW, nbH);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = P.ui.textBright;
    ctx.font = 'bold 13px "Courier New", monospace';
    ctx.fillText('[ NEXT BOARD ]', bx2 + nbW / 2, by2 + nbH / 2 + 0.5);
    debriefNextBox = { x: bx2, y: by2, w: nbW, h: nbH };
    ctx.restore();
  },
});

// ── Shared UI decoration helpers ──────────────────────────────────────────

/** Subtle CRT scanlines + edge vignette over a full-screen UI. */
function drawScanlines(ctx, w, h) {
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

/** Faint tactical grid backdrop for menu screens. */
function drawTacticalGrid(ctx, w, h) {
  ctx.strokeStyle = 'rgba(90,140,80,0.07)';
  ctx.lineWidth = 1;
  const step = 48;
  ctx.beginPath();
  for (let x = (w % step) / 2; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = (h % step) / 2; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
}

/** Rotating radar sweep disc — returns nothing, animated by time. */
function drawRadarSweep(ctx, cx, cy, radius, tSec) {
  ctx.save();
  // Range rings
  ctx.strokeStyle = 'rgba(90,160,80,0.16)';
  ctx.lineWidth = 1;
  for (const rr of [0.33, 0.66, 1]) {
    ctx.beginPath(); ctx.arc(cx, cy, radius * rr, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius); ctx.stroke();
  // Sweep wedge with trailing fade
  const ang = (tSec * 1.1) % (Math.PI * 2);
  for (let i = 0; i < 24; i++) {
    const a = ang - i * 0.05;
    ctx.strokeStyle = `rgba(110,220,100,${0.30 * (1 - i / 24)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    ctx.stroke();
  }
  // Blips
  const blips = [[0.55, 0.8], [0.72, 2.6], [0.85, 4.9], [0.4, 3.7]];
  for (const [rr, ba] of blips) {
    const bAng = ba + Math.sin(tSec * 0.23) * 0.2;
    const fade = 0.25 + 0.55 * Math.max(0, Math.cos(ang - ba));
    ctx.fillStyle = `rgba(150,255,120,${fade})`;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(bAng) * radius * rr, cy + Math.sin(bAng) * radius * rr, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawScreenBackground(ctx, cam, title, subtitle = '') {
  const dpr = cam.dpr;
  const w = cam.screenW;
  const h = cam.screenH;
  ctx.save(); ctx.scale(dpr, dpr);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#0a120a');
  grad.addColorStop(1, '#16240f');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
  drawTacticalGrid(ctx, w, h);

  // Header rule under the title
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillStyle = P.ui.textBright;
  ctx.font = 'bold 22px "Courier New", monospace';
  ctx.fillText(title, w / 2, 24);
  const tw = ctx.measureText(title).width;
  ctx.strokeStyle = P.ui.borderHi;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w / 2 - tw / 2 - 18, 50);
  ctx.lineTo(w / 2 + tw / 2 + 18, 50);
  ctx.stroke();
  if (subtitle) {
    ctx.fillStyle = P.ui.textDim;
    ctx.font = '10px "Courier New", monospace';
    ctx.fillText(subtitle, w / 2, 56);
  }

  // Screen-corner brackets
  drawCornerBrackets(ctx, 8, 8, w - 16, h - 16, 'rgba(90,140,80,0.5)', 22, 2);
  drawScanlines(ctx, w, h);
  ctx.restore();
}

function contractCardRect(index, w, h) {
  const cols = w >= 620 ? 2 : 1;
  const rows = Math.ceil(4 / cols);
  const gap = 12;
  const cardW = Math.min(360, (w - gap * (cols + 1)) / cols);
  const cardH = Math.min(148, (h - 112 - gap * (rows + 1)) / rows);
  const row = Math.floor(index / cols);
  const col = index % cols;
  const totalW = cardW * cols + gap * (cols - 1);
  const left = (w - totalW) / 2;
  return {
    x: left + col * (cardW + gap),
    y: 78 + row * (cardH + gap),
    w: cardW,
    h: cardH,
  };
}

function drawContractCard(ctx, card, rect, selected = false) {
  ctx.fillStyle = selected ? '#1e3a1e' : '#0d210f';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  // Header strip
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(rect.x, rect.y, rect.w, 28);
  // Risk-colored accent stripe
  const riskCol = card.difficultyRating >= 4 ? '#cc3333' : card.difficultyRating >= 3 ? '#ff8844' : '#88aa55';
  ctx.fillStyle = riskCol;
  ctx.fillRect(rect.x, rect.y, 4, rect.h);
  ctx.strokeStyle = selected ? P.ui.textBright : P.ui.border;
  ctx.lineWidth = selected ? 2 : 1;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  drawCornerBrackets(ctx, rect.x, rect.y, rect.w, rect.h,
    selected ? P.ui.textBright : 'rgba(90,140,80,0.45)', 10, 1.5);

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x + 6, rect.y, rect.w - 12, rect.h);
  ctx.clip();
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
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
  ctx.fillText(`RISK   ${'◆'.repeat(card.difficultyRating)}${'◇'.repeat(4 - card.difficultyRating)}  ${card.difficultyName}`, rect.x + 16, rect.y + rect.h - 28);
  ctx.fillStyle = '#ffcc44';
  ctx.fillText(`PAY    $${card.reward}`, rect.x + 16, rect.y + rect.h - 14);
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
    contractBoard = createContractBoard(seed, { act: 1, sortie: 1 });
    GameState.setContractBoard(contractBoard);
  },
  draw(ctx, cam) {
    const w = cam.screenW;
    const h = cam.screenH;
    const camp = career?.campaign || { act: 1, sortie: 1 };
    drawScreenBackground(ctx, cam, 'AVAILABLE OPERATIONS', `ACT ${camp.act} · SORTIE ${camp.sortie} — SELECT ONE CONTRACT`);
    ctx.save(); ctx.scale(cam.dpr, cam.dpr);
    for (let i = 0; i < contractBoard.length; i++) {
      drawContractCard(ctx, contractBoard[i], contractCardRect(i, w, h));
    }
    ctx.fillStyle = P.ui.textDim;
    ctx.font = '10px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Each operation is generated from its contract and seed.', w / 2, h - 40);
    contractsBackBox = drawBackButton(ctx, w, h, '◂ TITLE');
    ctx.restore();
  },
});

registerScreen('briefing', {
  enter(contract) {
    activeContract = contract;
    GameState.setActiveContract(contract);
  },
  draw(ctx, cam) {
    const w = cam.screenW;
    const h = cam.screenH;
    const scenario = getScenario(activeContract?.scenarioId);
    const style = getStyle(activeContract?.styleId);
    const difficulty = getDifficultyProfile(activeContract?.difficultyId);
    drawScreenBackground(ctx, cam, 'SORTIE BRIEFING', activeContract ? `CONTRACT SEED ${activeContract.seed}` : 'NO CONTRACT');
    ctx.save(); ctx.scale(cam.dpr, cam.dpr);
    const panelW = Math.min(480, w - 32);
    const panelH = Math.min(400, h - 120);
    const x = (w - panelW) / 2;
    const y = 78;
    ctx.fillStyle = '#0d210f'; ctx.fillRect(x, y, panelW, panelH);
    ctx.strokeStyle = P.ui.border; ctx.lineWidth = 1; ctx.strokeRect(x, y, panelW, panelH);
    drawCornerBrackets(ctx, x, y, panelW, panelH, P.ui.borderHi, 16, 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = P.ui.infamy; ctx.font = 'bold 18px "Courier New", monospace';
    ctx.fillText(activeContract?.name || 'NO CONTRACT', x + 18, y + 18);
    const nameW = ctx.measureText(activeContract?.name || 'NO CONTRACT').width;
    ctx.strokeStyle = 'rgba(204,136,51,0.5)';
    ctx.beginPath();
    ctx.moveTo(x + 18, y + 40);
    ctx.lineTo(x + 18 + nameW, y + 40);
    ctx.stroke();
    ctx.fillStyle = P.ui.textBright; ctx.font = 'bold 12px "Courier New", monospace';
    ctx.fillText(scenario.objectiveLabel, x + 18, y + 52);
    ctx.fillStyle = P.ui.text; ctx.font = '11px "Courier New", monospace';
    const descriptionLines = wrapText(scenario.description, Math.floor(panelW / 7.2));
    for (let i = 0; i < descriptionLines.length; i++) ctx.fillText(descriptionLines[i], x + 18, y + 76 + i * 15);
    const detailY = y + 126;
    ctx.fillStyle = P.ui.rocket;
    ctx.fillText(`STYLE       ${style.name}`, x + 18, detailY);
    ctx.fillText(`DIFFICULTY  ${difficulty.name}`, x + 18, detailY + 20);
    ctx.fillText(`THREAT      ${activeContract?.threatTags.join(' / ').toUpperCase()}`, x + 18, detailY + 40);
    ctx.fillStyle = '#ffcc44';
    ctx.fillText(`BASE PAY    $${activeContract?.reward || 0}`, x + 18, detailY + 60);

    // ── Flow layout: hints → equipment → launch prompt (no absolute overlaps)
    let fy = detailY + 86;
    ctx.fillStyle = P.ui.textDim;
    ctx.fillText('Fear levels you up. Heat accelerates the Hunter.', x + 18, fy); fy += 16;
    ctx.fillText('Complete the objective, then leave the map.', x + 18, fy); fy += 26;

    ctx.fillStyle = P.ui.textDim;
    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.fillText('FIELD EQUIPMENT — CLICK TO SELECT', x + 18, fy); fy += 20;
    briefingEquipmentBoxes = [];
    const eqKeys = Object.keys(EQUIPMENT);
    const eqGap = 10;
    const eqW = Math.min(180, (panelW - 36 - eqGap) / 2);
    for (let i = 0; i < eqKeys.length; i++) {
      const key = eqKeys[i];
      const bx = x + 18 + (i % 2) * (eqW + eqGap);
      const by = fy + Math.floor(i / 2) * (46 + eqGap);
      const isSel = selectedEquipment === key;
      ctx.fillStyle = isSel ? 'rgba(68,204,204,0.16)' : 'rgba(0,0,0,0.25)';
      ctx.fillRect(bx, by, eqW, 46);
      ctx.strokeStyle = isSel ? '#44cccc' : P.ui.border;
      ctx.lineWidth = isSel ? 1.5 : 1;
      ctx.strokeRect(bx, by, eqW, 46);
      if (isSel) drawCornerBrackets(ctx, bx, by, eqW, 46, '#44cccc', 7, 1.5);
      ctx.textAlign = 'left';
      ctx.fillStyle = isSel ? '#88eeee' : P.ui.text;
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.fillText(EQUIPMENT[key].name, bx + 8, by + 8);
      ctx.fillStyle = P.ui.textDim;
      ctx.font = '9px "Courier New", monospace';
      ctx.fillText(EQUIPMENT[key].desc, bx + 8, by + 24);
      briefingEquipmentBoxes.push({ x: bx, y: by, w: eqW, h: 46, key });
    }
    fy += (46 + eqGap) * 2 + 16;

    briefingBackBox = drawBackButton(ctx, w, h, '◂ CONTRACTS');

    // Launch button (explicit zone — no more click-anywhere launches)
    ctx.textAlign = 'center';
    const lbl = '[ CLICK TO INSERT ]';
    ctx.font = 'bold 14px "Courier New", monospace';
    const lw2 = ctx.measureText(lbl).width + 36;
    const lh2 = 32;
    const lx = w / 2 - lw2 / 2, ly = fy - lh2 / 2 + 4;
    const blink = Math.sin(performance.now() / 500) > -0.4;
    ctx.fillStyle = 'rgba(20,40,16,0.65)';
    ctx.fillRect(lx, ly, lw2, lh2);
    ctx.strokeStyle = blink ? P.ui.textBright : P.ui.borderHi;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(lx, ly, lw2, lh2);
    drawCornerBrackets(ctx, lx, ly, lw2, lh2, 'rgba(170,255,136,0.5)', 7, 1.5);
    ctx.fillStyle = P.ui.textBright;
    ctx.fillText(lbl, w / 2, fy + 4);
    briefingInsertBox = { x: lx, y: ly, w: lw2, h: lh2 };
    ctx.restore();
  },
});

registerScreen('sortie', {
  enter(contract) {
    activeContract = contract || activeContract;
    GameState.setActiveContract(activeContract);
    resetSortieState();
    enemies.length = 0;
    projectiles.length = 0;
    explosions.length = 0;
    floatingTexts.length = 0;
    heli.x = 0; heli.y = 0; heli.vx = 0; heli.vy = 0;
    heli.angle = -Math.PI / 2; heli.hp = 100; heli.maxHp = 100; heli.score = 0; heli.fear = 0;
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
    heli.equipmentType = selectedEquipment;
    heli.equipmentUsed = false;
    heli.salvoShots = 0;
    heli.salvoTimer = 0;
    heli.adrenalineT = 0;
    heli.flareT = 0;
    applyCareerToHeli(heli, career.pilot, career.hangar, career.gunship);
    sortieXpEarned = 0;
    sortieDollarsEarned = 0;
    GameState.setSortieXp(0);
    GameState.setSortieDollars(0);
    try {
      initWorld(activeContract);
    } catch (e) {
      console.error('[Gunship] initWorld failed', e);
      const seed = activeContract?.seed ?? 42;
      world = generateWorld({ seed });
      terrainNoise = createNoise(seed);
      moistureNoise = createNoise(seed + 777);
      detailNoise = createNoise(seed + 333);
      _setTerrain(null, terrainNoise, moistureNoise, detailNoise);
      GameState.setWorld(world);
      GameState.setNoises(terrainNoise, moistureNoise, detailNoise);
    }
    if (world) {
      for (const v of world.sites) {
        v.discovered = false;
        v.cleared = false;
        for (const entry of v.enemies) entry.active = false;
      }
    }
    spawnOutdoorEnemies();
    resetBossTimer();
    resetBoss();
  },

  tick(dt) {
    if (sortieState.status !== 'active') {
      sortieState.endTimer -= dt;
      if (sortieState.endTimer <= 0) switchScreen('debrief');
      return;
    }

    // ── Cycle target MODE (Shift / V / touch chip / gamepad RB) ──
    const TARGET_MODES = ['closest', 'strongest', 'infrastructure'];
    const MODE_HELP = {
      closest: 'nearest hostile in weapons range',
      strongest: 'hostile with highest damage per second',
      infrastructure: 'buildings & convoys only',
    };
    if (input.cycleTarget || input.cycleMode) {
      heli.targetCycleIndex = (heli.targetCycleIndex + 1) % TARGET_MODES.length;
      heli.targetMode = TARGET_MODES[heli.targetCycleIndex];
      heli.manualTarget = null; // switching priority releases an old lock
      modeToastUntil = performance.now() + 2600;
    }

    // ── Find target based on mode ──
    // Click-to-target is a lock, not a one-frame hint.
    if (input.clickTarget && input.clickToTarget) {
      const worldPos = camera.screenToWorld(input.clickTargetX, input.clickTargetY);
      let closestDist = 60; // click tolerance in world units
      let clickedTarget = null;
      for (const e of enemies) {
        if (e.state === 'dead') continue;
        const dist = Math.hypot(e.x - worldPos.x, e.y - worldPos.y);
        if (dist < closestDist) { closestDist = dist; clickedTarget = e; }
      }
      // Convoys: any member is clickable.
      for (const convoy of world.convoys) {
        if (!convoy.active || convoy.destroyed) continue;
        for (const m of getConvoyMembers(convoy)) {
          const dist = Math.hypot(m.x - worldPos.x, m.y - worldPos.y);
          const r = m.isVeh ? 26 : 20;
          if (dist < Math.max(closestDist, r) && dist < closestDist + r) {
            if (dist < closestDist) { closestDist = dist; clickedTarget = convoy; }
          }
        }
      }
      // Buildings are clickable infrastructure.
      for (const b of world.buildings) {
        if (!b.destructible || b.destroyed) continue;
        const dist = Math.hypot(b.x - worldPos.x, b.y - worldPos.y);
        const r = Math.max(b.w, b.d) * 0.7 + 18;
        if (dist < r && dist < closestDist) { closestDist = dist; clickedTarget = b; }
      }
      const objectiveTarget = world?.objective?.target;
      if (objectiveTarget && isTargetAlive(objectiveTarget)) {
        const dist = Math.hypot(objectiveTarget.x - worldPos.x, objectiveTarget.y - worldPos.y);
        if (dist < closestDist) { closestDist = dist; clickedTarget = objectiveTarget; }
      }
      if (boss.spawned && boss.state !== 'dead') {
        const dist = Math.hypot(boss.x - worldPos.x, boss.y - worldPos.y);
        if (dist < closestDist) clickedTarget = boss;
      }
      if (clickedTarget) heli.manualTarget = clickedTarget;
    }

    // Auto-target — an explicit click lock takes priority.
    let bestTarget = null;
    let bestValue = Infinity;
    if (heli.manualTarget && isTargetAlive(heli.manualTarget)) {
      bestTarget = heli.manualTarget;
    } else {
      heli.manualTarget = null;
      // Check Hunter first — it always overrides the priority modes.
      if (boss.spawned && boss.state !== 'dead') {
        const bossDist = Math.hypot(boss.x - heli.x, boss.y - heli.y);
        if (bossDist < heli.weaponRange) {
          bestTarget = boss;
          bestValue = -999;
        }
      }
      // The active objective is targetable even when no enemy is nearby.
      const objectiveTarget = world?.objective?.target;
      if (!bestTarget && objectiveTarget && isTargetAlive(objectiveTarget)) {
        const targetDist = Math.hypot(objectiveTarget.x - heli.x, objectiveTarget.y - heli.y);
        if (targetDist < heli.weaponRange) {
          bestTarget = objectiveTarget;
          bestValue = -500;
        }
      }
      if (heli.targetMode === 'infrastructure') {
        // Buildings and convoys only — closest first.
        for (const b of world.buildings) {
          if (!b.destructible || b.destroyed) continue;
          const dist = Math.hypot(b.x - heli.x, b.y - heli.y);
          if (dist > heli.weaponRange) continue;
          if (dist < bestValue) { bestValue = dist; bestTarget = b; }
        }
        for (const convoy of world.convoys) {
          if (!convoy.active || convoy.destroyed) continue;
          const dist = Math.hypot(convoy.x - heli.x, convoy.y - heli.y);
          if (dist > heli.weaponRange) continue;
          if (dist < bestValue) { bestValue = dist; bestTarget = convoy; }
        }
      } else {
        for (const e of enemies) {
          if (e.state === 'dead') continue;
          const dist = Math.hypot(e.x - heli.x, e.y - heli.y);
          if (dist > heli.weaponRange) continue;
          let value = 0;
          if (heli.targetMode === 'closest') {
            value = dist;
          } else if (heli.targetMode === 'strongest') {
            // Threat = damage per second, with reach as a tiebreaker.
            const dps = e.damage / Math.max(0.2, e.fireRate);
            value = -(dps + e.range * 0.03);
          }
          if (value < bestValue) { bestValue = value; bestTarget = e; }
        }
      }
    }
    heli.target = bestTarget;

    // ── Aim angle: toward target if locked, else toward cursor/move ──
    let aimAngle;
    if (heli.target) {
      aimAngle = Math.atan2(heli.target.y - heli.y, heli.target.x - heli.x);
      // Targeting Computer: lead moving targets by projectile flight time.
      if (heli.autoLead && heli.target.speed > 0) {
        const t = heli.target;
        const tvx = Math.cos(t.angle || 0) * t.speed;
        const tvy = Math.sin(t.angle || 0) * t.speed;
        const dist = Math.hypot(t.x - heli.x, t.y - heli.y);
        const tof = dist / heli.bulletSpeed;
        aimAngle = Math.atan2(t.y + tvy * tof - heli.y, t.x + tvx * tof - heli.x);
      }
    } else if (input.hasAim) {
      aimAngle = Math.atan2(input.aimY, input.aimX);
    } else if (input.moveX !== 0 || input.moveY !== 0) {
      aimAngle = Math.atan2(input.moveY, input.moveX);
    } else {
      aimAngle = heli.angle;
    }

    // Smooth rotation
    let diff = aimAngle - heli.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    heli.angle += diff * Math.min(1, 3.0 * (heli.turnMult || 1) * dt);

    // ── Movement: speed scales with cursor distance ──
    if (heli.adrenalineT > 0) heli.adrenalineT -= dt;
    if (heli.flareT > 0) heli.flareT -= dt;
    const boost = heli.adrenalineT > 0 ? 1 + 0.5 * (heli.boostPotency || 1) : 1.0;
    const accel = heli.accel * boost, drag = 0.91, maxSpeed = heli.maxSpeed * boost;
    const mx = input.moveX, my = input.moveY;
    if (mx !== 0 || my !== 0) {
      // WASD / joystick: magnitude controls speed
      const mag = Math.hypot(mx, my);
      heli.vx += (mx / mag) * accel * mag * dt;
      heli.vy += (my / mag) * accel * mag * dt;
    } else if (input.hasAim) {
      // Mouse: distance from center = desired speed
      const cx = input.canvas.clientWidth / 2;
      const cy = input.canvas.clientHeight / 2;
      const dx = input.mouseX - cx;
      const dy = input.mouseY - cy;
      const dist = Math.hypot(dx, dy);
      const maxDist = Math.min(cx, cy);
      const speedFactor = Math.min(dist / maxDist, 1); // 0 at center, 1 at edge
      const thrust = accel * (0.15 + speedFactor * 0.85); // min 15% thrust even close
      heli.vx += input.aimX * thrust * dt;
      heli.vy += input.aimY * thrust * dt;
    }

    heli.vx *= drag;
    heli.vy *= drag;
    const spd = Math.hypot(heli.vx, heli.vy);
    if (spd > maxSpeed) {
      heli.vx = (heli.vx / spd) * maxSpeed;
      heli.vy = (heli.vy / spd) * maxSpeed;
    }

    heli.x += heli.vx * dt;
    heli.y += heli.vy * dt;
    // Extraction = fly off the map: the clamp opens up once it's active.
    const boundLim = world?.extraction?.active ? WORLD_SIZE * 0.55 : WORLD_SIZE * 0.48;
    heli.x = clamp(heli.x, -boundLim, boundLim);
    heli.y = clamp(heli.y, -boundLim, boundLim);

    heli.bladeAngle += 18 * dt;

    // ── Fire (click / Space / autofire toggle) ──
    heli.fireCooldown -= dt;
    const fireRate = heli.fireRate * (heli.adrenalineT > 0 ? 0.6 : 1.0);
    const wantsFire = input.fire || (input.autofire && heli.target);
    if (wantsFire && heli.fireCooldown <= 0) {
      let aimA = heli.target
        ? Math.atan2(heli.target.y - heli.y, heli.target.x - heli.x)
        : heli.angle;
      // Career ballistics: spread, crit, sniper, marked target, double tap.
      let dmg = heli.bulletDamage;
      if (heli.target) {
        const td = Math.hypot(heli.target.x - heli.x, heli.target.y - heli.y);
        if (heli.sniperBonus && td > 250) dmg *= 1 + heli.sniperBonus;
        if (heli.markedDmg) dmg *= 1 + heli.markedDmg;
      }
      if (Math.random() < (heli.critChance || 0)) dmg *= 2;
      aimA += (Math.random() - 0.5) * 0.035 * (heli.spreadMult || 1);
      spawnProjectile(heli.x + Math.cos(aimA) * 20, heli.y + Math.sin(aimA) * 20, aimA, heli.bulletSpeed, Math.round(dmg));
      if (Math.random() < (heli.doubleTap || 0)) {
        spawnProjectile(heli.x + Math.cos(aimA + 0.05) * 20, heli.y + Math.sin(aimA + 0.05) * 20, aimA + 0.05, heli.bulletSpeed, Math.round(dmg));
      }
      addHeat(0.08, 'gunfire reported');
      lastShotX = heli.x; lastShotY = heli.y; lastShotT = performance.now() / 1000;
      heli.fireCooldown = fireRate;
    }

    // ── Equipment activation (E) ──
    if (input.equipment && heli.equipmentType && !heli.equipmentUsed && sortieState.status === 'active') {
      heli.equipmentUsed = true;
      if (heli.equipmentType === 'repair') {
        heli.hp = Math.min(heli.maxHp, heli.hp + 40);
        spawnFloatingText(heli.x, heli.y - 34, '+40 HULL', '#44ff44');
      } else if (heli.equipmentType === 'overboost') {
        heli.adrenalineT = 6 * (heli.boostDurMult || 1);
        spawnFloatingText(heli.x, heli.y - 34, 'OVERBOOST', '#44cccc');
      } else if (heli.equipmentType === 'rocket') {
        heli.salvoShots = 6;
        heli.salvoTimer = 0;
        spawnFloatingText(heli.x, heli.y - 34, 'ROCKETS AWAY', '#ff8844');
      } else if (heli.equipmentType === 'flares') {
        heli.flareT = 3;
        spawnFloatingText(heli.x, heli.y - 34, 'FLARES DEPLOYED', '#ffdd66');
      }
    }
    // Rocket salvo: staggered launches at the current target (or facing).
    if (heli.salvoShots > 0) {
      heli.salvoTimer -= dt;
      if (heli.salvoTimer <= 0) {
        const tx = heli.target ? heli.target.x : heli.x + Math.cos(heli.angle) * 400;
        const ty = heli.target ? heli.target.y : heli.y + Math.sin(heli.angle) * 400;
        const angle = Math.atan2(ty - heli.y, tx - heli.x) + (Math.random() - 0.5) * 0.14;
        spawnProjectile(heli.x + Math.cos(angle) * 22, heli.y + Math.sin(angle) * 22, angle, 340, 15, false, 1.6);
        heli.salvoShots--;
        heli.salvoTimer = 0.12;
      }
    }

    // ── Settlement discovery ──
    if (world) {
      for (const v of world.sites) {
        if (v.cleared) continue;
        const dist = Math.hypot(v.x - heli.x, v.y - heli.y);
        if (!v.discovered && dist < v.detectionRadius) {
          discoverSettlement(v);
        }
      }
    }

    // ── Update enemies ──
    // Sites whose defenders opened fire last frame (civilians panic only
    // once combat actually reaches them).
    const sitesUnderAttack = new Set();
    for (const e of enemies) {
      if (e.state === 'attack' && e.siteId) sitesUnderAttack.add(e.siteId);
    }

    for (const e of enemies) {
      if (e.state === 'dead') {
        e.deathTimer -= dt;
        continue;
      }
      const dist = Math.hypot(e.x - heli.x, e.y - heli.y);

      // ── Unarmed civilians: never fight. They panic only when combat
      // reaches them — gunfire nearby, or their own defenders opening up —
      // then run until they escape the area.
      if (e.className === 'unarmed') {
        const gunfireNear = (performance.now() / 1000 - lastShotT) < COMBAT.gunfireMemorySec &&
          Math.hypot(e.x - lastShotX, e.y - lastShotY) < COMBAT.gunfireRadius;
        if ((gunfireNear || (e.siteId && sitesUnderAttack.has(e.siteId))) && dist < COMBAT.civilianPanicRadius) {
          e.state = 'flee';
        }
        if (e.state === 'flee') {
          const fleeAngle = Math.atan2(e.y - heli.y, e.x - heli.x);
          let adiff = fleeAngle - e.angle;
          while (adiff > Math.PI) adiff -= Math.PI * 2;
          while (adiff < -Math.PI) adiff += Math.PI * 2;
          e.angle += adiff * Math.min(1, 3.0 * dt);
          if (e.speed > 0) {
            e.x += Math.cos(e.angle) * e.speed * dt;
            e.y += Math.sin(e.angle) * e.speed * dt;
          }
          // Civilians who outrun the engagement area escape the site:
          // they leave the battle and no longer block clearing it.
          if (e.homeX !== undefined &&
              Math.hypot(e.x - e.homeX, e.y - e.homeY) > CIVILIAN_ESCAPE_RADIUS) {
            e.escaped = true;
          }
        } else {
          e.state = 'idle';
          if (e.speed > 0) {
            e.wanderPhase = (e.wanderPhase || 0) + dt;
            e.angle += Math.sin(e.wanderPhase * 1.7 + e.x * 0.01) * 0.5 * dt;
            e.x += Math.cos(e.angle) * e.speed * 0.3 * dt;
            e.y += Math.sin(e.angle) * e.speed * 0.3 * dt;
          }
        }
        continue;
      }

      // ── Armed hostiles. Aggro range scales with Heat; a home leash keeps
      // garrisons defending their post instead of swarming across the map.
      const responseRange = COMBAT.aggroBase + sortieState.heat.tier * COMBAT.aggroPerHeatTier;
      const homeDist = e.homeX !== undefined
        ? Math.hypot(e.x - e.homeX, e.y - e.homeY)
        : 0;
      const leash = e.category === 'vehicle' ? COMBAT.leashVehicle : COMBAT.leashInfantry;
      const wasAttacking = e.state === 'attack';
      if (dist < responseRange && homeDist < leash) e.state = 'attack';
      else if ((dist < responseRange + COMBAT.alertExtra || wasAttacking) && homeDist < leash + COMBAT.leashGrace) e.state = 'alert';
      else e.state = 'idle';

      if (e.state === 'attack' && !wasAttacking) addHeat(1.2, 'hostile contact');

      if (e.state === 'attack') {
        let moveAngle = Math.atan2(heli.y - e.y, heli.x - e.x);
        // Ground vehicles flow onto the road network when pursuing, and
        // their speed responds to the ground beneath them.
        let vehFactor = 1.0;
        if (e.category === 'vehicle' && e.speed > 0) {
          const steer = steerAlongRoads(moveAngle, e.x, e.y);
          moveAngle = steer.angle;
          vehFactor = vehicleSpeedFactor(e.x, e.y);
        }
        let adiff = moveAngle - e.angle;
        while (adiff > Math.PI) adiff -= Math.PI * 2;
        while (adiff < -Math.PI) adiff += Math.PI * 2;
        e.angle += adiff * Math.min(1, 2.0 * dt);
        if (e.speed > 0 && dist > e.range * 0.5) {
          e.x += Math.cos(e.angle) * e.speed * vehFactor * dt;
          e.y += Math.sin(e.angle) * e.speed * vehFactor * dt;
        }
        e.fireCooldown -= dt;
        if (e.fireCooldown <= 0 && dist < e.range) {
          const fireAngle = Math.atan2(heli.y - e.y, heli.x - e.x) + (Math.random() - 0.5) * 0.09;
          spawnProjectile(e.x, e.y, fireAngle, 200, e.damage, true, e.bulletLife || 1.5);
          e.fireCooldown = e.fireRate;
        }
      } else if (e.homeX !== undefined && homeDist > COMBAT.returnHomeDist) {
        // Lost contact: head back to post instead of drifting.
        let homeAngle = Math.atan2(e.homeY - e.y, e.homeX - e.x);
        let homeFactor = 1.0;
        if (e.category === 'vehicle' && e.speed > 0) {
          const steer = steerAlongRoads(homeAngle, e.x, e.y);
          homeAngle = steer.angle;
          homeFactor = vehicleSpeedFactor(e.x, e.y);
        }
        let adiff = homeAngle - e.angle;
        while (adiff > Math.PI) adiff -= Math.PI * 2;
        while (adiff < -Math.PI) adiff += Math.PI * 2;
        e.angle += adiff * Math.min(1, 1.5 * dt);
        if (e.speed > 0 && homeDist > 40) {
          e.x += Math.cos(e.angle) * e.speed * 0.55 * homeFactor * dt;
          e.y += Math.sin(e.angle) * e.speed * 0.55 * homeFactor * dt;
        }
      } else if (e.state === 'alert') {
        // Hold position and watch the player.
        const faceAngle = Math.atan2(heli.y - e.y, heli.x - e.x);
        let adiff = faceAngle - e.angle;
        while (adiff > Math.PI) adiff -= Math.PI * 2;
        while (adiff < -Math.PI) adiff += Math.PI * 2;
        e.angle += adiff * Math.min(1, 1.0 * dt);
      } else if (e.state === 'idle' && e.speed > 0) {
        e.wanderPhase = (e.wanderPhase || 0) + dt;
        e.angle += Math.sin(e.wanderPhase * 1.7 + e.x * 0.01) * 0.5 * dt;
        e.x += Math.cos(e.angle) * e.speed * 0.3 * dt;
        e.y += Math.sin(e.angle) * e.speed * 0.3 * dt;
      }
      if (e.flashTimer > 0) e.flashTimer -= dt;
    }

    // Remove dead enemies and civilians who escaped the area
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if ((e.state === 'dead' && e.deathTimer <= 0) || e.escaped) enemies.splice(i, 1);
    }

    // ── Check settlement clears ──
    if (world) {
      for (const v of world.sites) {
        if (checkSettlementClear(v)) {
          applyClearPenalty(v);
        }
      }
    }

    checkObjectiveProgress();
    collectSupplyCrates();
    updateHeat(dt);

    // ── Hunter ETA ── (single source of truth: bossState)
    if (bossState.active && !bossState.defeated) {
      bossState.timeRemaining -= dt * hunterClockRate();

      // 5-second warning
      if (bossState.timeRemaining <= TIMER.bossWarningTime && !bossState.warning && !bossState.spawned) {
        bossState.warning = true;
        bossState.warningTimer = TIMER.bossWarningTime;
      }

      // Warning countdown
      if (bossState.warning && !bossState.spawned) {
        bossState.warningTimer -= dt;
        if (bossState.warningTimer <= 0) {
          spawnBoss();
          bossState.warning = false;
        }
      }

      // Timer expired — spawn immediately if not already spawned
      if (bossState.timeRemaining <= 0 && !bossState.spawned) {
        spawnBoss();
        bossState.warning = false;
      }
    }

    // ── Hunter AI ──
    if (boss.spawned && boss.state !== 'dead') {
      const dist = Math.hypot(boss.x - heli.x, boss.y - heli.y);
      boss.phaseTimer += dt;

      // The Hunter's nose weapons track independently from its flight path.
      const trackAngle = Math.atan2(heli.y - boss.y, heli.x - boss.x);
      let tdiff = trackAngle - boss.turretAngle;
      while (tdiff > Math.PI) tdiff -= Math.PI * 2;
      while (tdiff < -Math.PI) tdiff += Math.PI * 2;
      boss.turretAngle += tdiff * Math.min(1, 2.4 * dt);

      // Behavior phases
      if (boss.state === 'approach') {
        // Close the distance before beginning an attack pass.
        let adiff = trackAngle - boss.angle;
        while (adiff > Math.PI) adiff -= Math.PI * 2;
        while (adiff < -Math.PI) adiff += Math.PI * 2;
        boss.angle += adiff * Math.min(1, 2.0 * dt);
        boss.x += Math.cos(boss.angle) * boss.speed * dt;
        boss.y += Math.sin(boss.angle) * boss.speed * dt;

        // Switch to attack when close enough
        if (dist < boss.range * 0.9) {
          boss.state = 'attack';
          boss.phaseTimer = 0;
        }
      } else if (boss.state === 'attack') {
        // Make attack passes instead of orbiting like a turret.
        const strafeDir = (boss.phaseTimer % 8 < 4) ? 1 : -1;
        const tangential = trackAngle + (Math.PI / 2) * strafeDir;
        boss.x += Math.cos(tangential) * boss.speed * 0.85 * dt;
        boss.y += Math.sin(tangential) * boss.speed * 0.85 * dt;
        // Drift toward player if too far
        if (dist > boss.range * 0.8) {
          boss.x += Math.cos(trackAngle) * boss.speed * 0.55 * dt;
          boss.y += Math.sin(trackAngle) * boss.speed * 0.55 * dt;
        } else if (dist < boss.range * 0.42) {
          boss.x -= Math.cos(trackAngle) * boss.speed * 0.7 * dt;
          boss.y -= Math.sin(trackAngle) * boss.speed * 0.7 * dt;
        }
        const travelAngle = tangential;
        let hdiff = travelAngle - boss.angle;
        while (hdiff > Math.PI) hdiff -= Math.PI * 2;
        while (hdiff < -Math.PI) hdiff += Math.PI * 2;
        boss.angle += hdiff * Math.min(1, 1.5 * dt);

        // Fire cannon — turret aims, not hull
        boss.fireCooldown -= dt;
        if (boss.fireCooldown <= 0 && dist < boss.range) {
          spawnProjectile(boss.x, boss.y, boss.turretAngle - 0.07, 280, boss.damage, true, 1.8);
          spawnProjectile(boss.x, boss.y, boss.turretAngle + 0.07, 280, boss.damage, true, 1.8);
          spawnProjectile(boss.x, boss.y, boss.turretAngle, 220, boss.damage * 1.4, true, 2.1);
          boss.fireCooldown = boss.fireRate;
        }

        if (boss.hp < boss.maxHp * 0.35) {
          boss.state = 'retreat';
          boss.phaseTimer = 0;
        }
      } else if (boss.state === 'retreat') {
        // Pull away and fire while creating space.
        const awayAngle = Math.atan2(boss.y - heli.y, boss.x - heli.x);
        let rdiff = awayAngle - boss.angle;
        while (rdiff > Math.PI) rdiff -= Math.PI * 2;
        while (rdiff < -Math.PI) rdiff += Math.PI * 2;
        boss.angle += rdiff * Math.min(1, 2.0 * dt);
        boss.x += Math.cos(boss.angle) * boss.speed * 1.15 * dt;
        boss.y += Math.sin(boss.angle) * boss.speed * 1.15 * dt;

        // Fire while retreating
        boss.fireCooldown -= dt;
        if (boss.fireCooldown <= 0 && dist < boss.range * 1.3) {
          spawnProjectile(boss.x, boss.y, boss.turretAngle, 250, boss.damage, true, 1.8);
          boss.fireCooldown = boss.fireRate * 1.2;
        }

        // Re-engage after retreating for a bit
        if (boss.phaseTimer > 4 || dist > 700) {
          boss.state = 'attack';
          boss.phaseTimer = 0;
        }
      }

      // Keep boss within world bounds
      boss.x = clamp(boss.x, -WORLD_SIZE * 0.48, WORLD_SIZE * 0.48);
      boss.y = clamp(boss.y, -WORLD_SIZE * 0.48, WORLD_SIZE * 0.48);

      if (boss.flashTimer > 0) boss.flashTimer -= dt;
    }

    // Boss death cleanup
    if (boss.state === 'dead') {
      boss.deathTimer -= dt;
      if (boss.deathTimer <= 0) {
        boss.spawned = false;
      }
    }

    // ── Update convoys ──
    if (world) {
      for (const convoy of world.convoys) {
        // Activate convoy if player is nearby
        if (!convoy.active) {
          const dist = Math.hypot(convoy.x - heli.x, convoy.y - heli.y);
          if (dist < 1100) convoy.active = true;
          else continue;
        }
        if (convoy.destroyed) continue;

        // Advance along the route by arc length; ping-pong at the ends.
        const total = convoy.routeCum[convoy.routeCum.length - 1];
        convoy.s += convoy.direction * convoy.speed * dt;
        if (convoy.s >= total) { convoy.s = total; convoy.direction = -1; }
        else if (convoy.s <= 0) { convoy.s = 0; convoy.direction = 1; }

        // Lead position/heading come from the path itself.
        const lead = pointAlongRoute(convoy, convoy.s);
        const dirSign = convoy.direction >= 0 ? 1 : -1;
        convoy.x = lead.x;
        convoy.y = lead.y;
        convoy.angle = lead.ang + (dirSign < 0 ? Math.PI : 0);

        // Escort fire — the column shoots back when engaged.
        if (!sortieState.levelUpOpen && sortieState.status === 'active') {
          convoy.fireCooldown -= dt;
          const d = Math.hypot(convoy.x - heli.x, convoy.y - heli.y);
          if (d < 380 && convoy.fireCooldown <= 0) {
            const fireAngle = Math.atan2(heli.y - convoy.y, heli.x - convoy.x) + (Math.random() - 0.5) * 0.12;
            spawnProjectile(convoy.x, convoy.y, fireAngle, 200, 3, true, 1.2);
            convoy.fireCooldown = 1.5;
            addHeat(0.35, 'convoy escort engaging');
          }
        }
        if (convoy.flashTimer > 0) convoy.flashTimer -= dt;
      }
    }

    // ── Update floating texts ──
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const ft = floatingTexts[i];
      ft.life -= dt;
      ft.y += ft.vy * dt;
      if (ft.life <= 0) floatingTexts.splice(i, 1);
    }

    // ── Update projectiles ──
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > 5) p.trail.shift();
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) { projectiles.splice(i, 1); continue; }

      if (!p.isEnemy) {
        // Player bullet → hit destructible objectives, radar, and convoys.
        if (hitDestructibleWorldTarget(p)) {
          projectiles.splice(i, 1);
          continue;
        }
        // Player bullet → hit the Hunter.
        if (boss.spawned && boss.state !== 'dead') {
          if (Math.hypot(boss.x - p.x, boss.y - p.y) < boss.size + 4) {
            boss.hp -= p.damage;
            boss.flashTimer = 0.1;
            spawnExplosion(p.x, p.y, 0.3);
            projectiles.splice(i, 1);
            if (boss.hp <= 0) {
              boss.state = 'dead';
              boss.deathTimer = 2.0;
              bossState.defeated = true;
              bossState.active = false;
              sortieState.rewards.hunter += 300;
              sortieDollarsEarned += 250;
              GameState.setSortieDollars(sortieDollarsEarned);
              heli.score += 500;
              addFear(12, 'Hunter destroyed');
              reduceHeat(18, 'Hunter destroyed');
              spawnExplosion(boss.x, boss.y, 3.0);
              spawnFloatingText(boss.x, boss.y - 30, 'HUNTER DESTROYED', '#ff4444');
              spawnFloatingText(boss.x, boss.y - 50, '+300 BOUNTY', '#ffcc44');
            }
            continue;
          }
        }
        // Player bullet → hit regular enemy
        for (const e of enemies) {
          if (e.state === 'dead') continue;
          if (Math.hypot(e.x - p.x, e.y - p.y) < e.size + 4) {
            e.hp -= p.damage;
            e.flashTimer = 0.1;
            spawnExplosion(p.x, p.y, 0.3);
            projectiles.splice(i, 1);
            if (e.hp <= 0) {
              e.state = 'dead';
              e.deathTimer = 0.5;
              heli.score += e.points;
              sortieXpEarned += e.points;
              GameState.setSortieXp(sortieXpEarned);
              sortieState.stats.kills++;
              // Award fear based on enemy type
              let fearGain = 1;
              if (e.category === 'vehicle') fearGain = 4;
              else if (e.category === 'emplacement') fearGain = 3;
              else if (e.weaponName === 'RPG' || e.weaponName === 'ATGM' || e.weaponName === 'MANPADS') fearGain = 2;
              addFear(fearGain, e.className);
              addHeat(Math.max(0.4, fearGain * 0.65), `${e.className} kill reported`);
              spawnExplosion(e.x, e.y, 1.0);
              spawnFloatingText(e.x, e.y - 10, `+${e.points}`, '#ffcc44');
              if (fearGain > 1) spawnFloatingText(e.x, e.y - 25, `+${fearGain} FEAR`, '#ff8844');
            }
            break;
          }
        }
      } else {
        // Flares: incoming fire near the helo burns up in the light
        if (heli.flareT > 0) {
          if (Math.hypot(p.x - heli.x, p.y - heli.y) < 170) {
            spawnExplosion(p.x, p.y, 0.15);
            projectiles.splice(i, 1);
            continue;
          }
        }
        // Enemy bullet → hit helicopter
        if (Math.hypot(heli.x - p.x, heli.y - p.y) < 20) {
          heli.hp -= Math.max(1, Math.round(p.damage * (1 - (heli.dmgResist || 0))));
          hudAnim.hpFlash = 0.15;
          camera.shake(4, 0.15);
          spawnExplosion(p.x, p.y, 0.2);
          projectiles.splice(i, 1);
          if (heli.hp <= 0) {
            if (heli.lastStand && !heli.lastStandUsed) {
              heli.lastStandUsed = true;
              heli.hp = Math.round(heli.maxHp * 0.25);
              spawnExplosion(heli.x, heli.y, 1.2);
              spawnFloatingText(heli.x, heli.y - 30, 'LAST STAND', '#ffcc44');
            } else {
              heli.hp = 0;
              spawnExplosion(heli.x, heli.y, 3.0);
              finishSortie('failed');
            }
          }
        }
      }
    }

    checkObjectiveProgress();
    updateExtraction(dt);

    for (let i = explosions.length - 1; i >= 0; i--) {
      explosions[i].life -= dt;
      if (explosions[i].life <= 0) explosions.splice(i, 1);
    }

    // ── Camera: pan-ahead based on velocity ──
    const panFactor = clamp(spd / maxSpeed, 0, 0.35);
    camera.followAhead(heli.x, heli.y, heli.vx, heli.vy, panFactor);
    // Zoom: faster = more zoomed out to see ahead
    const speedZoom = lerp(CAMERA.zoomSpeedNear, CAMERA.zoomSpeedFar, spd / maxSpeed);
    camera.setZoom(heli.target ? Math.max(speedZoom, CAMERA.zoomCombatFloor) : speedZoom);
  },

  draw(ctx, cam, dt = 0) {
    const dpr = cam.dpr, w = cam.screenW, h = cam.screenH;
    cam.begin(ctx);

    drawSmoothTerrain(ctx, cam);
    drawRoads(ctx, cam);
    drawDecorations(ctx, cam);

    // Draw convoys as a path-bound vehicle column (before helicopter so
    // they appear underneath). Every member sits ON the route polyline.
    if (world) {
      const VEHICLE_CLASSES = { technical: '#7a6040', apc: '#7a7a5a', shilka: '#5a5a4a', sam: '#5a6a5a' };
      for (const convoy of world.convoys) {
        if (!convoy.active) continue;
        // Cull by column bounding box
        let colMinX = Infinity, colMinY = Infinity, colMaxX = -Infinity, colMaxY = -Infinity;
        const members = getConvoyMembers(convoy);
        for (const m of members) {
          if (m.x < colMinX) colMinX = m.x; if (m.x > colMaxX) colMaxX = m.x;
          if (m.y < colMinY) colMinY = m.y; if (m.y > colMaxY) colMaxY = m.y;
        }
        if (colMaxX < cam.x - 1200 || colMinX > cam.x + 1200 ||
            colMaxY < cam.y - 1200 || colMinY > cam.y + 1200) continue;

        if (convoy.destroyed) {
          // Burnt-out wrecks scattered along the road
          for (const m of members) {
            if (!m.isVeh) continue;
            ctx.save();
            ctx.translate(m.x, m.y);
            ctx.rotate(m.angle + ((m.x * 7 + m.y * 3) % 10) / 30 - 0.15);
            ctx.fillStyle = 'rgba(20,16,12,0.55)';
            ctx.beginPath(); ctx.ellipse(0, 0, 14, 8, 0, 0, Math.PI * 2); ctx.fill();
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
            const len = m.cls === 'shilka' ? 24 : 20, wid = m.cls === 'shilka' ? 12 : 10;
            ctx.fillStyle = withAlpha('#000000', 0.18); // shadow
            ctx.beginPath(); ctx.ellipse(2, 3, len * 0.55, wid * 0.5, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = VEHICLE_CLASSES[m.cls];
            ctx.fillRect(-len / 2, -wid / 2, len, wid);
            if (convoy.flashTimer > 0) { ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(-len / 2, -wid / 2, len, wid); }
            ctx.fillStyle = 'rgba(0,0,0,0.35)'; // cab / front block
            ctx.fillRect(len / 2 - 6, -wid / 2 + 1.5, 5, wid - 3);
            if (m.cls === 'shilka') { // gun barrels
              ctx.strokeStyle = '#3a3a2a'; ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(len / 2 - 4, -3); ctx.lineTo(len / 2 + 8, -4);
              ctx.moveTo(len / 2 - 4, 3); ctx.lineTo(len / 2 + 8, 4);
              ctx.stroke();
            }
          } else {
            ctx.fillStyle = '#8a6a4a';
            ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill();
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
      world.buildings.sort((a, b) => (a.y + a.d / 2) - (b.y + b.d / 2));
      for (const b of world.buildings) {
        if (cam.isVisible(b.x, b.y, 80)) drawBuilding(ctx, b);
      }
    }
    drawSites(ctx, cam);
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
      ctx.strokeStyle = p.isEnemy ? withAlpha(P.projectile.enemyTrail, 0.4) : withAlpha(P.projectile.bulletTrail, 0.4);
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
        const fy = heli.y + Math.sin(fa) * fr * 0.7 + (performance.now() / 60 + f * 13) % 14;
        ctx.fillStyle = withAlpha('#ffdd66', 0.85);
        ctx.beginPath(); ctx.arc(fx, fy, 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = withAlpha('#ff8833', 0.4);
        ctx.beginPath(); ctx.arc(fx, fy + 2, 3.4, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Draw floating texts (CLEAR!, damage numbers)
    for (const ft of floatingTexts) {
      const alpha = clamp(ft.life / ft.maxLife * 2, 0, 1); // fade in fast, fade out
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
    ctx.save(); ctx.scale(dpr, dpr);

    // Scale the HUD with viewport size so it stays readable on big screens
    // and still fits on small ones. All HUD code below uses W/H (logical).
    const uiS = clamp(Math.min(w, h) / HUD.scaleDivisor, 1, HUD.scaleMax);
    ctx.scale(uiS, uiS);

    // ── HUD layout metrics (responsive; no plate overlaps) ──
    const W = w / uiS, H = h / uiS;
    const narrow = W < HUD.narrowBreakpoint;
    const lpw = narrow ? 178 : 240;                 // left systems plate width
    const rpw = narrow ? 152 : 188;                 // right status plate width
    const rph = narrow ? 106 : 96;                  // right status plate height
    const rpx = W - rpw - 8;

    const nToggles = (input.autofire ? 1 : 0) + (input.clickToTarget ? 1 : 0);
    const equipReady = sortieState.status === 'active' && heli.equipmentType && !heli.equipmentUsed;
    const objText = (world?.objective && !sortieState.objectiveComplete)
      ? objectiveHudText()
      : (sortieState.objectiveComplete ? 'RTB — EXIT THE MAP' : null);
    const objWrap = objText ? wrapText(objText, Math.max(16, Math.floor((lpw - 26) / 6))).slice(0, 2) : [];
    const showProgress = !!(world?.objective && !sortieState.objectiveComplete && world.objective.type === 'suppression');
    const sysH = 40 + nToggles * 15 + (equipReady ? 15 : 0) + objWrap.length * 13 + (showProgress ? 13 : 0) + 4;

    // Centre stack drops below the side plates on narrow screens.
    const hpY0 = narrow ? 8 + Math.max(sysH, rph) + 12 : 8;
    let hudEtaY = hpY0 + 36;

    // Bottom row metrics (radar / compass / sortie stats)
    const mmS = narrow ? 108 : 148;              // minimap size
    const mmX = 12, mmY = H - mmS - 12;
    const stW = narrow ? 138 : 172;              // stats plate width
    const stH = narrow ? 52 : 60;
    const stX = W - stW - 12, stY = H - stH - 12;
    const cpW = Math.max(0, Math.min(W - (mmS + 48) * 2 - 24, 300));
    const cpH = 34;

    // ── Damage vignette — screen edges bleed red as the airframe fails ──
    {
      const hpPctV = heli.hp / heli.maxHp;
      if (hpPctV < 0.35) {
        const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 160);
        const a = (1 - hpPctV / 0.35) * 0.38 * pulse * (1 - (heli.redScreenRed || 0));
        const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.72);
        vg.addColorStop(0, 'rgba(180,20,20,0)');
        vg.addColorStop(1, `rgba(180,20,20,${a.toFixed(3)})`);
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, W, H);
      }
    }

    // ── Targeting-mode toast — explains what the mode does ──
    {
      const now = performance.now();
      if (now < modeToastUntil) {
        const MODE_HELP = {
          closest: 'nearest hostile in weapons range',
          strongest: 'hostile with highest damage per second',
          infrastructure: 'buildings & convoys only',
        };
        const alpha = Math.min(1, (modeToastUntil - now) / 600);
        const modeLabel = { closest: 'CLOSEST', strongest: 'STRONGEST', infrastructure: 'INFRA' }[heli.targetMode] || heli.targetMode;
        const ty0 = hpY0 + 44;
        ctx.globalAlpha = alpha;
        ctx.font = 'bold 12px "Courier New", monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
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
      const hpBarW = 110, hpBarH = 9;
      const plateW = 212, plateH = 30;
      const px = W / 2 - plateW / 2, py = hpY0;
      const hpPct = heli.hp / heli.maxHp;
      hudPlate(ctx, px, py, plateW, plateH,
        hpPct <= 0.25 ? 'rgba(255,68,68,0.7)' : hpPct <= 0.5 ? 'rgba(204,170,51,0.55)' : 'rgba(90,140,80,0.55)');
      const lowPulse = hpPct <= 0.25 ? (0.55 + 0.45 * Math.sin(performance.now() / 120)) : 1;

      // Animate the displayed value toward the real one; flash on damage.
      hudAnim.hp += (heli.hp - hudAnim.hp) * Math.min(1, 10 * (dt || 0.016));
      hudAnim.hpFlash = Math.max(0, (hudAnim.hpFlash || 0) - (dt || 0.016));

      let label = 'HULL', labelCol = P.ui.text;
      if (hpPct <= 0.25) { label = 'CRIT'; labelCol = '#ff4444'; }
      else if (hpPct <= 0.5) { label = 'DMGD'; labelCol = P.ui.hpMed; }

      const num = `${Math.round(Math.max(0, heli.hp))}/${Math.round(heli.maxHp)}`;
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const labelW = ctx.measureText(label).width;
      const numW = ctx.measureText(num).width;
      const gap = 9;
      const total = labelW + gap + hpBarW + gap + numW;

      const midY = py + plateH / 2 + 0.5;
      let cx0 = px + (plateW - total) / 2;

      ctx.fillStyle = labelCol;
      ctx.globalAlpha = hpPct <= 0.25 ? lowPulse : 1;
      ctx.fillText(label, cx0, midY);
      ctx.globalAlpha = 1;
      const barX = cx0 + labelW + gap, barY = py + (plateH - hpBarH) / 2;
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
      const px = rpx, py = 8, pw = rpw, ph = rph;
      hudPlate(ctx, px, py, pw, ph, 'rgba(90,140,80,0.55)');
      plateHeader(ctx, px, py, pw, 'STATUS');
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const fbW = pw - 24;

      // Animate bars toward real values
      const fearThreshold = getFearThreshold();
      hudAnim.fear += (clamp(heli.fear / fearThreshold, 0, 1) - hudAnim.fear) * Math.min(1, 8 * (dt || 0.016));
      hudAnim.heat += (sortieState.heat.value / 100 - hudAnim.heat) * Math.min(1, 8 * (dt || 0.016));

      // SCORE — big number, right-aligned
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.fillStyle = P.ui.textDim; ctx.fillText('SCORE', px + 12, py + 18);
      ctx.font = 'bold 14px "Courier New", monospace';
      ctx.fillStyle = P.ui.infamy;
      ctx.textAlign = 'right';
      ctx.fillText(`${heli.score}`, px + pw - 12, py + 16);
      ctx.textAlign = 'left';

      // FEAR
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.fillStyle = '#ff8844'; ctx.fillText(`FEAR LV ${sortieState.fearLevel || 0}`, px + 12, py + 38);
      hudBar(ctx, px + 12, py + 50, fbW, 5, heli.fear / fearThreshold, '#cc8833', { shown: hudAnim.fear });

      // HEAT (tier-colored)
      const heatCols = [P.ui.hp, P.ui.hpMed, '#ff8844', '#ff5533', '#ff2222'];
      ctx.fillStyle = heatCols[Math.min(sortieState.heat.tier, heatCols.length - 1)];
      ctx.fillText(`HEAT ${HEAT_LABELS[sortieState.heat.tier]}`, px + 12, py + 62);
      hudBar(ctx, px + 12, py + 74, fbW, 6, sortieState.heat.value / 100,
        sortieState.heat.tier >= 3 ? '#ff4444' : '#cc6633', { shown: hudAnim.heat });
      if (sortieState.heat.eventTimer > 0 && sortieState.heat.lastEvent) {
        ctx.fillStyle = '#ffcc88'; ctx.font = '8px "Courier New", monospace';
        const ev = sortieState.heat.lastEvent.toUpperCase();
        ctx.fillText(ev.length > 34 ? ev.slice(0, 33) + '…' : ev, px + 12, py + 84);
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
      const bw = 190, bx = W / 2 - bw / 2, by = hudEtaY;
      hudPlate(ctx, bx, by, bw, 24, urgent ? 'rgba(255,68,68,0.7)' : 'rgba(90,140,80,0.55)');
      ctx.fillStyle = flash ? '#ff4444' : P.ui.textBright;
      ctx.font = 'bold 13px "Courier New", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(`HUNTER ETA ${timerStr}`, W / 2, by + 5);
      // Time-remaining underline (normalized against base timer)
      const baseT = Math.max(1, TIMER.baseTime);
      const frac = clamp(bossState.timeRemaining / baseT, 0, 1);
      ctx.fillStyle = urgent ? 'rgba(255,68,68,0.8)' : 'rgba(120,180,100,0.6)';
      ctx.fillRect(bx + 8, by + 20, (bw - 16) * frac, 2);
    }

    // ── Boss HP bar (when spawned) — sits clear of the ETA plate ──
    if (boss.spawned && boss.state !== 'dead') {
      const bossBarW = 220, bossBarH = 9;
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
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('HIND PURSUIT GUNSHIP', W / 2, bossBarY - 12);
    }

    // Target indicator + mode
    if (heli.target) {
      const ts = cam.worldToScreen(heli.target.x, heli.target.y);
      ts.x /= uiS; ts.y /= uiS; // convert to HUD-logical space
      // Reticle color follows the targeting mode (boss always red)
      const retCol = heli.target === boss ? P.ui.enemy
        : heli.targetMode === 'infrastructure' ? '#44cccc'
        : heli.targetMode === 'strongest' ? '#ff8844'
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
        ctx.moveTo(9, 0); ctx.lineTo(22, 0);
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
        ctx.fillRect(ts.x - bw2 / 2, ts.y + 14, bw2 * clamp(heli.target.hp / heli.target.maxHp, 0, 1), 3);
      }
      // Label + range-to-target (+ lock indicator when click-locked)
      const tRange = Math.round(Math.hypot(heli.target.x - heli.x, heli.target.y - heli.y) / 10) * 10;
      ctx.font = '9px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = retCol;
      let label = 'TARGET';
      if (heli.target === boss) label = 'HIND PURSUIT GUNSHIP';
      else if (Array.isArray(heli.target.route)) label = 'CONVOY';
      else if (heli.target.type) label = heli.target.special === 'radar' ? 'RADAR'
        : heli.target.special === 'fuel' ? 'FUEL TANK'
        : heli.target.type.toUpperCase();
      else if (heli.target.weaponName) label = heli.target.weaponName;
      else if (heli.target.className) label = heli.target.className.toUpperCase();
      if (heli.manualTarget === heli.target) label = 'LCK · ' + label;
      ctx.fillText(label, ts.x, ts.y - 26);
      ctx.fillStyle = '#ffaa88';
      ctx.fillText(`${tRange} m`, ts.x, ts.y + 22);
    }

    // Systems plate — targeting, toggles, equipment, objective
    {
      const px = 8, py = 8, pw = lpw;
      hudPlate(ctx, px, py, pw, sysH, 'rgba(90,140,80,0.55)');
      plateHeader(ctx, px, py, pw, 'SYSTEMS');
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.font = 'bold 10px "Courier New", monospace';
      // Mode-colored targeting readout
      const modeCol = { closest: P.ui.text, strongest: '#ff8844', infrastructure: '#44cccc' }[heli.targetMode] || P.ui.text;
      const modeLabel = { closest: 'CLOSEST', strongest: 'STRONGEST', infrastructure: 'INFRA' }[heli.targetMode] || 'CLOSEST';
      ctx.fillStyle = modeCol;
      ctx.fillText(`TGT ${modeLabel}`, px + 12, py + 18);
      if (!narrow) {
        ctx.fillStyle = P.ui.textDim;
        ctx.fillText('[SHIFT/V]', px + 92, py + 18);
      }
      let ty = py + 34;
      for (let i = 0; i < nToggles; i++) {
        ctx.fillStyle = P.ui.rocket;
        ctx.fillText(i === 0 && input.autofire ? 'AUTOFIRE' : 'CLICK-TARGET', px + 12, ty);
        ty += 15;
      }
      if (equipReady) {
        ctx.fillStyle = '#44cccc';
        ctx.fillText(`E · ${EQUIPMENT[heli.equipmentType].name}`, px + 12, ty);
        ty += 15;
      }
      ctx.font = 'bold 10px "Courier New", monospace';
      for (const line of objWrap) {
        ctx.fillStyle = sortieState.objectiveComplete ? '#44ddff' : '#ffcc44';
        ctx.fillText(line, px + 12, ty); ty += 13;
      }
      if (showProgress) {
        ctx.fillStyle = P.ui.textDim;
        ctx.fillText(`PROGRESS ${world.objective.progress}/${world.objective.requiredCount}`, px + 12, ty);
      }
    }

    // ── BOTTOM-LEFT: circular tactical radar ───────────────────────────
    if (world) {
      const R = mmS / 2;
      const ccx = mmX + R, ccy = mmY + R;
      // Circular backdrop + bezel
      ctx.fillStyle = 'rgba(6,14,6,0.78)';
      ctx.beginPath(); ctx.arc(ccx, ccy, R + 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(90,140,80,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(ccx, ccy, R + 4, 0, Math.PI * 2); ctx.stroke();
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
        ctx.beginPath(); ctx.arc(ccx, ccy, R * rr, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(ccx - R, ccy); ctx.lineTo(ccx + R, ccy);
      ctx.moveTo(ccx, ccy - R); ctx.lineTo(ccx, ccy + R);
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
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(R, 0); ctx.stroke();
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
        if (nowMs > heli._nextPulse) { heli._reconUntil = nowMs + 10000; heli._nextPulse = nowMs + 30000; }
      }
      const reconActive = heli._reconUntil > nowMs;
      const revealR = 1900 * (heli.radarRange || 1);
      const blipAlpha = (wx, wy) => {
        if (reconActive || heli.fullSpectrum) return 1;
        const d = Math.hypot(wx - heli.x, wy - heli.y);
        return d < revealR ? 1 : 0.25;
      };

      // Sites — shape encodes archetype: dot=rural, square=town,
      // triangle=camp, diamond=base
      for (const s of world.sites) {
        const isObj = world.objective && world.objective.targetSiteId === s.id;
        const col = s.cleared ? '#3f7f3f' : s.discovered ? '#ffcc44' : 'rgba(255,204,68,0.5)';
        ctx.globalAlpha = blipAlpha(s.x, s.y);
        ctx.fillStyle = col;
        const sx = mx(s.x), sy = my(s.y);
        if (s.archetype === 'town') {
          ctx.fillRect(sx - 2.5, sy - 2.5, 5, 5);
        } else if (s.archetype === 'camp') {
          ctx.beginPath();
          ctx.moveTo(sx, sy - 3); ctx.lineTo(sx + 3, sy + 2.5); ctx.lineTo(sx - 3, sy + 2.5);
          ctx.closePath(); ctx.fill();
        } else if (s.archetype === 'base') {
          ctx.save();
          ctx.translate(sx, sy); ctx.rotate(Math.PI / 4);
          ctx.fillRect(-2.5, -2.5, 5, 5);
          ctx.restore();
        } else {
          ctx.fillRect(sx - 2, sy - 2, 4, 4);
        }
        if (isObj && !s.cleared) {
          const pr = 3.5 + Math.sin(performance.now() / 180) * 1.5;
          ctx.strokeStyle = '#ff5544';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(sx, sy, pr, 0, Math.PI * 2); ctx.stroke();
        }
      }
      // Convoys — heading ticks
      for (const c of world.convoys) {
        if (c.destroyed || !c.active) continue;
        ctx.globalAlpha = blipAlpha(c.x, c.y);
        const cx2 = mx(c.x), cy2 = my(c.y);
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
        if (ep.card === 'N') { ctx.moveTo(mx(-lim), my(-lim)); ctx.lineTo(mx(lim), my(-lim)); }
        else if (ep.card === 'S') { ctx.moveTo(mx(-lim), my(lim)); ctx.lineTo(mx(lim), my(lim)); }
        else if (ep.card === 'W') { ctx.moveTo(mx(-lim), my(-lim)); ctx.lineTo(mx(-lim), my(lim)); }
        else { ctx.moveTo(mx(lim), my(-lim)); ctx.lineTo(mx(lim), my(lim)); }
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
      ctx.moveTo(5, 0); ctx.lineTo(-4, -3.5); ctx.lineTo(-4, 3.5);
      ctx.closePath(); ctx.fill();
      ctx.restore();

      ctx.restore(); // circular clip

      // Cardinal N marker on the bezel
      ctx.fillStyle = 'rgba(170,255,136,0.8)';
      ctx.font = 'bold 8px "Courier New", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('N', ccx, mmY - 8);
      drawCornerBrackets(ctx, mmX - 4, mmY - 4, mmS + 8, mmS + 8, 'rgba(90,140,80,0.55)', 10, 1.5);
    }

    // ── BOTTOM-CENTRE: compass tape + speed ─────────────────────────────
    if (cpW >= 130) {
      const cx = W / 2, cy = H - cpH / 2 - 12;
      hudPlate(ctx, cx - cpW / 2, cy - cpH / 2, cpW, cpH, 'rgba(90,140,80,0.55)');
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx - cpW / 2 + 6, cy - cpH / 2, cpW - 12, cpH);
      ctx.clip();
      const headingDeg = ((heli.angle * 180 / Math.PI) + 90 + 360) % 360;
      const pxPerDeg = 2.1;
      ctx.font = 'bold 9px "Courier New", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
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
        const b = ((Math.atan2(wy - heli.y, wx - heli.x) * 180 / Math.PI) + 90 + 360) % 360;
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
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(`${spdNow}`, cx + cpW / 2 - 26, cy);
      ctx.fillStyle = 'rgba(120,160,100,0.6)';
      ctx.fillText('SPD', cx + cpW / 2 - 26, cy + 10);
    }

    // ── BOTTOM-RIGHT: sortie stats ──────────────────────────────────────
    {
      hudPlate(ctx, stX, stY, stW, stH, 'rgba(90,140,80,0.55)');
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const secs = Math.floor((performance.now() - sortieStartedAt) / 1000);
      const tStr = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      const clearedN = world ? world.sites.filter(s => s.cleared).length : 0;
      const totalSites = world ? world.sites.length : 0;
      ctx.font = 'bold 11px "Courier New", monospace';
      ctx.fillStyle = P.ui.text;
      ctx.fillText(`KILLS ${sortieState.stats.kills}`, stX + 12, stY + 8);
      ctx.fillText(`TIME ${tStr}`, stX + 12, stY + 24);
      ctx.fillStyle = '#ffcc44';
      ctx.fillText(`SITES ${clearedN}/${totalSites}`, stX + 62, stY + 8);
      ctx.font = 'bold 9px "Courier New", monospace';
      ctx.fillStyle = 'rgba(90,130,80,0.8)';
      ctx.fillText(`FPS ${lastFps}`, stX + 62, stY + 24);
    }

    // ── Target-MODE chip (touch: sits on the mode tap-zone near fire) ──
    if (IS_TOUCH) {
      const chipW = 118, chipH = 24;
      const chipX = W - chipW - 10, chipY = H * 0.36 - chipH / 2;
      hudPlate(ctx, chipX, chipY, chipW, chipH, 'rgba(90,140,80,0.55)');
      const modeLabel = { closest: 'CLOSEST', strongest: 'STRONGEST', infrastructure: 'INFRA' }[heli.targetMode] || 'CLOSEST';
      ctx.font = 'bold 9px "Courier New", monospace';
      ctx.fillStyle = P.ui.text;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`MODE ▸ ${modeLabel}`, chipX + chipW / 2, chipY + chipH / 2 + 0.5);
    }

    // ── Objective + extraction direction markers (drawn above all plates) ──
    {
      const focus = getObjectiveFocus();
      if (focus) drawOffscreenMarker(ctx, camera, W, H, focus.x, focus.y, '#ff5544', '#ff9966', null, uiS);
      if (world?.extraction?.active) {
        const ep = nearestExitPoint();
        drawOffscreenMarker(ctx, camera, W, H, ep.x, ep.y, '#44ddff', '#88ddff', `EXIT ${ep.card}`, uiS);
      }
    }

    // Controls hint — fades out after the first seconds of a sortie,
    // lifted above the bottom HUD row.
    {
      const age = (performance.now() - sortieStartedAt) / 1000;
      const alpha = clamp(1 - (age - 10) / 3, 0, 1) * 0.55;
      if (alpha > 0.01) {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = P.ui.text;
        ctx.font = '9px "Courier New", monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
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
  ctx.save(); ctx.scale(dpr, dpr);

  // Dimmed backdrop
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2, cy = h / 2;
  const panelW = 300, panelH = 260;

  // Panel
  ctx.fillStyle = '#0a1a0a';
  ctx.fillRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH);
  ctx.strokeStyle = '#3a5a2a';
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH);
  drawCornerBrackets(ctx, cx - panelW / 2, cy - panelH / 2, panelW, panelH, P.ui.borderHi, 14, 2);

  // Title
  ctx.fillStyle = P.ui.textBright;
  ctx.font = 'bold 16px "Courier New", monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('PAUSE — SETTINGS', cx, cy - panelH / 2 + 14);

  ctx.strokeStyle = '#3a5a2a'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 100, cy - panelH / 2 + 38);
  ctx.lineTo(cx + 100, cy - panelH / 2 + 38);
  ctx.stroke();

  // Options
  const optX = cx - panelW / 2 + 24;
  let optY = cy - panelH / 2 + 52;
  const lineH = 28;

  function drawOption(label, enabled) {
    // Toggle box
    ctx.fillStyle = '#1a2a1a';
    ctx.fillRect(optX, optY, 14, 14);
    ctx.strokeStyle = enabled ? P.ui.textBright : '#446633';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(optX, optY, 14, 14);
    if (enabled) {
      ctx.fillStyle = P.ui.textBright;
      ctx.fillRect(optX + 3, optY + 3, 8, 8);
    }
    // Label
    ctx.fillStyle = P.ui.text;
    ctx.font = '12px "Courier New", monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(label, optX + 22, optY + 1);
    optY += lineH;
  }

  drawOption('Autofire (F key)', input.autofire);
  drawOption('Click to Target (T key)', input.clickToTarget);
  optY += 8;

  // Abandon option (in-sortie only)
  if (currentScreen === screens.sortie && sortieState.status === 'active') {
    ctx.fillStyle = '#ff7744';
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
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
  ctx.fillText('Mouse: steer', refX, optY); optY += 16;
  ctx.fillText('Click / Space: fire', refX, optY); optY += 16;
  ctx.fillText('Shift: cycle target', refX, optY); optY += 16;
  ctx.fillText('WASD: move', refX, optY); optY += 16;

  ctx.restore();
}

function drawEnemy(ctx, e) { return _drawEnemy(ctx, e); }

function drawBoss(ctx) { _setBoss(boss); return _drawBoss(ctx); }

function drawHunter(ctx) { _setBoss(boss); return _drawHunter(ctx); }

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
    const gap = 10;
    const cardW = Math.min(190, (w - 56 - gap * 2) / 3);
    const cardH = Math.min(190, cam.screenH - 150);
    const left = (w - (cardW * 3 + gap * 2)) / 2;
    const pos = getCanvasClickPos(e);
    const dpr = cam.dpr;
    for (let i = 0; i < sortieState.upgradeChoices.length; i++) {
      const x = (left + i * (cardW + gap)) * dpr;
      const y = 106 * dpr;
      if (pos.x >= x && pos.x <= x + cardW * dpr && pos.y >= y && pos.y <= y + cardH * dpr) {
        chooseFearUpgrade(i);
        return;
      }
    }
    return;
  }

  const pos = getCanvasClickPos(e);
  const cam = camera;
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
  if (currentScreen === screens.title) {
    for (const box of titleMenuBoxes) {
      if (pos.x >= box.x * cam.dpr && pos.x <= (box.x + box.w) * cam.dpr &&
          pos.y >= box.y * cam.dpr && pos.y <= (box.y + box.h) * cam.dpr) {
        metaReturnScreen = 'title';
        switchScreen(box.target);
        return;
      }
    }
    return;
  } else if (currentScreen === screens.contracts) {
    if (posInBox(pos, contractsBackBox, cam.dpr)) { switchScreen('title'); return; }
    for (let i = 0; i < contractBoard.length; i++) {
      const r = contractCardRect(i, w / cam.dpr, h / cam.dpr);
      const scaled = { x: r.x * cam.dpr, y: r.y * cam.dpr, w: r.w * cam.dpr, h: r.h * cam.dpr };
      if (pointInRect(pos.x, pos.y, scaled)) {
        switchScreen('briefing', contractBoard[i]);
        break;
      }
    }
  } else if (currentScreen === screens.briefing) {
    if (posInBox(pos, briefingBackBox, cam.dpr)) { switchScreen('contracts'); return; }
    // Equipment selector first — a click on a box selects instead of launching.
    for (const box of briefingEquipmentBoxes) {
      if (posInBox(pos, box, cam.dpr)) {
        selectedEquipment = box.key;
        return;
      }
    }
    if (posInBox(pos, briefingInsertBox, cam.dpr)) switchScreen('sortie', activeContract);
  } else if (currentScreen === screens.debrief) {
    if (posInBox(pos, debriefPilotBox, cam.dpr)) { metaReturnScreen = 'contracts'; switchScreen('pilot'); return; }
    if (posInBox(pos, debriefNextBox, cam.dpr)) switchScreen('contracts');
  }
});

canvas.addEventListener('touchstart', (e) => {
  const touch = e.touches[0];
  canvas.dispatchEvent(new MouseEvent('click', {
    clientX: touch.clientX,
    clientY: touch.clientY,
  }));
});

career = loadCareer() || createCareer((Math.random() * 0xffffffff) >>> 0);
GameState.setCareer(career);
metaState.career = career;
registerScreen('hangar', hangarScreen);
registerScreen('pilot', pilotScreen);

switchScreen('title');
console.log('[Gunship] starting loop');
requestAnimationFrame(loop);
