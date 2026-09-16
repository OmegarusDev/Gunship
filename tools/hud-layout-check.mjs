/**
 * Headless overlap / bounds checks for portrait and landscape sortie HUD.
 */
import assert from 'node:assert/strict';
import { layoutSortieHud, hudLayoutIssues } from '../js/ui/hudLayout.js';

const sizes = [
  [390, 844],
  [430, 932],
  [495, 970],
  [844, 390],
  [932, 430],
  [768, 1024],
  [1024, 768],
  [1280, 720],
  [360, 640],
  [667, 375],
];

let n = 0;
for (const [w, h] of sizes) {
  for (const flags of [{}, { showBossHp: true, showToast: true }]) {
    const layout = layoutSortieHud(w, h, flags);
    const issues = hudLayoutIssues(layout);
    assert.deepEqual(issues, [], `${w}x${h} ${JSON.stringify(flags)}: ${issues.join('; ')}`);
    n += 1;
  }
}

console.log(`hud-layout-check: ${n} layouts passed`);
