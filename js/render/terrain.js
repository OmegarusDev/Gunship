/**
 * render/terrain.js — smooth terrain sampling + GPU-blitted grid + overlays.
 * Extracted from app.js. Module owns its caches (tgCanvas, grain/mottle/macro).
 * Call setTerrain(...) after world generation so sampling sees the current model.
 */
import { mulberry32 } from '../rng.js';
import { clamp, lerp } from '../rng.js';
import { fbm, ridged, duneNoise, windStreaks, voronoi } from '../noise.js';

// ── Module-local refs set by the app after initWorld ──
let _sharedTerrain = null;
let _terrainNoise = null;
let _moistureNoise = null;
let _detailNoise = null;

export function setTerrain(sharedTerrain, terrainNoise, moistureNoise, detailNoise) {
  _sharedTerrain = sharedTerrain;
  _terrainNoise = terrainNoise;
  _moistureNoise = moistureNoise;
  _detailNoise = detailNoise;
}

export const BIOME = {
  sand: { r: 210, g: 180, b: 130 },
  hardpack: { r: 185, g: 155, b: 110 },
  rock: { r: 130, g: 115, b: 90 },
  dunes: { r: 225, g: 200, b: 145 },
  gravel: { r: 155, g: 140, b: 105 },
  wetSand: { r: 165, g: 140, b: 100 },
  brightSand: { r: 235, g: 215, b: 160 },
  oasisGreen: { r: 84, g: 128, b: 74 },
};

function sampleTerrain(wx, wy) {
  const detail = 0.005;
  const windAngle = 0.6;
  let r, g, b;
  if (_sharedTerrain) {
    const ce = _sharedTerrain.typeAndElevation(wx, wy);
    const ty = ce.type;
    const e = ce.elevation;
    const shade = clamp(e / 1600, -0.5, 0.5) * 26;
    switch (ty) {
      case 'wadi': {
        const t = clamp((e + 120) / 240, 0, 1);
        r = lerp(BIOME.wetSand.r, BIOME.gravel.r, 1 - t * 0.6) - 8 + shade * 0.4;
        g = lerp(BIOME.wetSand.g, BIOME.gravel.g, 1 - t * 0.6) - 8 + shade * 0.4;
        b = lerp(BIOME.wetSand.b, BIOME.gravel.b, 1 - t * 0.6) - 6 + shade * 0.4;
        break;
      }
      case 'oasis': {
        r = BIOME.oasisGreen.r;
        g = BIOME.oasisGreen.g;
        b = BIOME.oasisGreen.b;
        break;
      }
      case 'hardpack': {
        r = BIOME.hardpack.r + shade * 0.5;
        g = BIOME.hardpack.g + shade * 0.5;
        b = BIOME.hardpack.b + shade * 0.5;
        break;
      }
      case 'gravel': {
        r = BIOME.gravel.r + shade * 0.6;
        g = BIOME.gravel.g + shade * 0.6;
        b = BIOME.gravel.b + shade * 0.6;
        break;
      }
      case 'dunes': {
        const dn = duneNoise(_terrainNoise, wx * 0.0005, wy * 0.0005, windAngle, 1.0);
        const crest = Math.max(0, dn - 0.35) * 2.2;
        r = lerp(BIOME.dunes.r, BIOME.brightSand.r, crest) + shade * 0.3;
        g = lerp(BIOME.dunes.g, BIOME.brightSand.g, crest) + shade * 0.3;
        b = lerp(BIOME.dunes.b, BIOME.brightSand.b, crest) + shade * 0.3;
        if (dn < -0.15) {
          const sh = -dn * 40;
          r -= sh;
          g -= sh;
          b -= sh;
        }
        break;
      }
      case 'rock': {
        const rocky = voronoi(_terrainNoise, wx, wy, 0.008);
        const edge = clamp(rocky * 4, 0, 1);
        r = lerp(BIOME.rock.r, BIOME.rock.r * 0.78, edge) + shade;
        g = lerp(BIOME.rock.g, BIOME.rock.g * 0.78, edge) + shade;
        b = lerp(BIOME.rock.b, BIOME.rock.b * 0.78, edge) + shade;
        break;
      }
      default: {
        const moist = fbm(_moistureNoise, wx * 0.0007, wy * 0.0007, 3, 2.0, 0.5);
        const m = clamp((moist + 1) / 2, 0, 1);
        r = lerp(BIOME.sand.r, BIOME.hardpack.r, m * 0.7) + shade * 0.4;
        g = lerp(BIOME.sand.g, BIOME.hardpack.g, m * 0.7) + shade * 0.4;
        b = lerp(BIOME.sand.b, BIOME.hardpack.b, m * 0.7) + shade * 0.4;
      }
    }
  } else {
    r = BIOME.sand.r;
    g = BIOME.sand.g;
    b = BIOME.sand.b;
  }
  const streaks = windStreaks(_detailNoise, wx, wy, windAngle, 0.015);
  const streakEffect = streaks * 14;
  r += streakEffect;
  g += streakEffect * 0.8;
  b += streakEffect * 0.5;
  const grain = fbm(_detailNoise, wx * detail, wy * detail, 3, 2.2, 0.45);
  const grainVar = grain * 9;
  r += grainVar;
  g += grainVar;
  b += grainVar;
  return {
    r: Math.max(0, Math.min(255, Math.round(r))),
    g: Math.max(0, Math.min(255, Math.round(g))),
    b: Math.max(0, Math.min(255, Math.round(b))),
  };
}

