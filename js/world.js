/**
 * Public world API.
 *
 * Geometry-First Gulf Worldgen V4 is the only generator. Region, transport,
 * place, encounter and contract assembly live in focused modules under
 * js/world/; this facade stays small for browser and headless consumers.
 */
import { clamp } from './rng.js';
import { generateWorldV4 } from './world/generateV4.js';

export const SURFACE = {
  paved: { speedMod: 1.3, label: 'Paved' },
  dirt: { speedMod: 1.0, label: 'Dirt' },
  track: { speedMod: 0.8, label: 'Track' },
  gravel: { speedMod: 0.9, label: 'Gravel' },
  compacted: { speedMod: 1.05, label: 'Compacted' },
  sand: { speedMod: 1.0, label: 'Sand' },
  dunes: { speedMod: 0.6, label: 'Dunes' },
  rock: { speedMod: 0.8, label: 'Rock' },
};

/** Roads take priority over off-road surface speed. */
export function getSpeedMod(x, y, roads = []) {
  for (const road of roads) {
    for (let i = 0; i < road.points.length - 1; i++) {
      const a = road.points[i];
      const b = road.points[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSq = dx * dx + dy * dy || 1;
      const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / lengthSq, 0, 1);
      const distance = Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
      if (distance <= road.width * 0.5) {
        return (SURFACE[road.surface] || SURFACE.dirt).speedMod;
      }
    }
  }
  return SURFACE.sand.speedMod;
}

export function generateWorld(input) {
  return generateWorldV4(input);
}
