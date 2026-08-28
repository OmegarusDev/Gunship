# Streets Spec — Making Settlements out of Roads (not blobs on roads)

**Status:** Draft for `feature/streets` (branch off `6c9e1d2`). Prototype on `main` stays playable. This spec is the Day-1 architectural answer to “villages should be *made of* streets”.

## 1. Why blobs fail now

Current `js/world.js:575 generateSites` and `js/terrain.js` do the right thing at region scale (dip→wadis→oases→site candidates → MST roads via A* terrain-cost). But at settlement scale it’s:

```
site point → find nearest road → scatter buildings 70% along road + 30% around center (Poisson-ish, random offset, no street graph)
```

Result: roads and buildings are two independent scatters. Streets don’t *form* the town; towns are blobs *on* a road. No parcels, no frontage, no alleys, no chokepoints, no readable street fighting, and convoys don’t have a street to follow inside the settlement.

## 2. Goals

- **Streets form the settlement.** Roads are edges, parcels are blocks, buildings front onto street parcels. You can read the town from the road graph alone.
- **Archetype reads differently:** `rural` = 1-2 streets + 1-3 parcels, `town` = grid-ish, `camp` = perimeter road + parade, `base` = grid + gate + motor pool. Same street engine, different parameters.
- **Gameplay:** street-level cover, convoy routing through streets (not just *near* the site), AI that uses parcels for `guard`/`patrol`, extraction that understands street exits.
- **Preserve prototype:** `main` stays at `WORLD_GEN=1` (current). `feature/streets` builds `WORLD_GEN=2` behind a flag, parallel to `js/world.js`, with `tools/sortie-smoke` covering both. No save break until the flag flips.

## 3. Non-goals (for this draft)

- No new gunships, no new scenarios. The street system must make the *existing* 5 scenarios (`strike`/`intercept`/`sabotage`/`suppression`/`recovery` `js/contracts.js:10`) more immersive without new content.
- No WebGL, no `sim`→`render` contract change. `js/sim/*` stays DOM-free.

## 4. Data model

```js
// New — lives in js/world/streets.js (proposed) alongside js/world.js
StreetGraph = {
  nodes: [{ id, x, y, kind: 'junction'|'deadend'|'gate' }],
  edges: [{ id, a: nodeId, b: nodeId, kind: 'local'|'alley'|'perimeter', width }],
}

Parcel = {
  id, siteId,
  polygon: [{x,y}...],        // road-bounded block, clockwise, no self-intersection
  streetFrontage: edgeId,     // which street edge it fronts
  kind: 'residential'|'market'|'military'|'depot',
}

BuildingFootprint = {
  id, siteId, parcelId,
  polygon: [{x,y}...],        // axis-aligned to frontage, with setback
  type: 'hut'|'depot'|'tower'|'barracks'|'bunker'|..., // same ARCHETYPES building types
  doorDir: angle,             // front door faces the street (for AI cover)
}
```

`generateSites` still produces `Site { x,y, archetype, buildings[] }`, but `buildings[]` now comes from `BuildingFootprint` conversion (`{x,y,type}` centroids remain the public API so `js/render/world.js` and `js/data/enemies.js` don’t churn).

## 5. Generation pipeline (per site, deterministic from site seed)

**Input:** `Site { x,y, archetype, seed }`, `world.roads` (MST), `terrain` (for slope cost), `ARCHETYPES[archetype].buildingCount`.

**Step 1 — Settlement bbox & street skeleton**
- Bbox size by archetype: `rural 60`, `town 90`, `camp 75`, `base 120` (same spreads as current, but now *streets* fill the box, not scatter).
- Find the nearest `world` road segment to the site point → that’s the **spine**. Extend it into the bbox as the first edge (so the settlement is *on* the highway, not *near* it).
- Grow a skeleton:
  - `rural`: 1 spine + 0-2 short spurs (5-15u, random side, like a hamlet lane)
  - `town`: 1-2 spines + 1-3 cross streets (grid-ish, 1 Chaikin pass to soften as `world.js:198` does)
  - `camp`: perimeter rectangle + 1 central parade street
  - `base`: 2×2 grid + gate edge aligned to the highway + motor-pool alley
- All edges are stored in `StreetGraph` with `width` from `ROAD_STYLE` (`paved 24-34`, `dirt 14-22`, `track 6-12` as `js/world.js:326`).

**Step 2 — Parcel subdivision**
- Offset each street edge by `width/2 + sidewalk (2)` on both sides → street polygons.
- Compute the settlement’s outer border (bbox) minus street polygons → remaining area is the parcel region.
- Subdivide parcel region into `buildingCount` parcels via **strip subdivision**: slice along the longest axis of each parcel until count matches, with min parcel `8×8` (hut) to `18×14` (barracks) as `js/world.js:1158` templates imply. This is deliberately simple (no BSP/straight-skeleton yet) — parcels are rectangles, buildings are their insets.

**Step 3 — Building placement**
- For each parcel, inset by `setback 2-4` from all sides (front setback 3 to leave a yard) → `BuildingFootprint polygon`.
- Pick `type` from `ARCHETYPES[archetype].buildings` weighted as current, but now constrained by parcel size: `hut` fits any, `barracks` needs ≥14×8, `tower` needs near a junction node.
- `doorDir` = angle from parcel centroid to its `streetFrontage` edge — this gives AI a “front” to use for cover and gives rendering a door side.