const TERRAIN_GRID_STEP = 72;
let tgX0 = 0,
  tgY0 = 0,
  tgCols = 0,
  tgRows = 0;
let tgCanvas = null,
  tgCtx = null;

function updateTerrainGrid(cam) {
  const b = cam.getVisibleBounds();
  const x0 = Math.floor(b.left / TERRAIN_GRID_STEP) * TERRAIN_GRID_STEP;
  const y0 = Math.floor(b.top / TERRAIN_GRID_STEP) * TERRAIN_GRID_STEP;
  const cols = Math.ceil((b.right - x0) / TERRAIN_GRID_STEP) + 2;
  const rows = Math.ceil((b.bottom - y0) / TERRAIN_GRID_STEP) + 2;
  if (!tgCanvas || cols !== tgCols || rows !== tgRows || x0 !== tgX0 || y0 !== tgY0) {
    tgX0 = x0;
    tgY0 = y0;
    tgCols = cols;
    tgRows = rows;
    if (!tgCanvas) {
      tgCanvas = document.createElement('canvas');
      tgCtx = tgCanvas.getContext('2d');
    }
    if (tgCanvas.width !== cols || tgCanvas.height !== rows) {
      tgCanvas.width = cols;
      tgCanvas.height = rows;
    }
    const img = tgCtx.createImageData(cols, rows);
    const d = img.data;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const col = sampleTerrain(x0 + c * TERRAIN_GRID_STEP, y0 + r * TERRAIN_GRID_STEP);
        const i = (r * cols + c) * 4;
        d[i] = col.r;
        d[i + 1] = col.g;
        d[i + 2] = col.b;
        d[i + 3] = 255;
      }
    tgCtx.putImageData(img, 0, 0);
  }
}

function drawTileWrapped(g, S, fn) {
  for (let ox = -1; ox <= 1; ox++)
    for (let oy = -1; oy <= 1; oy++) {
      g.save();
      g.translate(ox * S, oy * S);
      fn();
      g.restore();
    }
}

let _grainPattern = null;
function getGrainPattern(ctx) {
  if (_grainPattern) return _grainPattern;
  const rng = mulberry32(0x5eed1234);
  const S = 192;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  for (let i = 0; i < 1400; i++) {
    const x = rng() * S,
      y = rng() * S;
    const light = rng() > 0.5;
    const style = light
      ? `rgba(255,244,214,${(0.04 + rng() * 0.06).toFixed(3)})`
      : `rgba(30,22,10,${(0.05 + rng() * 0.07).toFixed(3)})`;
    const w = 1 + (rng() > 0.9 ? 1 : 0);
    drawTileWrapped(g, S, () => {
      g.fillStyle = style;
      g.fillRect(x, y, w, 1);
    });
  }
  g.lineWidth = 1;
  for (let i = 0; i < 16; i++) {
    const x = rng() * S,
      y = rng() * S,
      l = 6 + rng() * 16,
      a = 0.55 + (rng() - 0.5) * 0.2;
    drawTileWrapped(g, S, () => {
      g.strokeStyle = 'rgba(40,30,15,0.05)';
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    });
  }
  _grainPattern = ctx.createPattern(c, 'repeat');
  return _grainPattern;
}

let _mottlePattern = null;
function getMottlePattern(ctx) {
  if (_mottlePattern) return _mottlePattern;
  const rng = mulberry32(0xb10b8807);
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  for (let i = 0; i < 34; i++) {
    const x = rng() * S,
      y = rng() * S,
      r = 40 + rng() * 110;
    const light = rng() > 0.5;
    const a = 0.03 + rng() * 0.045;
    const c0 = light ? `rgba(255,236,190,${a})` : `rgba(60,45,25,${a})`;
    drawTileWrapped(g, S, () => {
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, c0);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
  _mottlePattern = ctx.createPattern(c, 'repeat');
  return _mottlePattern;
}

let _macroPattern = null;
function getMacroPattern(ctx) {
  if (_macroPattern) return _macroPattern;
  const rng = mulberry32(0x4d414352);
  const S = 1536;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  for (let i = 0; i < 22; i++) {
    const x = rng() * S,
      y = rng() * S,
      r = 220 + rng() * 420;
    const light = rng() > 0.5;
    const a = 0.02 + rng() * 0.03;
    const c0 = light ? `rgba(255,238,196,${a})` : `rgba(55,42,24,${a})`;
    drawTileWrapped(g, S, () => {
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, c0);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
  _macroPattern = ctx.createPattern(c, 'repeat');
  return _macroPattern;
}

export function drawSmoothTerrain(ctx, cam) {
  updateTerrainGrid(cam);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tgCanvas, tgX0, tgY0, tgCols * TERRAIN_GRID_STEP, tgRows * TERRAIN_GRID_STEP);
  const b = cam.getVisibleBounds();
  const bw = b.right - b.left,
    bh = b.bottom - b.top;
  ctx.fillStyle = getMacroPattern(ctx);
  ctx.fillRect(b.left, b.top, bw, bh);
  ctx.fillStyle = getMottlePattern(ctx);
  ctx.fillRect(b.left, b.top, bw, bh);
  ctx.fillStyle = getGrainPattern(ctx);
  ctx.fillRect(b.left, b.top, bw, bh);
}

export { sampleTerrain };
