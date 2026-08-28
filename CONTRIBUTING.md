# Contributing to Gunship

This repo is intentionally small, vanilla, and headless-testable. Please keep it that way.

## Quick start

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Headless gate (must pass before push):

```bash
node tools/check.mjs
# runs: lint (node --check + invariants) → meta-check (career/skill) → sortie-smoke (world + extraction)
```

With dev deps:

```bash
npm install
npm run lint        # eslint + node --check
npm run format      # prettier
npm run check       # same as node tools/check.mjs
```

A `pre-commit` hook (`.githooks/pre-commit`, enabled via `core.hooksPath`) runs the gate automatically.

## Code layout

- `js/app.js` — thin bootstrap: loop, screen router, input wiring. Delegates to `js/sim/*` and `js/render/*`.
- `js/sim/state.js` — `FEAR_THRESHOLDS`, `HEAT_LABELS`, `hunterClockRate`, factories
- `js/sim/movement.js` — road-aware steering, convoy arc-length
- `js/sim/objectives.js` — `isTargetAlive`/`objectiveComplete`/`canExtract`
- `js/sim/gameState.js` — shared mutable `world`/`heli`/`boss`/`sortieState`
- `js/render/terrain.js` — GPU terrain grid + overlays (owns `setTerrain`)
- `js/render/roads.js` — road overdraw + minimap cache
- `js/render/hud.js` — `hudPlate`/`hudBar`/`drawOffscreenMarker`
- `js/render/world.js` — `drawSites`/`drawDecorations`/`drawScenarioOverlays` (via `setWorldState`)
- `js/render/entities.js` — `drawGunship`/`drawEnemy`/`drawBoss`
- `js/terrain.js` — SSOT desert model (dip → wadis → oases)
- `js/world.js` — roads (A* MST), sites, convoys
- `js/contracts.js` — `SCENARIO×STYLE×DIFFICULTY`
- `js/meta.js` — career/skill/hangar (pure, node-testable)

## Conventions

- **Zero runtime deps.** Keep it that way. Dev deps (`eslint`, `prettier`, `puppeteer`) are ok.
- **Determinism:** all world-gen through `mulberry32` seeded from contract `seed`. Don't use `Math.random` for world content.
- **No DOM in sim.** `js/sim/*` and `js/meta.js` must stay `document`-free so `tools/*` can run headless.
- **Shared state:** mutate via `GameState` setters (`setWorld`, `setActiveContract`, etc.) or via the imported object (`heli.x = ...` is fine because `heli` is the same object). Don't duplicate `let world` in a new file — import it.
- **Rendering:** `js/render/*` owns its caches (`_grainPattern`, `tgCanvas`, `roadCache`). Call `setTerrain`/`setWorldState`/`setBoss` before drawing.

## Adding a feature

1. Add data in `js/world.js` or `js/contracts.js` if possible (data-driven). New entity class = new entry in `ENEMY_CLASSES` + `data/enemies.js` loadout, not a new class.
2. If you need a new sim concept, put it in `js/sim/` with a pure function and add a headless check in `tools/sortie-smoke.mjs` or `tools/meta-check.mjs`.
3. If you touch `js/app.js`, keep the wrappers thin — move logic to `js/sim/` or `js/render/`.

## Design doc

`GAME_DESIGN.md` §4.1 has the Shipped vs GDD tree. §11.2 and §12.3 are annotated with the live `Hunter ETA` and `Fear/Heat` formulas. Update the doc when you change the shipped behavior — code is truth, doc must follow.

## PRs

CI runs `node tools/check.mjs` on `main`/`dev` and PRs. `deploy-pages.yml` also runs the gate before deploying. Keep `puppeteer` for headless click regressions if you touch screens.
