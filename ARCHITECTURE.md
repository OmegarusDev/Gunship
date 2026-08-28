# Architecture — Gunship

This document is the map for rebuilding and extending the game. Code is truth; this doc points to it.

## Stack

- **Static site, zero runtime deps.** ES modules, `index.html` → `js/app.js` → `js/sim/*` + `js/render/*`. No bundler required (but `npm run dev` works).
- **Node 20+** for tooling (`eslint`, `prettier`, `puppeteer` for headless click regression). No build step for the game itself.

## Rebuild from scratch

```bash
git clone https://github.com/OmegarusDev/Gunship.git && cd Gunship
npm ci                  # or npm install (installs eslint/prettier/puppeteer dev deps)
node tools/check.mjs    # gate: lint (node --check 33 files) → 82 meta → 99 sortie
python3 -m http.server 8000
# open http://localhost:8000 — title → OPERATIONS → contract → briefing → SORTIE → debrief
```

Deploy is GitHub Pages on push to `main` (`.github/workflows/deploy-pages.yml` runs `setup-node → npm ci → gate → upload-pages-artifact → deploy-pages`). `ci.yml` runs the same gate on `main`/`dev` and PRs. `core.hooksPath` is `.githooks` (`pre-commit` runs the gate).

## Layout (shipped)

```
index.html
css/main.css
js/
  app.js               # thin bootstrap: loop (fixed timestep), screen router, input/Camera wiring, delegates to sim/render
  config.js            # tunables (SIM_HZ, WORLD_SIZE, CAMERA, COMBAT, HUD, TIMER live/legacy, INFAMY deprecated, PILOT_XP)
  rng.js               # mulberry32, seededRng, shuffle, randInt, pick, weightedPick
  noise.js             # value noise, fbm, ridged, duneNoise, windStreaks, voronoi
  input.js             # mouse/key/touch/gamepad → move/aim/fire/cycle/equipment
  camera.js            # dt-scaled lerp (1-(1-k)^(dt*60)), zoom, shake, world↔screen
  view25.js / prims25.js / drawUtil.js / palette.js  # faux-3D (VIEW25) + mats/shade/withAlpha
  terrain.js           # SSOT desert: dip → highs → basin → wadis → oases → typeAndElevation
  world.js             # roads (A* MST + Chaikin), sites (water-anchored + sector guarantee), convoys (arc-length), decorations, buildings
  contracts.js         # SCENARIO×STYLE×DIFFICULTY orthogonal board, 4 offers per act/sortie
  meta.js              # career (pilot, dollars, hangar, skill grid), pure and headless-testable
  upgrades.js          # 8 Fear cards (field upgrades)
  appBridge.js         # drawCornerBrackets, drawBackButton (avoid circular)
  screens_meta.js      # hangar + pilotRecord canvas screens
  data/enemies.js      # class → loadout (difficulty-tiered)
  sim/
    state.js           # FEAR_THRESHOLDS, HEAT_LABELS, hunterClockRate, factories (createHeli/Boss/SortieState)
    movement.js        # nearestRoadPoint, steerAlongRoads, vehicleSpeedFactor, pointAlongRoute, getConvoyMembers (roadCache WeakMap)
    objectives.js      # isTargetAlive, objectiveComplete, canExtract, getObjectiveFocus, nearestExitPoint
    gameState.js       # shared mutable world/heli/boss/sortieState/projectiles (single source, imported by app + screens/sortie)
    sortieLogic.js     # stub for helpers extracted from app.js (future)
    sortieTick.js      # stub for tickSortie (future, ~1000 lines currently in app.js)
  render/
    terrain.js         # setTerrain + drawSmoothTerrain (GPU grid + grain/mottle/macro, owns tgCanvas)
    roads.js           # drawRoads (hierarchy overdraw) + getMiniRoads (minimap cache)
    hud.js             # hudPlate, plateHeader, hudBar, drawOffscreenMarker, scanlines/grid
    world.js           # drawSites, drawDecorations, drawScenarioOverlays, drawBuilding (via setWorldState)
    entities.js        # drawGunship, drawEnemy, drawBoss/Hunter (via setBoss)
    hudFull.js         # stub for full sortie HUD (future)
  screens/
    sortie.js          # stub for sortie screen (enter/tick/draw) — currently in app.js:1384-2924
tools/
  check.mjs            # gate: lint → meta-check → sortie-smoke
  lint.mjs             # node --check 33 files + invariants (duplicate contracts handler, accumulator, terrain/roads delegation) + optional eslint --max-warnings 100
  meta-check.mjs       # 82 asserts on career/skill/hangar/XP
  sortie-smoke.mjs     # 99 asserts on world determinism, objective completability, extraction, meta pipeline
```

`js/sim/*` and `js/meta.js` are DOM-free for headless tests. `js/render/*` owns its caches and takes `ctx`/`cam` + explicit `world`/`heli` where needed (via setters).

## Loop (fixed timestep, now correct)

`js/app.js:55` — `accumulator += dt; while (accum >= SIM_DT && guard<8) { tick(SIM_DT) }` with `if (accum>0.1) accum=0` clamp and `Math.max(0,accum)` remainder preservation. `camera.tick(dt)` is `1-(1-k)^(dt*60)` so 30/60/120Hz feel identical. `input.consumeOneShots` after ticks, `camera.clear`/`draw`/`input.draw` each frame.

