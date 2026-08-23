/** Deterministic PRNG (mulberry32). Ported from Tower Defence project. */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Create a seeded RNG from a string key. */
export function seededRng(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(31, h) + key.charCodeAt(i) | 0;
  }
  return mulberry32(h);
}

/** Shuffle array in place (Fisher-Yates) using provided RNG. */
export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Random integer in [min, max] inclusive. */
export function randInt(min, max, rng = Math.random) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/** Random float in [min, max). */
export function randFloat(min, max, rng = Math.random) {
  return rng() * (max - min) + min;
}

/** Pick random element from array. */
export function pick(arr, rng = Math.random) {
  return arr[Math.floor(rng() * arr.length)];
}

/** Weighted random pick. weights is array of numbers. */
export function weightedPick(items, weights, rng = Math.random) {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** Weighted random sample of n unique items. */
export function weightedSample(items, weights, n, rng = Math.random) {
  const pool = items.map((item, i) => ({ item, weight: weights[i] }));
  const result = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const total = pool.reduce((s, p) => s + p.weight, 0);
    let r = rng() * total;
    let idx = 0;
    for (let j = 0; j < pool.length; j++) {
      r -= pool[j].weight;
      if (r <= 0) { idx = j; break; }
    }
    result.push(pool[idx].item);
    pool.splice(idx, 1);
  }
  return result;
}

/** Linear interpolation. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Angle interpolation (handles wrap-around). */
export function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

/** Clamp value between min and max. */
export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
