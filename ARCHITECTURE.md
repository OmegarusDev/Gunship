# Architecture — Gunship

This document is the map for rebuilding and extending the game. Code is truth; this doc points to it.

## Stack

- **Static site, zero runtime deps.** ES modules, `index.html` → `js/app.js` → `js/sim/*` + `js/render/*`. No bundler required (but `npm run dev` works).
- **Node 20+** for tooling (`eslint`, `prettier`, `puppeteer` for headless click regression). No build step for the game itself.

## Rebuild from scratch

```bash
git clone https://github.com/OmegarusDev/Gunship.git && cd Gunship
npm ci                  # or npm install (installs eslint/prettier/puppeteer dev deps)
node tools/check.mjs    # project gate: syntax/lint → meta checks → sortie checks
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
  world.js             # public generateWorld facade; WORLD_GEN v4 is the sole final generator
  world/
    geometry.js        # dependency-free polygon/polyline geometry and phase-seed derivation
    region.js          # regional profile, resource axes, land use, typed destination demand
    transport.js       # connected demand-driven regional roads and destination access
    places.js          # place grammars: districts, streets, parcels, buildings, enclosures
    encounters.js      # independent occupation/contact layer and roster placement
    generateV4.js      # deterministic v4 pipeline and semantic contract target planner
  contracts.js         # SCENARIO×STYLE×DIFFICULTY board; objectives request semantic tags
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
    world.js           # land use/place geometry, oriented buildings, labels, separate contacts
    entities.js        # drawGunship, drawEnemy, drawBoss/Hunter (via setBoss)
    hudFull.js         # stub for full sortie HUD (future)
  screens/
    sortie.js          # stub for sortie screen (enter/tick/draw) — currently in app.js:1384-2924
tools/
  check.mjs            # gate: lint → meta-check → sortie-smoke
  lint.mjs             # syntax + structural invariants + optional eslint
  meta-check.mjs       # career/skill/hangar/XP checks
  sortie-smoke.mjs     # objective, extraction, and meta-pipeline checks
  worldgen-check.mjs   # multi-seed v4 determinism, geometry, connectivity, and rhythm sweep
```

`js/sim/*` and `js/meta.js` are DOM-free for headless tests. `js/render/*` owns its caches and takes `ctx`/`cam` + explicit `world`/`heli` where needed (via setters).

## Loop (fixed timestep, now correct)

`js/app.js:55` — `accumulator += dt; while (accum >= SIM_DT && guard<8) { tick(SIM_DT) }` with `if (accum>0.1) accum=0` clamp and `Math.max(0,accum)` remainder preservation. `camera.tick(dt)` is `1-(1-k)^(dt*60)` so 30/60/120Hz feel identical. `input.consumeOneShots` after ticks, `camera.clear`/`draw`/`input.draw` each frame.

## World-gen causal chain

`terrain.js` remains the terrain single source of truth. `world/generateV4.js` consumes that terrain and a deterministic seed, then runs one causal pipeline:

1. Choose a grounded regional profile.
2. Derive water, irrigation, relief, and industry/resource axes.
3. Place typed destination anchors that express physical demand, scale, and orientation.
4. Build one connected, demand-driven transport hierarchy from regional gateways to those destinations.
5. Apply authentic place grammars.
6. Generate districts, local streets, frontage parcels, buildings, walls, berms, fences, fields, canals, groves, and yards.
7. Derive the named `world.places` index from the completed physical geometry.
8. Generate independent `world.encounters` occupation/contact records.
9. Resolve the contract against semantic target tags.

Destination anchors are planning inputs, not runtime “sites.” Regional roads are justified by destination demand and guaranteed connectivity; no MST or legacy-generator dispatch participates in the final world.

## Contracts → Sortie → Debrief

`contracts.js` picks 4 `SCENARIO` (strike/intercept/sabotage/suppression/recovery) × compatible `STYLE` (loud/precision/deep/pursuit/low) × `DIFFICULTY` (routine/standard/hazardous/severe, `threatBudget`/`radial`/`hp`/`eta` multipliers). `world.js` exposes `generateWorld({seed, contract, terrain})`; v4 builds the geometry and then selects contract targets by semantic tags such as `command`, `radar`, `airDefense`, `supply`, or `convoyRoute`. Target selection never depends on a place centroid or settlement archetype. Sortie is `TITLE → OPERATIONS (4 offers) → briefing (choose EQUIPMENT) → SORTIE (complete objective → exit map edge) → debrief (commitSortieOutcome banks dollars/XP, KIA resets pilot)`. Extraction is `canExtract` in `sim/objectives.js`.

