// Combined verification gate for the Gunship build.
// Runs every headless test suite and fails if any of them fail.
// Usage: node tools/check.mjs
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const suites = ['meta-check.mjs', 'sortie-smoke.mjs'];

let failed = false;
for (const s of suites) {
  console.log(`\n=== ${s} ===`);
  const r = spawnSync(process.execPath, [join(here, s)], { stdio: 'inherit' });
  if (r.status !== 0) failed = true;
}

if (failed) {
  console.error('\nVERIFICATION GATE FAILED');
  process.exit(1);
}
console.log('\nVERIFICATION GATE PASSED');
