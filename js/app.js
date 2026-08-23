/**
 * Entry point — game loop, screen router, DPR-aware canvas.
 */
console.log('[Gunship] app.js loading...');

import { SIM_HZ, SIM_DT, WORLD_SIZE, TIMER, CIVILIAN_ESCAPE_RADIUS } from './config.js';
import { WorldCamera } from './camera.js';
import { Input } from './input.js';
import { P, mats } from './palette.js';
import { VIEW25, deckRy } from './view25.js';
import { cyl25, box25, frustum25 } from './prims25.js';
import { withAlpha, fillCircle, drawLine, drawTextShadow } from './drawUtil.js';
import { mulberry32 } from './rng.js';
import { clamp } from './rng.js';
import { createNoise, fbm, ridged, duneNoise, windStreaks, voronoi } from './noise.js';
import { generateWorld, getBuildingTemplate, getSpeedMod } from './world.js';
import { createEnemyFromRoster } from './data/enemies.js';
import { createContractBoard, getDifficulty as getDifficultyProfile, getScenario, getStyle } from './contracts.js';
import { createUpgradeChoices } from './upgrades.js';

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
    accumulator += dt;
    let safety = 0;
    while (accumulator >= SIM_DT && safety < 4) {
      if (!settingsOpen && !sortieState.levelUpOpen && currentScreen && currentScreen.tick) currentScreen.tick(SIM_DT);
      accumulator -= SIM_DT;
      safety++;
    }
    accumulator = 0;
    input.consumeOneShots();
    camera.tick(dt);
    camera.clear(camera.ctx, '#1a1a0a');
    if (currentScreen && currentScreen.draw) {
      currentScreen.draw(camera.ctx, camera, dt);
    }
    input.draw(camera.ctx);
    const fps = rawDt > 0 ? Math.round(1 / rawDt) : 0;
    camera.ctx.save();
    camera.ctx.scale(camera.dpr, camera.dpr);
    drawTextShadow(camera.ctx, `FPS: ${fps}`, 8, 8, '#446633', 11, 'left');
    camera.ctx.restore();

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

function toggleSettings() {
  settingsOpen = !settingsOpen;
}

// ══════════════════════════════════════════════════════════════
//  WORLD RENDERING — smooth noise terrain, roads, sites
// ══════════════════════════════════════════════════════════════

let world = null;
let terrainNoise = null;
let moistureNoise = null;
let detailNoise = null;
let contractBoard = [];
let activeContract = null;

const sortieState = {
  status: 'idle',
  objectiveComplete: false,
  fearLevel: 0,
  levelUpOpen: false,
  upgradeChoices: [],
  pendingLevelUps: 0,
  appliedUpgrades: [],
  heat: {
    value: 0,
    tier: 0,
    lastContact: 0,
    lastEvent: '',
    eventTimer: 0,
    decayMultiplier: 1,
  },
  hunter: {
    etaRemaining: TIMER.baseTime,
    warning: false,
    warningTimer: 0,
  },
  extraction: {
    progress: 0,
  },
  rewards: {
    objective: 0,
    supplies: 0,
    hunter: 0,
    secured: 0,
  },
  stats: {
    kills: 0,
    crates: 0,
    sites: 0,
  },
  endTimer: 0,
};

function initWorld(contract = null) {
  const seed = contract?.seed ?? 42;
  world = generateWorld({ seed, contract });
  terrainNoise = createNoise(seed);
  moistureNoise = createNoise(seed + 777);
  detailNoise = createNoise(seed + 333);
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

const BIOME = {
  sand:      { r: 210, g: 180, b: 130 },  // warmer, less yellow
  hardpack:  { r: 185, g: 155, b: 110 },  // compacted desert floor
  rock:      { r: 130, g: 115, b: 90  },  // darker, more grey-brown
  dunes:     { r: 225, g: 200, b: 145 },  // soft golden
  gravel:    { r: 155, g: 140, b: 105 },  // grey gravel
  wetSand:   { r: 165, g: 140, b: 100 },  // damp, muted
  brightSand:{ r: 235, g: 215, b: 160 },  // sunlit crests
};

function sampleTerrain(wx, wy) {
  const scale = 0.0006;
  const detail = 0.005;
  const windAngle = 0.6; // prevailing wind direction

  // Domain warping for organic shapes
  const warped = { x: wx, y: wy };
  const warpStrength = 40;
  warped.x += fbm(terrainNoise, wx * 0.0003, wy * 0.0003, 2) * warpStrength;
  warped.y += fbm(moistureNoise, wx * 0.0003 + 100, wy * 0.0003 + 100, 2) * warpStrength;

  // Large-scale elevation
  const elev = fbm(terrainNoise, warped.x * scale, warped.y * scale, 5, 2.0, 0.5);

  // Dune shapes — crescent/barchan dunes aligned with wind
  const dunes = duneNoise(terrainNoise, warped.x * 0.0005, warped.y * 0.0005, windAngle, 1.0);

  // Moisture (determines wet/dry areas)
  const moist = fbm(moistureNoise, warped.x * scale * 1.2, warped.y * scale * 1.2, 3, 2.0, 0.5);

  // Wind streaks — long parallel lines
  const streaks = windStreaks(detailNoise, wx, wy, windAngle, 0.015);

  // Fine texture — pebbles, grain
  const grain = fbm(detailNoise, wx * detail, wy * detail, 3, 2.2, 0.45);

  // Rocky outcrop detection (voronoi edges)
  const rocky = voronoi(terrainNoise, wx, wy, 0.008);

  // ── Color blending ──
  let r, g, b;

  // Base layer: elevation-driven
  if (elev < -0.15) {
    // Low flat areas: wet sand or gravel
    const t = (elev + 0.4) / 0.25;
    const wetMix = Math.max(0, moist) * 0.4;
    r = lerp(BIOME.gravel.r, BIOME.wetSand.r, wetMix);
    g = lerp(BIOME.gravel.g, BIOME.wetSand.g, wetMix);
    b = lerp(BIOME.gravel.b, BIOME.wetSand.b, wetMix);
    r = lerp(r, BIOME.sand.r, clamp(t, 0, 1));
    g = lerp(g, BIOME.sand.g, clamp(t, 0, 1));
    b = lerp(b, BIOME.sand.b, clamp(t, 0, 1));
  } else if (elev < 0.1) {
    // Flat desert: sand with moisture variation
    const moisture = (moist + 1) * 0.5;
    if (moisture < 0.35) {
      // Dry sand
      r = BIOME.sand.r; g = BIOME.sand.g; b = BIOME.sand.b;
    } else if (moisture < 0.55) {
      // Hardpack
      r = BIOME.hardpack.r; g = BIOME.hardpack.g; b = BIOME.hardpack.b;
    } else {
      // Wet sand near wadis
      r = BIOME.wetSand.r; g = BIOME.wetSand.g; b = BIOME.wetSand.b;
    }
  } else if (elev < 0.3) {
    // Rising terrain: hardpack to dunes
    const t = (elev - 0.1) / 0.2;
    const duneFactor = Math.max(0, dunes) * t;
    r = lerp(BIOME.hardpack.r, BIOME.dunes.r, duneFactor);
    g = lerp(BIOME.hardpack.g, BIOME.dunes.g, duneFactor);
    b = lerp(BIOME.hardpack.b, BIOME.dunes.b, duneFactor);
    // Bright sand on dune crests
    const crest = Math.max(0, dunes - 0.4) * 2.5;
    r = lerp(r, BIOME.brightSand.r, crest);
    g = lerp(g, BIOME.brightSand.g, crest);
    b = lerp(b, BIOME.brightSand.b, crest);
  } else {
    // High terrain: rocky with dune ridges
    const rockMix = clamp((elev - 0.3) * 3, 0, 1);
    r = lerp(BIOME.hardpack.r, BIOME.rock.r, rockMix);
    g = lerp(BIOME.hardpack.g, BIOME.rock.g, rockMix);
    b = lerp(BIOME.hardpack.b, BIOME.rock.b, rockMix);
    // Rocky outcrops from voronoi
    const rockEdge = clamp(rocky * 4, 0, 1);
    r = lerp(r, BIOME.rock.r * 0.8, rockEdge);
    g = lerp(g, BIOME.rock.g * 0.8, rockEdge);
    b = lerp(b, BIOME.rock.b * 0.8, rockEdge);
  }

  // ── Wind streaks — long parallel lines ──
  const streakEffect = streaks * 18;
  r += streakEffect; g += streakEffect * 0.8; b += streakEffect * 0.5;

  // ── Grain/texture — fine pebble detail ──
  const grainVar = grain * 10;
  r += grainVar; g += grainVar; b += grainVar;

  // ── Dune shadow (leeward side darker) ──
  if (dunes > 0.1) {
    const shadow = Math.max(0, -dunes) * 15;
    r -= shadow; g -= shadow; b -= shadow;
  }

  return {
    r: Math.max(0, Math.min(255, Math.round(r))),
    g: Math.max(0, Math.min(255, Math.round(g))),
    b: Math.max(0, Math.min(255, Math.round(b))),
  };
}

// ── Smooth terrain rendering ──
// Terrain is sampled on a coarse grid, then bilinearly blended across the
// display tiles, so the ground reads as continuous desert instead of blocks.

const TERRAIN_GRID_STEP = 96;   // world units between terrain samples
let tgX0 = 0, tgY0 = 0, tgCols = 0, tgRows = 0, tgData = null;

function updateTerrainGrid(cam) {
  const b = cam.getVisibleBounds();
  const x0 = Math.floor(b.left / TERRAIN_GRID_STEP) * TERRAIN_GRID_STEP;
  const y0 = Math.floor(b.top / TERRAIN_GRID_STEP) * TERRAIN_GRID_STEP;
  const cols = Math.ceil((b.right - x0) / TERRAIN_GRID_STEP) + 2;
  const rows = Math.ceil((b.bottom - y0) / TERRAIN_GRID_STEP) + 2;

  if (!tgData || cols !== tgCols || rows !== tgRows || x0 !== tgX0 || y0 !== tgY0) {
    tgX0 = x0; tgY0 = y0; tgCols = cols; tgRows = rows;
    tgData = new Float32Array(cols * rows * 3);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const col = sampleTerrain(x0 + c * TERRAIN_GRID_STEP, y0 + r * TERRAIN_GRID_STEP);
        const i = (r * cols + c) * 3;
        tgData[i] = col.r; tgData[i + 1] = col.g; tgData[i + 2] = col.b;
      }
    }
  }
}

