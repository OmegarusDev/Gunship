/**
 * Simple 2D value noise with octave layering.
 * Produces smooth, continuous terrain without grid artifacts.
 */

import { mulberry32 } from './rng.js';

// Permutation table from seed
function buildPerm(seed) {
  const rng = mulberry32(seed);
  const p = new Uint8Array(512);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 256; i++) p[i + 256] = p[i];
  return p;
}

// Smoothstep: 6t^5 - 15t^4 + 10t^3
function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// 2D gradient hash
function grad(hash, x, y) {
  const h = hash & 3;
  return ((h & 1) === 0 ? x : -x) + ((h & 2) === 0 ? y : -y);
}

/**
 * Create a noise function from a seed.
 * Returns noise2D(x, y) -> [-1, 1]
 */
export function createNoise(seed = 42) {
  const perm = buildPerm(seed);

  function noise2D(x, y) {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);

    const aa = perm[perm[xi] + yi];
    const ab = perm[perm[xi] + yi + 1];
    const ba = perm[perm[xi + 1] + yi];
    const bb = perm[perm[xi + 1] + yi + 1];

    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
  }

  return noise2D;
}

/**
 * Fractal Brownian Motion — layer multiple octaves of noise.
 * Returns value in roughly [-1, 1].
 */
export function fbm(noise, x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    value += noise(x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return value / maxValue;
}

/**
 * Ridged multifractal — creates sharp ridges (good for dunes, mountains).
 */
export function ridged(noise, x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    let n = noise(x * frequency, y * frequency);
    n = 1 - Math.abs(n); // fold
    n = n * n; // sharpen ridges
    value += n * amplitude;
    maxValue += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return value / maxValue;
}

/**
 * Domain warping — distort coordinates with another noise layer.
 * Makes terrain features twist organically.
 */
export function warp(noise, x, y, strength = 1.0) {
  const wx = noise(x + 5.2, y + 1.3) * strength;
  const wy = noise(x + 9.7, y + 2.8) * strength;
  return { x: x + wx, y: y + wy };
}

/**
 * Sine-warped ridged noise — creates crescent/barchan dune shapes.
 * The sine wave distorts the ridged noise into curved dune crests.
 */
export function duneNoise(noise, x, y, windAngle = 0.6, scale = 1.0) {
  // Warp coordinates along wind direction
  const wx = x + Math.sin(y * 0.8 + windAngle) * 0.3;
  const wy = y + Math.cos(x * 0.6 + windAngle) * 0.2;
  // Ridged noise for sharp crests
  let n = ridged(noise, wx * scale, wy * scale, 3, 2.0, 0.5);
  // Sine distortion for crescent shape
  n += Math.sin(wx * 2.0 + wy * 1.5) * 0.15;
  return Math.max(-1, Math.min(1, n));
}

/**
 * Wind streak texture — long parallel lines aligned with prevailing wind.
 */
export function windStreaks(noise, x, y, angle = 0.6, freq = 0.02) {
  // Rotate coordinates to wind alignment
  const rx = x * Math.cos(angle) + y * Math.sin(angle);
  const ry = -x * Math.sin(angle) + y * Math.cos(angle);
  // Streaks are high-frequency along wind, low-frequency across
  const streak = noise(rx * freq * 8, ry * freq * 0.5);
  const variation = noise(rx * freq * 0.3, ry * freq * 0.3) * 0.3;
  return streak * 0.4 + variation;
}

/**
 * Voronoi cell noise — creates cracked/mud patterns or rocky outcrops.
 */
export function voronoi(noise, x, y, scale = 0.01) {
  const ix = Math.floor(x * scale);
  const iy = Math.floor(y * scale);
  let minDist = 999;
  let secondDist = 999;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const cx = ix + dx;
      const cy = iy + dy;
      // Hash to get random point in cell
      const h = Math.abs(noise(cx * 12.9898 + 78.233, cy * 12.9898 + 78.233));
      const px = cx + (h - 0.5);
      const py = cy + (h * 0.7 + 0.15);
      const dist = Math.hypot(x * scale - px, y * scale - py);
      if (dist < minDist) {
        secondDist = minDist;
        minDist = dist;
      } else if (dist < secondDist) {
        secondDist = dist;
      }
    }
  }
  // Edge detection: close to cell boundary = rocky
  return secondDist - minDist;
}
