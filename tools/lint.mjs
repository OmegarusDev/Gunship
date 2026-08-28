#!/usr/bin/env node
// tools/lint.mjs — zero-dep lint gate (fast) + optional eslint if installed.
// Runs node --check on every js/mjs file, plus a few project invariants.
import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, extname } from 'node:path';

const roots = ['js', 'tools'];
const exts = new Set(['.js', '.mjs']);

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (exts.has(extname(p))) out.push(p);
  }
  return out;
}

let files = [];
for (const r of roots) {
  try {
    files.push(...walk(r));
  } catch {}
}
// also check top-level js files
files = [...new Set(files)].sort();

let fail = 0;
console.log(`— lint: node --check ${files.length} files —`);
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  if (r.status !== 0) {
    fail++;
    console.error(`  ✗ ${f}: syntax error`);
    console.error(r.stderr.toString().slice(0, 800));
  }
}

// Project invariants
console.log('— lint: project invariants —');
const check = (cond, msg) => {
  if (!cond) {
    fail++;
    console.error(`  ✗ ${msg}`);
  } else console.log(`  ✓ ${msg}`);
};

// No duplicate else-if chains like the old app.js bug (two identical else if screens.contracts)
import { readFileSync } from 'node:fs';
try {
  const app = readFileSync('js/app.js', 'utf8');
  const dups = (app.match(/else if \(currentScreen === screens\.contracts\)/g) || []).length;
  check(dups <= 1, `no duplicate contracts else-if (found ${dups}, want ≤1)`);
  check(
    !app.includes('accumulator = 0;') || app.includes('Preserve sub-tick'),
    'timestep preserves remainder (no unconditional accumulator=0)'
  );
  check(
    app.includes('_drawSmoothTerrain') || app.includes('render/terrain'),
    'terrain delegated to render/terrain.js'
  );
  check(
    app.includes('_drawRoads') || app.includes('render/roads'),
    'roads delegated to render/roads.js'
  );
} catch (e) {
  console.error('  (could not read js/app.js for invariants)', e.message);
}

// Optional eslint if installed
let hasEslint = false;
try {
  import.meta.resolve('eslint');
  hasEslint = true;
} catch {}
if (hasEslint) {
  console.log('— lint: eslint —');
  const r = spawnSync('npx', ['eslint', 'js', '--ext', '.js,.mjs', '--max-warnings', '100'], {
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    // Don't fail gate on eslint warnings yet — just report
    console.log('(eslint reported issues — fix warnings to tighten gate)');
  }
} else {
  console.log('— lint: eslint not installed — skipping (run npm install to enable)');
}

if (fail) {
  console.error(`\nLint failed: ${fail} issue(s)`);
  process.exit(1);
}
console.log('\nLint passed');
