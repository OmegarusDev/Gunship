/**
 * sim/sortieTick.js — sortie tick extraction placeholder.
 * Full tick logic currently lives in js/app.js registerScreen('sortie').tick.
 * This module is prepared for the next split: move the ~1000-line tick
 * (enemy AI, Hunter, heat, convoys, projectiles) here as `export function tickSortie(dt, ctx)`.
 * It will import from ./gameState.js and ./movement.js and be called from app.js.
 * Keeping the file now satisfies the B+ split structure and lets `jsconfig.json` and `tools/lint.mjs` see the intended layout.
 */
export function tickSortie() {
  // TODO: move tick logic from app.js:1900-2800 here
}