/** Bilinear blend of the coarse terrain grid at a world position. */
function terrainColorAt(wx, wy, out) {
  const gx = clamp((wx - tgX0) / TERRAIN_GRID_STEP, 0, tgCols - 1.001);
  const gy = clamp((wy - tgY0) / TERRAIN_GRID_STEP, 0, tgRows - 1.001);
  const cx = Math.floor(gx), cy = Math.floor(gy);
  const fx = gx - cx, fy = gy - cy;
  const i00 = (cy * tgCols + cx) * 3;
  const i10 = i00 + 3;
  const i01 = i00 + tgCols * 3;
  const i11 = i01 + 3;
  const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
  out[0] = tgData[i00] * w00 + tgData[i10] * w10 + tgData[i01] * w01 + tgData[i11] * w11;
  out[1] = tgData[i00 + 1] * w00 + tgData[i10 + 1] * w10 + tgData[i01 + 1] * w01 + tgData[i11 + 1] * w11;
  out[2] = tgData[i00 + 2] * w00 + tgData[i10 + 2] * w10 + tgData[i01 + 2] * w01 + tgData[i11 + 2] * w11;
}

const _terrainCol = [0, 0, 0];

function drawSmoothTerrain(ctx, cam) {
  updateTerrainGrid(cam);
  const step = 32;
  const bounds = cam.getVisibleBounds();
  const startX = Math.floor(bounds.left / step) * step;
  const startY = Math.floor(bounds.top / step) * step;
  const endX = Math.ceil(bounds.right / step) * step;
  const endY = Math.ceil(bounds.bottom / step) * step;
  for (let x = startX; x < endX; x += step) {
    for (let y = startY; y < endY; y += step) {
      terrainColorAt(x + step / 2, y + step / 2, _terrainCol);
      ctx.fillStyle = `rgb(${_terrainCol[0] | 0},${_terrainCol[1] | 0},${_terrainCol[2] | 0})`;
      ctx.fillRect(x, y, step + 1, step + 1);
    }
  }
}