## Fear / Heat / Hunter

- **Fear** (`FEAR_THRESHOLDS` in `sim/state.js`, alias `INFAMY` in `config.js` deprecated) — kills add `fearWeight`, secured encounters add Heat; thresholds `[10,25,50,85,130,190,270,370,500,660]` → Fear level → `FEAR GROWS` overlay with 3 cards from `upgrades.js`.
- **Heat** (`HEAT_LABELS` QUIET→CRITICAL) — `addHeat`/`reduceHeat` in `app.js`, `getHeatTier` in `sim/state.js`, scales `COMBAT.aggroPerHeatTier` and `hunterClockRate = (0.72+heat/100*1.18)*difficulty*style`.
- **Hunter** (`bossState.timeRemaining`, `TIMER.baseTime * hunterEtaMultiplier` in `config.js:60` live) — `bossWarningTime 5s` then `spawnBoss` (Hind, `approach→attack→retreat`), `bossState` in `sim/gameState.js`.

## Conventions for building upon

- **Data over classes.** New content = new data entries (enemy definitions in `data/enemies.js`, scenarios in `contracts.js`, regional/place grammar data in `world/*`), not new classes.
- **One generator.** WORLD_GEN v4 is the only final generation path. `js/world.js` is a facade, not an alternate generator or version dispatcher.
- **Determinism.** Every generation phase derives a stable random stream from the sortie seed. Never use `Math.random` for world content.
- **Terrain authority.** Query `js/terrain.js`; do not recreate elevation, drainage, or terrain classification inside world modules.
- **Geometry authority.** Roads, land-use shapes, parcels, footprints, and enclosure geometry are canonical. `x`/`y`, bounds, names, and `world.places` are indexes derived from those shapes.
- **Place is not allegiance.** A place describes physical geography. Hostility and clearing belong to `world.encounters`; a civilian place can be neutral or partly occupied, while military and industrial geometry can host hostile contacts.
- **Runtime schema.** Generated worlds expose `region`, `landUse`, `roads`, `parcels`, `buildings`, `features`, `places`, `encounters`, `convoys`, `supplyCrates`, `fuelDepots`, `radarSites`, and `objective`. There is no `world.sites` or `siteId`; enemies use `encounterId` and optional `placeId`.
- **Semantic objectives.** Contracts resolve tagged physical features or routes (`command`, `radar`, `airDefense`, `supply`, `convoyRoute`), never a place archetype or centroid.
- **No DOM in sim.** Keep `js/sim/*` and `js/meta.js` `document`-free.
- **Shared state.** Mutate `GameState.world`/`heli`/`boss`/`sortieState` via setters or the imported object (`heli.x = ...` is fine — same object). Don't duplicate `let world` elsewhere.
- **Render caches.** `render/terrain.js` (`tgCanvas`, grain/mottle/macro), `render/roads.js` (`WeakMap` roadCache, `_miniRoadsCache`), `render/world.js` (`setWorldState`) own their caches — call `setTerrain`/`setWorldState`/`setBoss` before drawing.

## Rebuilding notes

- **Add a gunship:** add entry in `meta.js` `HANGAR_SLOTS` and `createCareer` `unlocked`, plus rendering in `render/entities.js` `drawGunship` if you want a new silhouette.
- **Add a scenario:** add its semantic target tags in `contracts.js`, teach the v4 target planner how to satisfy them from generated features/routes, add the completion rule in `sim/objectives.js`, and cover it in `sortie-smoke` plus `worldgen-check`.
- **Add a regional profile or place grammar:** keep regional demand in `world/region.js`, physical layout in `world/places.js`, and occupation in `world/encounters.js`; extend the seed sweep with measurable geometry and content-rhythm assertions.
- **Tighten lint:** run `npx eslint --fix`, then prefix intentionally unused values with `_` where appropriate.