**Step 4 — Integration**
- Convert each `BuildingFootprint` to the existing `Site.buildings[]` shape: `{x: centroid.x, y: centroid.y, type}` plus `polygon` for precise rendering/collision later. `Site.enemies` roster generation (`world.js:820`) is unchanged — it already takes `buildings` positions for indoor spawns.
- Extend the world road network: each `StreetGraph` edge is also appended to `world.roads` with `hierarchy: 'local'` and `surface: 'track'`/`'dirt'` so the existing `getRoadSegs`/`steerAlongRoads` `js/sim/movement.js:11` and `vehicleSpeedFactor` already make vehicles follow streets. No `sim` change.
- Keep the site’s `detectionRadius`/`alertRadius` as now (`ARCHETYPES` in `world.js:477`), but `CommunalBuilding` (mosque/market) in `town` now sits on the largest parcel, giving a readable center for `drawSites`.

## 6. Rendering (no new primitives)

- Streets are just roads — `js/render/roads.js:drawRoads` already handles `local` hierarchy and `track` surface (twin tyre ruts). Settlement streets will read as streets without new code.
- Buildings are still `box25`/`frustum25` via `js/render/world.js:drawBuilding`/`mat` — only now their `x,y` sit on parcel centroids, so the scatter disappears and the town reads as rows.
- Parcels themselves are not drawn in-game (maybe a faint `withAlpha` fill in debug mode), but they are the collision/cover source for `sim`.

**Debug overlay (flag `DEBUG_PARCELS=1`):** stroke parcel polygons in `withAlpha(P.ui.textDim,0.15)` and street graph in `withAlpha(P.ui.enemy,0.25)` so the street→parcel→building chain is inspectable on `http://localhost:8000`.

## 7. AI / Sim hooks (minimal, additive)

- `guard` / `patrol` `ENEMY_CLASSES` `js/world.js:536` already use `steerAlongRoads` — they will naturally stay on streets once streets are `world.roads`. No new behavior class.
- Add `parcelId` to each enemy’s `home` (for leash): `COMBAT.leashInfantry 480` `js/config.js:43` now means “480 from parcel centroid”, which keeps garrisons in their block, not wandering across the desert.
- Convoys already use `pointAlongRoute` arc-length `js/sim/movement.js:11` — for a future `suppression` that routes *through* a `town`, we can give the convoy a `StreetGraph` route that goes down the spine.

## 8. Safe fork method (prototype never breaks)

**Branch:** `feature/streets` off `6c9e1d2` (current `main` is the prototype). All work happens there; `main` stays at `WORLD_GEN=1` and stays deployable to Pages.

**Flag:** `WORLD_GEN_VERSION = 1 | 2` in `js/config.js` (default `1` on `main`, `2` on `feature/streets`). `js/world.js:generateSites` becomes:

```js
export function generateSites(seed, roads, worldSize, terrain, opts = {}) {
  const v = opts.worldGenVersion ?? WORLD_GEN_VERSION;
  if (v === 2) return generateStreetsSites(seed, roads, worldSize, terrain);
  return generateLegacySites(seed, roads, worldSize, terrain); // current 575-line impl, untouched
}
```

`generateLegacySites` is the current body of `generateSites` moved verbatim — zero risk to `main` when cherry-picking the flag alone.

**Parallel impl:** new code lives in `js/world/streets.js` (street graph + parcel subdivision) and `js/world/parcels.js` (building footprint). `js/world.js` only gains the `if (v===2)` dispatch and the `worldGenVersion` param. `js/sim/*` and `js/render/*` see no API break — `Site.buildings` shape is unchanged.

**Tests:** `tools/sortie-smoke.mjs` already loops all 5 scenarios × 3 seeds and checks `objectiveComplete`/`canExtract`. Extend it to run both `WORLD_GEN=1` and `2` and assert determinism (`generateWorld({seed, worldGenVersion:2})` stable) and that every `building` sits inside its `parcel` and every `parcel` touches a street edge. `tools/lint.mjs` invariant: “every building has a `parcelId` when `v===2`”.

**Save compat:** `WORLD_GEN_VERSION` is stored in `world.worldGenVersion` but not in `meta.js` `SAVE_KEY` — saves don’t break; a `v2` world is just a new sortie seed. If we ever re-enable `localStorage` world caching, the flag prevents cross-version cache hits.

**Merge:** when `feature/streets` passes `node tools/check.mjs` and a manual `http://localhost:8000` fly-through (town reads as grid, convoy follows main street), flip `WORLD_GEN_VERSION` default to `2` in `js/config.js` and merge `feature/streets` → `main` via PR (CI `ci.yml` runs the gate).

## 9. What this unlocks next (not in this draft)

- Street-level scenarios: `suppression` that requires clearing a `base`’s gate street, or `recovery` where the crate is in a market parcel with alley egress.
- Cover system: `parcel.polygon` becomes the “in-cover” test for `rifleman` vs `mg` (instead of `leash` radius alone).
- Art pass: doors/windows front onto `doorDir` (already in `drawBuilding` `barracks` windows), street signs as `decoration` type.

## 10. Risks & counters

- **Street graph looks too regular.** Counter: keep Chaikin softening and add `organic: true` for `rural` (single Chaikin pass with 0.28 offset as `world.js:198`), plus a `jitter 2-4` on parcel insets.
- **Parcel subdivision creates slivers.** Counter: min parcel `8×8` and discard slivers < `6×6` (merge to neighbor).
- **Vehicles get stuck on tight alleys.** Counter: `alley` `width 6-8` is still > `technical` `size 7` `world.js:548`, and `vehicleSpeedFactor` already gives `wadi`/`track` slowdown — alley is just a slow road.
