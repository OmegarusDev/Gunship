/**
 * roadCentric.js — WORLD_GEN_VERSION 3: villages ARE roads+buildings
 * Roads exist to connect buildings across the landscape.
 * A "village" is 2-6 buildings clustered along a dirt spine.
 * A military base is a grid + wall, buildings are large and rectangular.
 * See docs/STREETS_SPEC.md for full spec.
 */

import { mulberry32, randInt, randFloat, pick, clamp, weightedPick } from '../rng.js';
import { ARCHETYPES, ENEMY_CLASSES } from '../world.js';

// This will be filled in when we move the full implementation
// For now, this is a placeholder that will be implemented in the next commit
// The actual implementation will be in js/world.js dispatch

export function generateRoadCentricWorld() {
  // TODO: implement road-centric generation
  return null;
}