function drawRoads(ctx, cam) {
  if (!world) return;
  for (const road of world.roads) {
    if (road.points.length < 2) continue;
    const surface = road.surface || 'dirt';

    // Road shoulder/edge (wider, darker)
    const edgeColor = surface === 'paved' ? '#5a4a2a' : surface === 'dirt' ? '#7a6a3a' : '#8a7a4a';
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = road.width + 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(road.points[0].x, road.points[0].y);
    for (let i = 1; i < road.points.length; i++) ctx.lineTo(road.points[i].x, road.points[i].y);
    ctx.stroke();

    // Main road surface
    const roadColor = surface === 'paved' ? '#7a6a4a' : surface === 'dirt' ? '#9a8a5a' : '#a89868';
    ctx.strokeStyle = roadColor;
    ctx.lineWidth = road.width;
    ctx.beginPath();
    ctx.moveTo(road.points[0].x, road.points[0].y);
    for (let i = 1; i < road.points.length; i++) ctx.lineTo(road.points[i].x, road.points[i].y);
    ctx.stroke();

    // Road grain texture (subtle noise)
    if (surface !== 'paved') {
      ctx.strokeStyle = withAlpha('#000000', 0.06);
      ctx.lineWidth = road.width * 0.5;
      ctx.setLineDash([3, 8]);
      ctx.beginPath();
      ctx.moveTo(road.points[0].x, road.points[0].y);
      for (let i = 1; i < road.points.length; i++) ctx.lineTo(road.points[i].x, road.points[i].y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Paved road center line (dashed yellow)
    if (surface === 'paved') {
      ctx.strokeStyle = withAlpha('#ccaa66', 0.35);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([14, 20]);
      ctx.beginPath();
      ctx.moveTo(road.points[0].x, road.points[0].y);
      for (let i = 1; i < road.points.length; i++) ctx.lineTo(road.points[i].x, road.points[i].y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Track roads: subtle tire ruts
    if (surface === 'track') {
      ctx.strokeStyle = withAlpha('#000000', 0.08);
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 10]);
      // Left rut
      ctx.beginPath();
      ctx.moveTo(road.points[0].x, road.points[0].y);
      for (let i = 1; i < road.points.length; i++) ctx.lineTo(road.points[i].x - 3, road.points[i].y);
      ctx.stroke();
      // Right rut
      ctx.beginPath();
      ctx.moveTo(road.points[0].x, road.points[0].y);
      for (let i = 1; i < road.points.length; i++) ctx.lineTo(road.points[i].x + 3, road.points[i].y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function drawSites(ctx, cam) {
  if (!world) return;
  for (const v of world.sites) {
    if (!cam.isVisible(v.x, v.y, 120)) continue;
    const markerColor = v.cleared ? '#44ff44' : v.archetype === 'base' ? P.ui.enemy : P.ui.settlement;

    // Village perimeter glow
    ctx.fillStyle = withAlpha(markerColor, 0.08);
    ctx.beginPath();
    ctx.arc(v.x, v.y, 60, 0, Math.PI * 2);
    ctx.fill();

    // Archetype-specific marker
    ctx.strokeStyle = withAlpha(markerColor, 0.4);
    ctx.lineWidth = 1.5;
    if (v.archetype === 'base') {
      // Square perimeter for bases
      ctx.strokeRect(v.x - 45, v.y - 45, 90, 90);
    } else if (v.archetype === 'town') {
      // Double circle for towns
      ctx.beginPath(); ctx.arc(v.x, v.y, 50, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(v.x, v.y, 40, 0, Math.PI * 2); ctx.stroke();
    } else if (v.archetype === 'camp') {
      // Triangle for camps
      ctx.beginPath();
      ctx.moveTo(v.x, v.y - 45);
      ctx.lineTo(v.x + 40, v.y + 25);
      ctx.lineTo(v.x - 40, v.y + 25);
      ctx.closePath();
      ctx.stroke();
    } else {
      // Circle for rural
      ctx.beginPath(); ctx.arc(v.x, v.y, 35, 0, Math.PI * 2); ctx.stroke();
    }

    // Site name
    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = v.cleared ? '#44ff44' : P.ui.settlement;
    ctx.fillText(v.name, v.x, v.y - 60);
    // Archetype label
    ctx.fillStyle = P.ui.textDim;
    ctx.font = '8px "Courier New", monospace';
    ctx.fillText(v.archetype.toUpperCase(), v.x, v.y - 49);
    // Enemy count (if discovered, not cleared)
    if (v.discovered && !v.cleared) {
      const alive = enemies.filter(e => e.siteId === v.id && e.state !== 'dead').length;
      ctx.fillStyle = alive > 0 ? P.ui.enemy : '#44ff44';
      ctx.fillText(`${alive} HOSTILE${alive !== 1 ? 'S' : ''}`, v.x, v.y + 50);
    }
    if (v.cleared) {
      ctx.fillStyle = '#44ff44';
      ctx.fillText('CLEARED', v.x, v.y + 50);
    }
  }
}

function drawDecorations(ctx, cam) {
  if (!world) return;
  for (const d of world.decorations) {
    if (!cam.isVisible(d.x, d.y, 20)) continue;
    if (d.type === 'bush') {
      ctx.fillStyle = withAlpha('#6a8a3a', 0.7);
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = withAlpha('#4a6a2a', 0.4);
      ctx.beginPath();
      ctx.arc(d.x + 1, d.y + 1, d.size * 0.7, 0, Math.PI * 2);
      ctx.fill();
    } else if (d.type === 'rock') {
      ctx.fillStyle = '#8a7a5a';
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, d.size, d.size * 0.6, d.angle, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = withAlpha('#000000', 0.15);
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (d.type === 'palm') {
      ctx.strokeStyle = '#8a6a3a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x + 2, d.y - d.size * 1.5);
      ctx.stroke();
      const fx = d.x + 2;
      const fy = d.y - d.size * 1.5;
      ctx.fillStyle = withAlpha('#4a8a2a', 0.8);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + d.angle;
        ctx.beginPath();
        ctx.ellipse(fx, fy, d.size * 0.8, 2, a, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (d.type === 'crater') {
      ctx.strokeStyle = withAlpha('#6a5a3a', 0.3);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = withAlpha('#7a6a4a', 0.15);
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.size * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawScenarioOverlays(ctx, cam) {
  if (!world) return;

  if (world.extraction?.active) {
    const pulse = 1 + Math.sin(performance.now() / 180) * 0.12;
    ctx.strokeStyle = withAlpha('#44ddff', 0.85);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(world.extraction.x, world.extraction.y, world.extraction.radius * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = withAlpha('#44ddff', 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(world.extraction.x - 20, world.extraction.y);
    ctx.lineTo(world.extraction.x + 20, world.extraction.y);
    ctx.moveTo(world.extraction.x, world.extraction.y - 20);
    ctx.lineTo(world.extraction.x, world.extraction.y + 20);
    ctx.stroke();
    ctx.fillStyle = '#44ddff';
    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`EXTRACTION ${Math.round(clamp(sortieState.extraction.progress / (world.extraction.holdTime || 1), 0, 1) * 100)}%`, world.extraction.x, world.extraction.y - 52);
  }

  for (const crate of world.supplyCrates || []) {
    if (crate.collected || !cam.isVisible(crate.x, crate.y, 30)) continue;
    const pulse = 1 + Math.sin(performance.now() / 240 + crate.x) * 0.08;
    ctx.fillStyle = '#c09050';
    ctx.fillRect(crate.x - 7 * pulse, crate.y - 7 * pulse, 14 * pulse, 14 * pulse);
    ctx.strokeStyle = '#ffcc44';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(crate.x - 7 * pulse, crate.y - 7 * pulse, 14 * pulse, 14 * pulse);
    ctx.strokeStyle = '#ffcc44';
    ctx.beginPath();
    ctx.moveTo(crate.x - 6, crate.y); ctx.lineTo(crate.x + 6, crate.y);
    ctx.moveTo(crate.x, crate.y - 6); ctx.lineTo(crate.x, crate.y + 6);
    ctx.stroke();
  }

  const target = world.objective?.target;
  if (target && isTargetAlive(target) && target !== boss) {
    ctx.strokeStyle = withAlpha('#ff4444', 0.75);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(target.x, target.y, target.w ? Math.max(target.w, target.d) * 0.7 : 18, 0, Math.PI * 2);
    ctx.stroke();
    if (target.hp !== undefined && target.maxHp) {
      const barW = target.w ? Math.max(34, target.w * 1.5) : 34;
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(target.x - barW / 2, target.y - 22, barW, 4);
      ctx.fillStyle = '#ff4444';
      ctx.fillRect(target.x - barW / 2, target.y - 22, barW * clamp(target.hp / target.maxHp, 0, 1), 4);
    }
    ctx.fillStyle = '#ff8844';
    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(world.objective.type === 'intercept' ? 'CONVOY TARGET' : 'PRIMARY TARGET', target.x, target.y - 28);
  }
}

function drawBuilding(ctx, b) {
  if (b.destroyed) {
    ctx.fillStyle = withAlpha('#3a2a1a', 0.7);
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, b.w * 0.55, b.d * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const m = mats(b.col);
  const cx = b.x;
  const cy = b.y;

  // Shadow
  ctx.fillStyle = withAlpha('#000000', 0.2);
  ctx.beginPath();
  ctx.ellipse(cx + 3, cy + 4, b.w * 0.6, b.d * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  if (b.type === 'tower') {
    frustum25(ctx, cx, cy - b.h, b.w / 2, b.w / 2.5, b.h, m);
    // Antenna on top
    ctx.strokeStyle = P.building.antenna;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy - b.h - 8);
    ctx.lineTo(cx, cy - b.h);
    ctx.stroke();
    // Antenna tip light
    ctx.fillStyle = withAlpha('#ff4444', 0.6 + Math.sin(performance.now() / 300) * 0.3);
    ctx.beginPath();
    ctx.arc(cx, cy - b.h - 8, 1.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    box25(ctx, cx, cy - b.h, b.w, b.d, b.h, m);
  }

  // Building-specific details
  if (b.type === 'depot' || b.type === 'garage') {
    // Rolling door
    ctx.fillStyle = withAlpha(P.building.steelDark, 0.6);
    ctx.fillRect(cx - b.w * 0.25, cy - b.h * 0.3, b.w * 0.5, b.h * 0.3);
    ctx.strokeStyle = P.building.steel;
    ctx.lineWidth = 0.8;
    // Door slats
    for (let i = 0; i < 3; i++) {
      const dy = cy - b.h * 0.3 + i * (b.h * 0.1);
      ctx.beginPath();
      ctx.moveTo(cx - b.w * 0.25, dy);
      ctx.lineTo(cx + b.w * 0.25, dy);
      ctx.stroke();
    }
  }

  if (b.type === 'barracks') {
    // Windows
    ctx.fillStyle = withAlpha('#2a3a2a', 0.5);
    const winW = 4, winH = 3;
    for (let i = -1; i <= 1; i++) {
      ctx.fillRect(cx + i * 12 - winW / 2, cy - b.h * 0.6, winW, winH);
    }
  }

  if (b.type === 'fuel') {
    ctx.strokeStyle = withAlpha(P.highPriority.stripe, 0.6);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, b.w / 2 + 4, 0, Math.PI * 2);
    ctx.stroke();
    const ry = deckRy(b.d / 2);
    ctx.fillStyle = P.building.hazard;
    ctx.fillRect(cx - b.w / 3, cy - ry * 0.3, b.w / 1.5, 2);
    ctx.fillRect(cx - b.w / 3, cy + ry * 0.3, b.w / 1.5, 2);
  }

  // Outline on all buildings
  ctx.strokeStyle = P.enemy.outline;
  ctx.lineWidth = 1.2;
  if (b.type === 'tower') {
    ctx.beginPath();
    ctx.arc(cx, cy - b.h, b.w / 2 + 1, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // Bottom edge only for box buildings
    const ry = deckRy(b.d / 2);
    ctx.beginPath();
    ctx.moveTo(cx - b.w / 2, cy);
    ctx.lineTo(cx + b.w / 2, cy);
    ctx.lineTo(cx + b.w / 2, cy - b.h);
    ctx.stroke();
  }
}

function drawHeliShadow(ctx, h) {
  ctx.fillStyle = P.gunship.shadow;
  ctx.beginPath();
  ctx.ellipse(h.x + 4, h.y + 6, 22, 8, h.angle, 0, Math.PI * 2);
  ctx.fill();
}

function drawGunship(ctx, h) {
  const cx = h.x;
  const cy = h.y;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(h.angle);
  const bw = 10, bl = 30; // larger gunship

  // Shadow underneath
  ctx.fillStyle = P.gunship.shadow;
  ctx.beginPath();
  ctx.ellipse(2, 4, bl * 0.9, bw * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tail boom
  ctx.fillStyle = P.gunship.bodyDark;
  ctx.fillRect(-bl - 8, -1.5, 12, 3);
  ctx.fillStyle = P.gunship.body;
  ctx.fillRect(-bl - 8, -1.5, 12, 2);
  // Tail fin (vertical stabilizer)
  ctx.fillStyle = P.gunship.bodyDark;
  ctx.beginPath();
  ctx.moveTo(-bl - 6, -1.5);
  ctx.lineTo(-bl - 10, -8);
  ctx.lineTo(-bl - 2, -1.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = P.gunship.outline;
  ctx.lineWidth = 1;
  ctx.stroke();
  // Tail rotor
  const tailAngle = (h.bladeAngle * 2.5) % (Math.PI * 2);
  ctx.strokeStyle = P.gunship.rotor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-bl - 6 + Math.cos(tailAngle) * 4, -5 + Math.sin(tailAngle) * 1.5);
  ctx.lineTo(-bl - 6 - Math.cos(tailAngle) * 4, -5 - Math.sin(tailAngle) * 1.5);
  ctx.stroke();

  // Fuselage — dark underside
  ctx.fillStyle = P.gunship.bodyDark;
  ctx.beginPath();
  ctx.moveTo(-bl, 1.5); ctx.lineTo(-bl * 0.4, -bw - 1.5); ctx.lineTo(bl * 0.5, -bw * 0.8 - 1.5);
  ctx.lineTo(bl, -2.5); ctx.lineTo(bl * 0.5, bw * 0.8 - 1.5); ctx.lineTo(-bl * 0.4, bw - 1.5);
  ctx.closePath(); ctx.fill();

  // Fuselage — main body
  ctx.fillStyle = P.gunship.body;
  ctx.beginPath();
  ctx.moveTo(-bl, 0); ctx.lineTo(-bl * 0.4, -bw); ctx.lineTo(bl * 0.5, -bw * 0.8);
  ctx.lineTo(bl, -1); ctx.lineTo(bl * 0.5, bw * 0.8); ctx.lineTo(-bl * 0.4, bw);
  ctx.closePath(); ctx.fill();

  // Fuselage — highlight panel (top surface)
  ctx.fillStyle = P.gunship.bodyHi;
  ctx.beginPath();
  ctx.moveTo(-bl * 0.2, -bw * 0.5); ctx.lineTo(bl * 0.3, -bw * 0.5);
  ctx.lineTo(bl * 0.4, -bw * 0.2); ctx.lineTo(-bl * 0.2, -bw * 0.2);
  ctx.closePath(); ctx.fill();

  // Cockpit canopy (glass)
  ctx.fillStyle = P.gunship.cockpit;
  ctx.beginPath(); ctx.ellipse(bl * 0.15, 0, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = P.gunship.cockpitHi;
  ctx.beginPath(); ctx.ellipse(bl * 0.1, -1.5, 3.5, 2.5, -0.2, 0, Math.PI * 2); ctx.fill();
  // Canopy frame
  ctx.strokeStyle = withAlpha(P.gunship.outline, 0.4);
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.ellipse(bl * 0.15, 0, 7, 5, 0, 0, Math.PI * 2); ctx.stroke();

  // Engine intakes (side-mounted)
  ctx.fillStyle = P.gunship.steelDark;
  ctx.fillRect(-bl * 0.1, -bw - 2, 8, 3);
  ctx.fillRect(-bl * 0.1, bw - 1, 8, 3);
  ctx.fillStyle = P.gunship.steel;
  ctx.fillRect(-bl * 0.1, -bw - 2, 8, 1.5);
  ctx.fillRect(-bl * 0.1, bw - 0.5, 8, 1.5);

  // Weapon pylons + pods
  ctx.fillStyle = P.gunship.weaponPod;
  ctx.fillRect(-2, -bw - 4, 12, 4); // left pod
  ctx.fillRect(-2, bw, 12, 4);       // right pod
  ctx.fillStyle = P.gunship.weaponHi;
  ctx.fillRect(0, -bw - 4, 10, 1.5);
  ctx.fillRect(0, bw, 10, 1.5);
  // Gun barrels (M230 chain gun under nose)
  ctx.fillStyle = P.gunship.steelDark;
  ctx.fillRect(bl * 0.3, -1, 8, 2);

  // Fuselage outline — thin, clean
  ctx.strokeStyle = P.gunship.outline;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-bl, 0); ctx.lineTo(-bl * 0.4, -bw); ctx.lineTo(bl * 0.5, -bw * 0.8);
  ctx.lineTo(bl, -1); ctx.lineTo(bl * 0.5, bw * 0.8); ctx.lineTo(-bl * 0.4, bw);
  ctx.closePath(); ctx.stroke();

  // Skid struts
  ctx.strokeStyle = P.gunship.skid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-bl * 0.2, -bw - 2); ctx.lineTo(-bl * 0.2, -bw - 5);
  ctx.moveTo(bl * 0.2, -bw - 2); ctx.lineTo(bl * 0.2, -bw - 5);
  ctx.moveTo(-bl * 0.2, bw + 2); ctx.lineTo(-bl * 0.2, bw + 5);
  ctx.moveTo(bl * 0.2, bw + 2); ctx.lineTo(bl * 0.2, bw + 5);
  ctx.stroke();
  // Skid bars
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-bl * 0.3, -bw - 5); ctx.lineTo(bl * 0.3, -bw - 5);
  ctx.moveTo(-bl * 0.3, bw + 5); ctx.lineTo(bl * 0.3, bw + 5);
  ctx.stroke();

  ctx.restore();

  // Main rotor disc (blur effect)
  const rotAngle = h.bladeAngle % (Math.PI * 2);
  const bladeLen = 34;
  ctx.fillStyle = withAlpha('#888888', 0.06);
  ctx.beginPath();
  ctx.ellipse(cx, cy, bladeLen, bladeLen * VIEW25.deckRatio, 0, 0, Math.PI * 2);
  ctx.fill();
  // Rotor blades
  ctx.strokeStyle = P.gunship.rotor;
  ctx.lineWidth = 2;
  for (let i = 0; i < 2; i++) {
    const a = rotAngle + (i * Math.PI);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * bladeLen, cy + Math.sin(a) * bladeLen * VIEW25.deckRatio);
    ctx.lineTo(cx - Math.cos(a) * bladeLen, cy - Math.sin(a) * bladeLen * VIEW25.deckRatio);
    ctx.stroke();
  }
  // Rotor hub
  ctx.fillStyle = P.gunship.steel;
  ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
}

// ══════════════════════════════════════════════════════════════
//  PROJECTILES
// ══════════════════════════════════════════════════════════════

const projectiles = [];
const explosions = [];

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

const enemies = [];
const floatingTexts = []; // CLEAR! popups and damage numbers

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

const heli = {
  x: 0, y: 0, vx: 0, vy: 0,
  angle: -Math.PI / 2,
  bladeAngle: 0,
  hp: 100, maxHp: 100,
  fireCooldown: 0,
  fireRate: 0.15,
  bulletSpeed: 500,
  bulletDamage: 8,
  weaponRange: 350,
  accel: 1400,
  maxSpeed: 400,
  heatDecayMultiplier: 1,
  targetAssist: 0,
  target: null,
  manualTarget: null,
  targetMode: 'nearest', // nearest, strongest, weakest
  targetCycleIndex: 0,
  score: 0,
  fear: 0, // instilled in the enemy — earned on kills
};

// ══════════════════════════════════════════════════════════════
//  BOSS TIMER + BOSS ENTITY
// ══════════════════════════════════════════════════════════════

const bossState = {
  timeRemaining: TIMER.baseTime,
  active: false,       // true while countdown running
  warning: false,      // true during 5s pre-spawn warning
  warningTimer: 0,
  spawned: false,      // true once boss entity exists
  defeated: false,
  clearedSettlements: 0, // legacy statistic retained for the debrief
};

const boss = {
  x: 0, y: 0, vx: 0, vy: 0,
  angle: 0,
  hp: 0, maxHp: 0,
  speed: 0,
  damage: 0,
  range: 0,
  fireRate: 0,
  fireCooldown: 0,
  state: 'approach',   // approach, attack, retreat, dead
  flashTimer: 0,
  deathTimer: 0,
  spawnAngle: 0,       // angle from which boss enters
  phaseTimer: 0,       // for behavior phase changes
};

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

const FEAR_THRESHOLDS = [10, 25, 50, 85, 130, 190, 270, 370, 500, 660];
const HEAT_LABELS = ['QUIET', 'SUSPICIOUS', 'CONTACT', 'COORDINATED', 'CRITICAL'];

function resetSortieState() {
  const difficulty = getDifficultyProfile(activeContract?.difficultyId);
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
  sortieState.hunter.etaRemaining = TIMER.baseTime * difficulty.hunterEtaMultiplier;
  sortieState.hunter.warning = false;
  sortieState.hunter.warningTimer = 0;
  sortieState.extraction.progress = 0;
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

function isTargetAlive(target) {
  if (!target) return false;
  if (target === boss) return boss.spawned && boss.state !== 'dead';
  if (target.state) return target.state !== 'dead';
  if (target.collected || target.destroyed) return false;
  return target.hp === undefined || target.hp > 0;
}

function damageWorldTarget(target, damage, x, y) {
  if (!isTargetAlive(target) || target.hp === undefined) return false;
  target.hp -= damage;
  target.flashTimer = 0.1;
  spawnExplosion(x, y, 0.3);
  if (target.hp <= 0) {
    target.hp = 0;
    target.destroyed = true;
    spawnExplosion(target.x, target.y, target.objectiveTag === 'command' ? 1.8 : 1.2);
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
    if (!convoy.objectiveTarget || convoy.destroyed) continue;
    if (Math.hypot(convoy.x - projectile.x, convoy.y - projectile.y) < 14) {
      return damageWorldTarget(convoy, projectile.damage, projectile.x, projectile.y);
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
  if (world?.extraction) {
    spawnFloatingText(world.extraction.x, world.extraction.y - 30, 'EXTRACTION ACTIVE', '#44ddff');
  }
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

function updateExtraction(dt) {
  if (!world?.extraction?.active || !sortieState.objectiveComplete || sortieState.status !== 'active') return;
  const dist = Math.hypot(world.extraction.x - heli.x, world.extraction.y - heli.y);
  if (dist < world.extraction.radius) {
    sortieState.extraction.progress += dt;
    world.extraction.progress = sortieState.extraction.progress / world.extraction.holdTime;
    if (sortieState.extraction.progress >= world.extraction.holdTime) finishSortie('complete');
  } else {
    sortieState.extraction.progress = Math.max(0, sortieState.extraction.progress - dt * 2);
    world.extraction.progress = sortieState.extraction.progress / world.extraction.holdTime;
  }
}

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

function hunterClockRate() {
  const difficulty = getDifficultyProfile(activeContract?.difficultyId);
  const style = getStyle(activeContract?.styleId);
  const heatFactor = 0.72 + sortieState.heat.value / 100 * 1.18;
  return heatFactor * difficulty.hunterEtaMultiplier * (style.hunterRateMultiplier || 1);
}

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
    grad.addColorStop(1, '#1a2a1a');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h * 0.3;
    ctx.font = 'bold 36px "Courier New", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000000'; ctx.fillText('GUNSHIP', cx + 2, cy + 2);
    ctx.fillStyle = P.ui.textBright; ctx.fillText('GUNSHIP', cx, cy);
    ctx.font = 'bold 16px "Courier New", monospace';
    ctx.fillStyle = P.ui.infamy; ctx.fillText('FREEDOM PROTOCOL', cx, cy + 40);
    ctx.strokeStyle = P.ui.border; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - 120, cy + 60); ctx.lineTo(cx + 120, cy + 60); ctx.stroke();
    ctx.font = '14px "Courier New", monospace';
    ctx.fillStyle = P.ui.text;
    if (Math.sin(performance.now() / 500) > 0) ctx.fillText('[ CLICK FOR OPERATIONS ]', cx, cy + 100);
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = P.ui.textDim;
    ctx.fillText('A 90s Gulf War Action Movie Helicopter Roguelite', cx, cy + 150);
    ctx.fillText('Inspired by Desert Strike + Vampire Survivors', cx, cy + 170);
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

registerScreen('debrief', {
  draw(ctx, cam) {
    const w = cam.screenW;
    const h = cam.screenH;
    const success = sortieState.status === 'complete';
    drawScreenBackground(ctx, cam, success ? 'SORTIE COMPLETE' : 'PILOT KIA', success ? 'OPERATIONAL REPORT' : 'SIGNAL LOST');
    ctx.save(); ctx.scale(cam.dpr, cam.dpr);
    const panelW = Math.min(420, w - 32);
    const panelH = Math.min(320, h - 120);
    const x = (w - panelW) / 2;
    const y = 84;
    ctx.fillStyle = '#0d210f'; ctx.fillRect(x, y, panelW, panelH);
    ctx.strokeStyle = success ? P.ui.border : '#883333';
    ctx.lineWidth = 1.5; ctx.strokeRect(x, y, panelW, panelH);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = success ? '#aaff88' : '#ff6666';
    ctx.font = 'bold 16px "Courier New", monospace';
    ctx.fillText(success ? 'MISSION SUCCESS' : 'MISSION FAILURE', x + 18, y + 18);
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
    ];
    for (let i = 0; i < rows.length; i++) {
      ctx.fillStyle = i === rows.length - 1 ? '#ffcc44' : P.ui.text;
      ctx.fillText(`${rows[i][0].padEnd(16, ' ')} ${rows[i][1]}`, x + 18, y + 58 + i * 22);
    }
    if (Math.sin(performance.now() / 500) > 0) {
      ctx.fillStyle = P.ui.textBright;
      ctx.textAlign = 'center';
      ctx.font = 'bold 13px "Courier New", monospace';
      ctx.fillText('[ CLICK FOR NEXT BOARD ]', w / 2, y + panelH - 28);
    }
    ctx.restore();
  },
});

function drawScreenBackground(ctx, cam, title, subtitle = '') {
  const dpr = cam.dpr;
  const w = cam.screenW;
  const h = cam.screenH;
  ctx.save(); ctx.scale(dpr, dpr);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#0a120a');
  grad.addColorStop(1, '#1a2a1a');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = P.ui.textBright;
  ctx.font = 'bold 22px "Courier New", monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(title, w / 2, 24);
  if (subtitle) {
    ctx.fillStyle = P.ui.textDim;
    ctx.font = '10px "Courier New", monospace';
    ctx.fillText(subtitle, w / 2, 52);
  }
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
  ctx.strokeStyle = selected ? P.ui.textBright : P.ui.border;
  ctx.lineWidth = selected ? 2 : 1;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillStyle = P.ui.infamy;
  ctx.font = 'bold 14px "Courier New", monospace';
  ctx.fillText(card.name, rect.x + 12, rect.y + 10);
  ctx.fillStyle = P.ui.textBright;
  ctx.font = 'bold 10px "Courier New", monospace';
  ctx.fillText(card.objectiveLabel, rect.x + 12, rect.y + 32);
  ctx.fillStyle = P.ui.text;
  ctx.font = '10px "Courier New", monospace';
  const lines = wrapText(card.description, Math.max(24, Math.floor(rect.w / 7.2)));
  for (let i = 0; i < lines.length && i < 2; i++) {
    ctx.fillText(lines[i], rect.x + 12, rect.y + 50 + i * 13);
  }
  ctx.fillStyle = P.ui.rocket;
  ctx.fillText(`STYLE  ${card.styleName}`, rect.x + 12, rect.y + rect.h - 42);
  ctx.fillStyle = card.difficultyRating >= 3 ? '#ff8844' : P.ui.text;
  ctx.fillText(`RISK    ${'◆'.repeat(card.difficultyRating)}${'◇'.repeat(4 - card.difficultyRating)}  ${card.difficultyName}`, rect.x + 12, rect.y + rect.h - 28);
  ctx.fillStyle = '#ffcc44';
  ctx.fillText(`PAY     $${card.reward}`, rect.x + 12, rect.y + rect.h - 14);
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
  },
  draw(ctx, cam) {
    const w = cam.screenW;
    const h = cam.screenH;
    drawScreenBackground(ctx, cam, 'AVAILABLE OPERATIONS', 'SELECT ONE CONTRACT');
    ctx.save(); ctx.scale(cam.dpr, cam.dpr);
    for (let i = 0; i < contractBoard.length; i++) {
      drawContractCard(ctx, contractBoard[i], contractCardRect(i, w, h));
    }
    ctx.fillStyle = P.ui.textDim;
    ctx.font = '10px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Each operation is generated from its contract and seed.', w / 2, h - 22);
    ctx.restore();
  },
});

registerScreen('briefing', {
  enter(contract) {
    activeContract = contract;
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
    const panelH = Math.min(330, h - 120);
    const x = (w - panelW) / 2;
    const y = 78;
    ctx.fillStyle = '#0d210f'; ctx.fillRect(x, y, panelW, panelH);
    ctx.strokeStyle = P.ui.border; ctx.lineWidth = 1; ctx.strokeRect(x, y, panelW, panelH);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = P.ui.infamy; ctx.font = 'bold 18px "Courier New", monospace';
    ctx.fillText(activeContract?.name || 'NO CONTRACT', x + 18, y + 18);
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
    ctx.fillStyle = P.ui.textDim;
    ctx.fillText('Fear levels you up. Heat accelerates the Hunter.', x + 18, detailY + 100);
    ctx.fillText('Complete the objective, then reach extraction.', x + 18, detailY + 118);
    if (Math.sin(performance.now() / 500) > 0) {
      ctx.fillStyle = P.ui.textBright;
      ctx.textAlign = 'center';
      ctx.font = 'bold 14px "Courier New", monospace';
      ctx.fillText('[ CLICK TO INSERT ]', w / 2, y + panelH - 32);
    }
    ctx.restore();
  },
});

registerScreen('sortie', {
  enter(contract) {
    activeContract = contract || activeContract;
    resetSortieState();
    enemies.length = 0;
    projectiles.length = 0;
    explosions.length = 0;
    floatingTexts.length = 0;
    heli.x = 0; heli.y = 0; heli.vx = 0; heli.vy = 0;
    heli.angle = -Math.PI / 2; heli.hp = 100; heli.maxHp = 100; heli.score = 0; heli.fear = 0;
    heli.bladeAngle = 0;
    heli.targetMode = 'nearest';
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
    try {
      initWorld(activeContract);
    } catch (e) {
      console.error('[Gunship] initWorld failed', e);
      const seed = activeContract?.seed ?? 42;
      world = generateWorld({ seed });
      terrainNoise = createNoise(seed);
      moistureNoise = createNoise(seed + 777);
      detailNoise = createNoise(seed + 333);
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

    // ── Cycle target mode (Shift / touch button / gamepad LB) ──
    if (input.cycleTarget) {
      const modes = ['nearest', 'strongest', 'weakest'];
      heli.targetCycleIndex = (heli.targetCycleIndex + 1) % modes.length;
      heli.targetMode = modes[heli.targetCycleIndex];
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

    // Auto-target cycle — an explicit lock takes priority.
    let bestTarget = null;
    let bestValue = Infinity;
    if (heli.manualTarget && isTargetAlive(heli.manualTarget)) {
      bestTarget = heli.manualTarget;
    } else {
      heli.manualTarget = null;
      // Check Hunter first.
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
      for (const e of enemies) {
        if (e.state === 'dead') continue;
        const dist = Math.hypot(e.x - heli.x, e.y - heli.y);
        if (dist > heli.weaponRange) continue;
        let value = 0;
        if (heli.targetMode === 'nearest') value = dist;
        else if (heli.targetMode === 'strongest') value = -e.hp;
        else if (heli.targetMode === 'weakest') value = e.hp;
        if (value < bestValue) { bestValue = value; bestTarget = e; }
      }
    }
    heli.target = bestTarget;

    // ── Aim angle: toward target if locked, else toward cursor/move ──
    let aimAngle;
    if (heli.target) {
      aimAngle = Math.atan2(heli.target.y - heli.y, heli.target.x - heli.x);
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
    heli.angle += diff * Math.min(1, 3.0 * dt);

    // ── Movement: speed scales with cursor distance ──
    const accel = heli.accel, drag = 0.91, maxSpeed = heli.maxSpeed;
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
    heli.x = clamp(heli.x, -WORLD_SIZE * 0.48, WORLD_SIZE * 0.48);
    heli.y = clamp(heli.y, -WORLD_SIZE * 0.48, WORLD_SIZE * 0.48);

    heli.bladeAngle += 18 * dt;

    // ── Fire (click / Space / autofire toggle) ──
    heli.fireCooldown -= dt;
    const wantsFire = input.fire || (input.autofire && heli.target);
    if (wantsFire && heli.fireCooldown <= 0) {
      if (heli.target) {
        const angle = Math.atan2(heli.target.y - heli.y, heli.target.x - heli.x);
        spawnProjectile(heli.x + Math.cos(angle) * 20, heli.y + Math.sin(angle) * 20, angle, heli.bulletSpeed, heli.bulletDamage);
      } else {
        spawnProjectile(heli.x + Math.cos(heli.angle) * 20, heli.y + Math.sin(heli.angle) * 20, heli.angle, heli.bulletSpeed, heli.bulletDamage);
      }
      addHeat(0.08, 'gunfire reported');
      heli.fireCooldown = heli.fireRate;
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
    for (const e of enemies) {
      if (e.state === 'dead') {
        e.deathTimer -= dt;
        continue;
      }
      const dist = Math.hypot(e.x - heli.x, e.y - heli.y);

      // Unarmed enemies flee from the helicopter
      if (e.className === 'unarmed' && dist < 500) {
        e.state = 'flee';
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
        continue;
      }

      const responseRange = 400 + sortieState.heat.tier * 35;
      const wasAttacking = e.state === 'attack';
      if (dist < responseRange) e.state = 'attack';
      else if (dist < responseRange + 200) e.state = 'alert';
      else e.state = 'idle';

      if (e.state === 'attack' && !wasAttacking) addHeat(1.2, 'hostile contact');

      if (e.state === 'attack') {
        const targetAngle = Math.atan2(heli.y - e.y, heli.x - e.x);
        let adiff = targetAngle - e.angle;
        while (adiff > Math.PI) adiff -= Math.PI * 2;
        while (adiff < -Math.PI) adiff += Math.PI * 2;
        e.angle += adiff * Math.min(1, 2.0 * dt);
        if (e.speed > 0 && dist > e.range * 0.5) {
          e.x += Math.cos(e.angle) * e.speed * dt;
          e.y += Math.sin(e.angle) * e.speed * dt;
        }
        e.fireCooldown -= dt;
        if (e.fireCooldown <= 0 && dist < e.range) {
          const fireAngle = Math.atan2(heli.y - e.y, heli.x - e.x);
          spawnProjectile(e.x, e.y, fireAngle, 200, e.damage, true, e.bulletLife || 1.5);
          e.fireCooldown = e.fireRate;
        }
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

    // ── Hunter ETA ──
    if (bossState.active && !bossState.defeated) {
      bossState.timeRemaining -= dt * hunterClockRate();
      sortieState.hunter.etaRemaining = bossState.timeRemaining;

      // 5-second warning
      if (bossState.timeRemaining <= TIMER.bossWarningTime && !bossState.warning && !bossState.spawned) {
        bossState.warning = true;
        bossState.warningTimer = TIMER.bossWarningTime;
        sortieState.hunter.warning = true;
        sortieState.hunter.warningTimer = TIMER.bossWarningTime;
      }

      // Warning countdown
      if (bossState.warning && !bossState.spawned) {
        bossState.warningTimer -= dt;
        sortieState.hunter.warningTimer = bossState.warningTimer;
        if (bossState.warningTimer <= 0) {
          spawnBoss();
          bossState.warning = false;
          sortieState.hunter.warning = false;
        }
      }

      // Timer expired — spawn immediately if not already spawned
      if (bossState.timeRemaining <= 0 && !bossState.spawned) {
        spawnBoss();
        bossState.warning = false;
        sortieState.hunter.warning = false;
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
          if (dist < 800) convoy.active = true;
          else continue;
        }
        // Move along route
        const target = convoy.route[convoy.routeIndex];
        if (!target) {
          convoy.routeIndex = 0;
          continue;
        }
        const dx = target.x - convoy.x;
        const dy = target.y - convoy.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 20) {
          convoy.routeIndex = (convoy.routeIndex + 1) % convoy.route.length;
        } else {
          convoy.x += (dx / dist) * convoy.speed * dt;
          convoy.y += (dy / dist) * convoy.speed * dt;
        }
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
        // Enemy bullet → hit helicopter
        if (Math.hypot(heli.x - p.x, heli.y - p.y) < 20) {
          heli.hp -= p.damage;
          spawnExplosion(p.x, p.y, 0.2);
          projectiles.splice(i, 1);
          if (heli.hp <= 0) {
            heli.hp = 0;
            spawnExplosion(heli.x, heli.y, 3.0);
            finishSortie('failed');
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
    const speedZoom = lerp(1.1, 0.75, spd / maxSpeed);
    camera.setZoom(heli.target ? Math.max(speedZoom, 0.95) : speedZoom);
  },

  draw(ctx, cam) {
    const dpr = cam.dpr, w = cam.screenW, h = cam.screenH;
    cam.begin(ctx);

    drawSmoothTerrain(ctx, cam);
    drawRoads(ctx, cam);
    drawDecorations(ctx, cam);

    // Draw convoys (before helicopter so they appear underneath)
    if (world) {
      for (const convoy of world.convoys) {
        if (!convoy.active || convoy.destroyed) continue;
        if (!cam.isVisible(convoy.x, convoy.y, 50)) continue;
        ctx.fillStyle = withAlpha('#8a8a5a', 0.8);
        ctx.beginPath();
        ctx.arc(convoy.x, convoy.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#5a5a3a';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (convoy.objectiveTarget) {
          ctx.strokeStyle = '#ff4444';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(convoy.x, convoy.y, 14, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#ff8844';
          ctx.font = 'bold 9px "Courier New", monospace';
          ctx.textAlign = 'center';
          ctx.fillText('CONVOY TARGET', convoy.x, convoy.y - 18);
        }
        if (convoy.route.length > 1) {
          ctx.strokeStyle = withAlpha('#5a5a3a', 0.2);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(convoy.route[0].x, convoy.route[0].y);
          for (let i = 1; i < convoy.route.length; i++) {
            ctx.lineTo(convoy.route[i].x, convoy.route[i].y);
          }
          ctx.stroke();
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

    // HP bar
    const hpBarW = 120, hpBarH = 8, hpX = w / 2 - hpBarW / 2, hpY = 12;
    ctx.fillStyle = P.ui.hpBar; ctx.fillRect(hpX, hpY, hpBarW, hpBarH);
    const hpPct = heli.hp / heli.maxHp;
    ctx.fillStyle = hpPct > 0.5 ? P.ui.hp : hpPct > 0.25 ? P.ui.hpMed : P.ui.hpLow;
    ctx.fillRect(hpX, hpY, hpBarW * hpPct, hpBarH);
    ctx.strokeStyle = P.ui.hpBorder; ctx.lineWidth = 1; ctx.strokeRect(hpX, hpY, hpBarW, hpBarH);
    ctx.fillStyle = P.ui.text; ctx.font = 'bold 11px "Courier New", monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(`HP ${heli.hp}/${heli.maxHp}`, hpX, hpY + hpBarH + 3);

    // Score + Fear progress
    ctx.fillStyle = P.ui.infamy; ctx.fillText(`SCORE ${heli.score}`, w - 160, 12);
    ctx.fillStyle = '#ff8844'; ctx.fillText(`FEAR LV ${sortieState.fearLevel || 0}`, w - 160, 26);
    const fearBarW = 130;
    const fearThreshold = getFearThreshold();
    ctx.fillStyle = '#1a1a0a'; ctx.fillRect(w - 160, 42, fearBarW, 5);
    ctx.fillStyle = '#cc8833'; ctx.fillRect(w - 160, 42, fearBarW * clamp(heli.fear / fearThreshold, 0, 1), 5);
    ctx.strokeStyle = '#5a4a2a'; ctx.lineWidth = 1; ctx.strokeRect(w - 160, 42, fearBarW, 5);

    // Heat / response meter
    const heatX = w - 160;
    const heatY = 56;
    ctx.fillStyle = '#ff8844';
    ctx.fillText(`HEAT ${HEAT_LABELS[sortieState.heat.tier]}`, heatX, heatY);
    ctx.fillStyle = '#1a0f0a'; ctx.fillRect(heatX, heatY + 15, fearBarW, 6);
    ctx.fillStyle = sortieState.heat.tier >= 3 ? '#ff4444' : '#cc6633';
    ctx.fillRect(heatX, heatY + 15, fearBarW * sortieState.heat.value / 100, 6);
    ctx.strokeStyle = '#6a3a2a'; ctx.lineWidth = 1; ctx.strokeRect(heatX, heatY + 15, fearBarW, 6);
    if (sortieState.heat.eventTimer > 0 && sortieState.heat.lastEvent) {
      ctx.fillStyle = '#ffcc88';
      ctx.font = '9px "Courier New", monospace';
      ctx.fillText(sortieState.heat.lastEvent.toUpperCase(), heatX, heatY + 34);
    }

    // ── Boss timer ──
    if (bossState.active && !bossState.defeated) {
      const secs = Math.max(0, Math.ceil(bossState.timeRemaining));
      const mins = Math.floor(secs / 60);
      const rem = secs % 60;
      const timerStr = `${mins}:${rem.toString().padStart(2, '0')}`;
      // Flash red when under 30s
      const urgent = bossState.timeRemaining < 30;
      const flash = urgent && Math.sin(performance.now() / 200) > 0;
      ctx.fillStyle = flash ? '#ff4444' : P.ui.textBright;
      ctx.font = 'bold 14px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`HUNTER ETA: ${timerStr}`, w / 2, 38);
    }

    // ── Boss HP bar (when spawned) ──
    if (boss.spawned && boss.state !== 'dead') {
      const bossBarW = 200, bossBarH = 10;
      const bossBarX = w / 2 - bossBarW / 2;
      const bossBarY = 50;
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(bossBarX, bossBarY, bossBarW, bossBarH);
      const bossHpPct = boss.hp / boss.maxHp;
      ctx.fillStyle = bossHpPct > 0.5 ? '#cc4444' : bossHpPct > 0.25 ? '#ff6644' : '#ff2222';
      ctx.fillRect(bossBarX, bossBarY, bossBarW * bossHpPct, bossBarH);
      ctx.strokeStyle = '#880000';
      ctx.lineWidth = 1;
      ctx.strokeRect(bossBarX, bossBarY, bossBarW, bossBarH);
      ctx.fillStyle = '#ff4444';
      ctx.font = 'bold 9px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('HIND PURSUIT GUNSHIP', w / 2, bossBarY - 3);
    }

    // Target indicator + mode
    if (heli.target) {
      const ts = cam.worldToScreen(heli.target.x, heli.target.y);
      ctx.strokeStyle = P.ui.enemy;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ts.x, ts.y, 16, 0, Math.PI * 2);
      ctx.stroke();
      // Crosshair lines
      ctx.beginPath();
      ctx.moveTo(ts.x - 22, ts.y); ctx.lineTo(ts.x - 9, ts.y);
      ctx.moveTo(ts.x + 9, ts.y); ctx.lineTo(ts.x + 22, ts.y);
      ctx.moveTo(ts.x, ts.y - 22); ctx.lineTo(ts.x, ts.y - 9);
      ctx.moveTo(ts.x, ts.y + 9); ctx.lineTo(ts.x, ts.y + 22);
      ctx.stroke();
      // Center dot
      ctx.fillStyle = P.ui.enemy;
      ctx.beginPath();
      ctx.arc(ts.x, ts.y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = P.ui.enemy;
      ctx.font = '9px "Courier New", monospace';
      ctx.textAlign = 'center';
       ctx.fillText(
         heli.target === boss ? 'HIND PURSUIT GUNSHIP' :
           (heli.target.weaponName || heli.target.className || (heli.target.objectiveTag ? `${heli.target.objectiveTag.toUpperCase()} TARGET` : 'TARGET')),
         ts.x, ts.y - 24,
       );
    }

    // Target mode indicator
    ctx.fillStyle = P.ui.text;
    ctx.font = '10px "Courier New", monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(`TARGET: ${heli.targetMode.toUpperCase()}`, 8, 12);
    ctx.fillStyle = P.ui.textDim;
    ctx.fillText('[SHIFT] cycle', 8, 26);

    // Autofire indicator
    if (input.autofire) {
      ctx.fillStyle = P.ui.rocket;
      ctx.fillText('AUTOFIRE ON', 8, 42);
    }
    if (input.clickToTarget) {
      ctx.fillStyle = P.ui.rocket;
      ctx.fillText('CLICK TO TARGET', 8, input.autofire ? 56 : 42);
    }

    if (world?.objective && !sortieState.objectiveComplete) {
      ctx.fillStyle = P.ui.text;
      ctx.fillText(`OBJECTIVE: ${objectiveHudText()}`, 8, 72);
      if (world.objective.type === 'suppression') {
        ctx.fillStyle = P.ui.textDim;
        ctx.fillText(`PROGRESS: ${world.objective.progress}/${world.objective.requiredCount}`, 8, 86);
      }
    }
    if (sortieState.objectiveComplete) {
      ctx.fillStyle = '#44ddff';
      ctx.fillText('OBJECTIVE COMPLETE - REACH EXTRACTION', 8, 72);
    }

    // Controls hint
    ctx.fillStyle = P.ui.textDim;
    ctx.font = '10px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(
      'Mouse: steer  |  Click: fire  |  Shift: cycle target  |  P: settings',
      w / 2, h - 8
    );

    // ── Boss warning arrow (pointing toward spawn direction) ──
    if (bossState.warning && !bossState.spawned) {
      // Flash red border
      const flash = Math.sin(performance.now() / 150) > 0;
      if (flash) {
        ctx.strokeStyle = '#ff4444';
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, w - 4, h - 4);
      }
      // Warning text
      ctx.fillStyle = '#ff4444';
      ctx.font = 'bold 16px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('! INCOMING HOSTILE !', w / 2, h / 2 - 60);
      ctx.font = '12px "Courier New", monospace';
      ctx.fillText(`ARRIVING IN ${Math.ceil(bossState.warningTimer)}s`, w / 2, h / 2 - 40);
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

  // Title
  ctx.fillStyle = P.ui.textBright;
  ctx.font = 'bold 16px "Courier New", monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('CONTROLS', cx, cy - panelH / 2 + 16);

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

function drawEnemy(ctx, e) {
  const cx = e.x, cy = e.y;
  const isFlashing = e.flashTimer > 0;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(e.angle);

  const s = e.size;
  const bodyColor = isFlashing ? '#ffffff' : e.color;

  if (e.category === 'vehicle') {
    // ── ARMORED VEHICLES — historically based ──
    if (e.className === 'tank') {
      // T-55/T-72 style: low profile, wide tracks, rounded turret
      // Tracks
      ctx.fillStyle = isFlashing ? '#ffffff' : '#3a3a2a';
      ctx.fillRect(-s, -s * 0.85, s * 2, s * 0.25);
      ctx.fillRect(-s, s * 0.6, s * 2, s * 0.25);
      // Track detail
      ctx.strokeStyle = isFlashing ? '#ffffff' : '#2a2a1a';
      ctx.lineWidth = 0.8;
      for (let i = 0; i < 5; i++) {
        const tx = -s + i * (s * 2 / 5);
        ctx.beginPath();
        ctx.moveTo(tx, -s * 0.85); ctx.lineTo(tx, -s * 0.6);
        ctx.moveTo(tx, s * 0.6); ctx.lineTo(tx, s * 0.85);
        ctx.stroke();
      }
      // Hull body
      ctx.fillStyle = bodyColor;
      ctx.fillRect(-s * 0.8, -s * 0.6, s * 1.8, s * 1.2);
      // Sloped front armor
      ctx.fillStyle = isFlashing ? '#ffffff' : (P.enemy.vehicleHi || '#8a7050');
      ctx.beginPath();
      ctx.moveTo(s * 0.8, -s * 0.5);
      ctx.lineTo(s * 1.1, 0);
      ctx.lineTo(s * 0.8, s * 0.5);
      ctx.closePath();
      ctx.fill();
      // Turret (offset forward, rounded)
      ctx.fillStyle = isFlashing ? '#ffffff' : (P.enemy.vehicleDark || '#5a4020');
      ctx.beginPath();
      ctx.arc(s * 0.1, 0, s * 0.4, 0, Math.PI * 2);
      ctx.fill();
      // Gun barrel
      ctx.fillStyle = isFlashing ? '#ffffff' : '#4a4a3a';
      ctx.fillRect(s * 0.4, -s * 0.06, s * 0.9, s * 0.12);
      ctx.strokeStyle = P.enemy.outline;
      ctx.lineWidth = 1;
      ctx.strokeRect(s * 0.4, -s * 0.06, s * 0.9, s * 0.12);
      // muzzle brake
      ctx.fillRect(s * 1.2, -s * 0.09, s * 0.12, s * 0.18);
      // ERA blocks on hull front (reactive armor)
      ctx.fillStyle = isFlashing ? '#ffffff' : '#6a6a4a';
      for (let i = -2; i <= 2; i++) {
        ctx.fillRect(s * 0.6, i * s * 0.18 - s * 0.06, s * 0.15, s * 0.12);
      }
    } else if (e.className === 'apc') {
      // BMP/BRDM style: wheeled or tracked APC
      // Tracks/wheels
      ctx.fillStyle = isFlashing ? '#ffffff' : '#3a3a2a';
      ctx.fillRect(-s * 0.9, -s * 0.7, s * 1.8, s * 0.2);
      ctx.fillRect(-s * 0.9, s * 0.5, s * 1.8, s * 0.2);
      // Hull
      ctx.fillStyle = bodyColor;
      ctx.fillRect(-s * 0.7, -s * 0.5, s * 1.6, s * 1.0);
      // Angled front
      ctx.fillStyle = isFlashing ? '#ffffff' : (P.enemy.vehicleHi || '#8a7050');
      ctx.beginPath();
      ctx.moveTo(s * 0.7, -s * 0.4);
      ctx.lineTo(s * 0.95, 0);
      ctx.lineTo(s * 0.7, s * 0.4);
      ctx.closePath();
      ctx.fill();
      // Small turret
      ctx.fillStyle = isFlashing ? '#ffffff' : (P.enemy.vehicleDark || '#5a4020');
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.25, 0, Math.PI * 2);
      ctx.fill();
      // MG barrel
      ctx.fillStyle = isFlashing ? '#ffffff' : '#4a4a3a';
      ctx.fillRect(s * 0.2, -s * 0.04, s * 0.6, s * 0.08);
    } else if (e.className === 'shilka') {
      // ZSU-23-4 Shilka: 4-barrel AA
      // Tracks
      ctx.fillStyle = isFlashing ? '#ffffff' : '#3a3a2a';
      ctx.fillRect(-s, -s * 0.8, s * 2, s * 0.2);
      ctx.fillRect(-s, s * 0.6, s * 2, s * 0.2);
      // Hull
      ctx.fillStyle = bodyColor;
      ctx.fillRect(-s * 0.8, -s * 0.6, s * 1.8, s * 1.2);
      // Turret (large, boxy)
      ctx.fillStyle = isFlashing ? '#ffffff' : (P.enemy.vehicleDark || '#5a4020');
      ctx.fillRect(-s * 0.3, -s * 0.4, s * 0.8, s * 0.8);
      // 4 gun barrels
      ctx.fillStyle = isFlashing ? '#ffffff' : '#4a4a3a';
      for (let i = -1.5; i <= 1.5; i += 1) {
        ctx.fillRect(s * 0.4, i * s * 0.12 - s * 0.03, s * 0.7, s * 0.06);
      }
      // Radar dish on top
      ctx.fillStyle = isFlashing ? '#ffffff' : '#6a6a5a';
      ctx.beginPath();
      ctx.arc(s * 0.1, -s * 0.5, s * 0.2, 0, Math.PI, true);
      ctx.fill();
    } else if (e.className === 'sam') {
      // SA-6/SA-8 style mobile SAM
      // Tracks
      ctx.fillStyle = isFlashing ? '#ffffff' : '#3a3a2a';
      ctx.fillRect(-s, -s * 0.8, s * 2, s * 0.2);
      ctx.fillRect(-s, s * 0.6, s * 2, s * 0.2);
      // Hull
      ctx.fillStyle = bodyColor;
      ctx.fillRect(-s * 0.8, -s * 0.6, s * 1.8, s * 1.2);
      // Launch rails (3 missiles)
      ctx.fillStyle = isFlashing ? '#ffffff' : (P.enemy.vehicleDark || '#5a4020');
      ctx.fillRect(-s * 0.2, -s * 0.35, s * 0.8, s * 0.7);
      // Missiles
      ctx.fillStyle = isFlashing ? '#ffffff' : '#8a8a6a';
      for (let i = -1; i <= 1; i++) {
        ctx.fillRect(s * 0.3, i * s * 0.2 - s * 0.04, s * 0.6, s * 0.08);
        // Warhead
        ctx.fillStyle = isFlashing ? '#ffffff' : '#cc3333';
        ctx.fillRect(s * 0.85, i * s * 0.2 - s * 0.05, s * 0.12, s * 0.1);
        ctx.fillStyle = isFlashing ? '#ffffff' : '#8a8a6a';
      }
    } else {
      // Generic vehicle fallback
      ctx.fillStyle = bodyColor;
      ctx.fillRect(-s, -s * 0.7, s * 2, s * 1.4);
      ctx.fillStyle = isFlashing ? '#ffffff' : P.enemy.vehicleDark;
      ctx.fillRect(s * 0.5, -s * 0.3, s * 0.8, s * 0.6);
    }
    // Outline on all vehicles
    ctx.strokeStyle = P.enemy.outline;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(-s * 0.8, -s * 0.6, s * 1.8, s * 1.2);
  } else if (e.category === 'emplacement') {
    // ── FIXED EMPLACEMENTS ──
    // Sandbag base
    ctx.fillStyle = isFlashing ? '#ffffff' : '#b0a070';
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = P.enemy.outline;
    ctx.lineWidth = 1;
    ctx.stroke();
    // Gun
    ctx.fillStyle = isFlashing ? '#ffffff' : '#4a4a3a';
    ctx.fillRect(s * 0.2, -s * 0.08, s * 0.8, s * 0.16);
    // Mount
    ctx.fillStyle = isFlashing ? '#ffffff' : '#5a5a4a';
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // ── INFANTRY — simple diamond ──
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(0, -s * 0.6);
    ctx.lineTo(-s * 0.5, 0);
    ctx.lineTo(0, s * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = P.enemy.outline;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.restore();

  // HP bar (only if damaged)
  if (e.hp < e.maxHp && e.state !== 'dead') {
    const barW = s * 3;
    const barH = 3;
    const barX = cx - barW / 2;
    const barY = cy - s - 8;
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = P.ui.hpLow;
    ctx.fillRect(barX, barY, barW * (e.hp / e.maxHp), barH);
  }
}

function drawBoss(ctx) {
  if (!boss.spawned || boss.state === 'dead') return;
  const cx = boss.x, cy = boss.y;
  const s = boss.size;
  const isFlashing = boss.flashTimer > 0;
  const body = isFlashing ? '#ffffff' : '#6a6a5a';
  const dark = isFlashing ? '#ffffff' : '#4a4a3a';
  const accent = isFlashing ? '#ffffff' : '#8a5a3a';

  // Shadow
  ctx.fillStyle = withAlpha('#000000', 0.35);
  ctx.beginPath();
  ctx.ellipse(cx + 4, cy + 8, s * 1.1, s * 0.4, boss.angle, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(boss.angle);

  // Main rotor arc (subtle, spinning)
  const rotorPhase = (performance.now() / 80) % (Math.PI * 2);
  ctx.strokeStyle = withAlpha(dark, 0.5);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 1.8, s * 0.12, rotorPhase, 0, Math.PI * 2);
  ctx.stroke();

  // Tail boom
  ctx.fillStyle = dark;
  ctx.fillRect(-s * 1.6, -s * 0.08, s * 0.8, s * 0.16);

  // Tail fin
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(-s * 1.6, -s * 0.25);
  ctx.lineTo(-s * 1.9, 0);
  ctx.lineTo(-s * 1.6, s * 0.25);
  ctx.closePath();
  ctx.fill();

  // Fuselage (elongated oval)
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 1.0, s * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = P.enemy.outline;
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // Cockpit canopy (forward bubble)
  ctx.fillStyle = isFlashing ? '#ffffff' : '#3a5a4a';
  ctx.beginPath();
  ctx.ellipse(s * 0.65, -s * 0.05, s * 0.3, s * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = P.enemy.outline;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Stub wings (small, angled back)
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(s * 0.1, -s * 0.38);
  ctx.lineTo(s * 0.5, -s * 0.65);
  ctx.lineTo(s * 0.6, -s * 0.55);
  ctx.lineTo(s * 0.3, -s * 0.32);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(s * 0.1, s * 0.38);
  ctx.lineTo(s * 0.5, s * 0.65);
  ctx.lineTo(s * 0.6, s * 0.55);
  ctx.lineTo(s * 0.3, s * 0.32);
  ctx.closePath();
  ctx.fill();

  // Hardpoints / rocket pods under wings
  ctx.fillStyle = accent;
  ctx.fillRect(s * 0.3, -s * 0.58, s * 0.25, s * 0.1);
  ctx.fillRect(s * 0.3, s * 0.48, s * 0.25, s * 0.1);

  // Fuselage outline
  ctx.strokeStyle = P.enemy.outline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 1.0, s * 0.4, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();

  // Nose gun turret (tracks independently)
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(boss.turretAngle);
  ctx.fillStyle = dark;
  ctx.fillRect(s * 0.3, -s * 0.06, s * 0.6, s * 0.12);
  ctx.strokeStyle = P.enemy.outline;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(s * 0.3, -s * 0.06, s * 0.6, s * 0.12);
  ctx.restore();

  // HP bar above
  const barW = s * 3;
  const barH = 5;
  const barX = cx - barW / 2;
  const barY = cy - s - 16;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(barX, barY, barW, barH);
  const hpPct = boss.hp / boss.maxHp;
  ctx.fillStyle = hpPct > 0.5 ? '#cc4444' : hpPct > 0.25 ? '#ff6644' : '#ff2222';
  ctx.fillRect(barX, barY, barW * hpPct, barH);
  ctx.strokeStyle = '#880000';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, barY, barW, barH);
  ctx.fillStyle = '#ff4444';
  ctx.font = 'bold 9px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('HIND PURSUIT GUNSHIP', cx, barY - 4);
}

function drawHunter(ctx) { drawBoss(ctx); }

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

  if (currentScreen === screens.title) {
    switchScreen('contracts');
  } else if (currentScreen === screens.contracts) {
    for (let i = 0; i < contractBoard.length; i++) {
      const r = contractCardRect(i, w / cam.dpr, h / cam.dpr);
      const scaled = { x: r.x * cam.dpr, y: r.y * cam.dpr, w: r.w * cam.dpr, h: r.h * cam.dpr };
      if (pointInRect(pos.x, pos.y, scaled)) {
        switchScreen('briefing', contractBoard[i]);
        break;
      }
    }
  } else if (currentScreen === screens.briefing) {
    switchScreen('sortie', activeContract);
  } else if (currentScreen === screens.debrief) {
    switchScreen('contracts');
  }
});

canvas.addEventListener('touchstart', (e) => {
  const touch = e.touches[0];
  canvas.dispatchEvent(new MouseEvent('click', {
    clientX: touch.clientX,
    clientY: touch.clientY,
  }));
});

switchScreen('title');
console.log('[Gunship] starting loop');
requestAnimationFrame(loop);