## World-gen causal chain

`terrain.js` dip → `highs` (2-4, minSep) → `basin` → `wadis` (traceWadi down-dip + meander + confluences) → `oases` (termini/midcourse) → `world.js` sites (water/junction/high/scatter candidates, minSep, waypoint, 3×3 sector guarantee) → roads (terrain-cost grid + A* + MST + Chaikin, plus regional exit highways). Names are pure syllable assembly (`world.js:881`), not real places.

## Contracts → Sortie → Debrief

`contracts.js` picks 4 `SCENARIO` (strike/intercept/sabotage/suppression/recovery) × compatible `STYLE` (loud/precision/deep/pursuit/low) × `DIFFICULTY` (routine/standard/hazardous/severe, `threatBudget`/`radial`/`hp`/`eta` multipliers). `world.js` `generateWorld({seed, contract, terrain})` builds a battlefield fulfilling the contract. Sortie is `TITLE → OPERATIONS (4 offers) → briefing (choose EQUIPMENT) → SORTIE (complete objective → exit map edge) → debrief (commitSortieOutcome banks dollars/XP, KIA resets pilot)`. Extraction is `canExtract` in `sim/objectives.js`.

## Fear / Heat / Hunter

- **Fear** (`FEAR_THRESHOLDS` in `sim/state.js`, alias `INFAMY` in `config.js` deprecated) — kills add `fearWeight`, clears add Heat; thresholds `[10,25,50,85,130,190,270,370,500,660]` → Fear level → `FEAR GROWS` overlay with 3 cards from `upgrades.js`.
- **Heat** (`HEAT_LABELS` QUIET→CRITICAL) — `addHeat`/`reduceHeat` in `app.js`, `getHeatTier` in `sim/state.js`, scales `COMBAT.aggroPerHeatTier` and `hunterClockRate = (0.72+heat/100*1.18)*difficulty*style`.
- **Hunter** (`bossState.timeRemaining`, `TIMER.baseTime * hunterEtaMultiplier` in `config.js:60` live) — `bossWarningTime 5s` then `spawnBoss` (Hind, `approach→attack→retreat`), `bossState` in `sim/gameState.js`.

## Conventions for building upon

- **Data over classes.** New content = new data entries (`ENEMY_CLASSES` in `world.js`, `SCENARIOS` in `contracts.js`), not new classes.
- **Determinism.** All world content via `mulberry32(seed)`. Don't use `Math.random` for world.
- **No DOM in sim.** Keep `js/sim/*` and `js/meta.js` `document`-free.
- **Shared state.** Mutate `GameState.world`/`heli`/`boss`/`sortieState` via setters or the imported object (`heli.x = ...` is fine — same object). Don't duplicate `let world` elsewhere.
- **Render caches.** `render/terrain.js` (`tgCanvas`, grain/mottle/macro), `render/roads.js` (`WeakMap` roadCache, `_miniRoadsCache`), `render/world.js` (`setWorldState`) own their caches — call `setTerrain`/`setWorldState`/`setBoss` before drawing.

## Streets — next architectural draft (feature/streets, safe fork)

`main` stays at `WORLD_GEN=1` (current blobs-on-roads, playable). `feature/streets` builds `WORLD_GEN=2` behind a flag so the prototype is never destroyed. See `docs/STREETS_SPEC.md` for the full spec.

**Method (fork, not destroy):**
- Branch `feature/streets` off `6c9e1d2`. All street work there; `main` stays deployable.
- Flag `WORLD_GEN_VERSION` in `js/config.js` (default `1` on `main`, `2` on the feature branch). `js/world.js:generateSites` dispatches: `if (v===2) return generateStreetsSites(...)` else `generateLegacySites(...)` (current body verbatim).
- Parallel impl in `js/world/streets.js` + `parcels.js` — `js/world.js` only gains the dispatch. `Site.buildings` shape (`{x,y,type}`) is unchanged so `js/render/*` and `js/sim/*` see no break. New streets are appended to `world.roads` as `local` so `steerAlongRoads` already makes vehicles follow them.
- Tests run both versions: `tools/sortie-smoke.mjs` will loop `WORLD_GEN 1/2` × 3 seeds × 5 scenarios and assert determinism + “every building inside its parcel, every parcel touches a street”.
- Merge when `node tools/check.mjs` passes and a manual `http://localhost:8000` fly-through reads as streets (town grid, camp perimeter). Flip default to `2` and merge via PR.

## Rebuilding notes

- **Add a gunship:** add entry in `meta.js` `HANGAR_SLOTS` and `createCareer` `unlocked`, plus rendering in `render/entities.js` `drawGunship` if you want a new silhouette.
- **Add a scenario:** add entry in `contracts.js` `SCENARIOS` + `world.js` `addScenarioBuilding` branch + `sim/objectives.js` `objectiveComplete` case + `sortie-smoke` coverage in `tools/sortie-smoke.mjs`.
- **Tighten lint:** `tools/lint.mjs` allows 100 warnings (currently ~60, mostly unused `delaunay`/`bezierRoad` in `world.js` kept for future). Run `npx eslint --fix` then manually prefix intentionally unused with `_`.
