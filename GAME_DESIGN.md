# GUNSHIP: FREEDOM PROTOCOL — COMPLETE GAME DESIGN DOCUMENT

> **Version:** 2.0 (Final)
> **Purpose:** Complete reference for any agent implementing this game. Every system, formula, data structure, and design decision is documented here. When in doubt, this document is authoritative.
> **Tech:** Vanilla HTML + CSS + ES modules. Zero dependencies. 2D Canvas with faux-3D projection. No WebGL (yet — 3D conversion planned post-prototype).
> **Setting:** 1990s Gulf War-inspired, fictional desert country. The player flies attack helicopters for the Coalition for Democratic Liberation (CDL), a well-intentioned but destructive military force "liberating" the region from terrorist cells. The sardonic framing: we believe we're the good guys. The locals call us the problem.

---

## TABLE OF CONTENTS

1. [Game Overview](#1-game-overview)
2. [Core Gameplay Loop](#2-core-gameplay-loop)
3. [Lore & Tone](#3-lore--tone)
4. [Technical Architecture](#4-technical-architecture)
5. [Rendering System](#5-rendering-system)
6. [World Generation](#6-world-generation)
7. [Settlement Generation](#7-settlement-generation)
8. [Gunships](#8-gunships)
9. [Weapon System](#9-weapon-system)
10. [Enemy System](#10-enemy-system)
11. [Boss System](#11-boss-system)
12. [Infamy System](#12-infamy-system)
13. [Pilot System](#13-pilot-system)
14. [Equipment](#14-equipment)
15. [Meta-Progression](#15-meta-progression)
16. [HUD & UI](#16-hud--ui)
17. [Run Modifiers](#17-run-modifiers)
18. [Audio](#18-audio)
19. [Implementation Phases](#19-implementation-phases)
20. [Balance Formulas](#20-balance-formulas)

**Appendices:**

- A. [Architecture Decisions Log](#appendix-a-architecture-decisions-log)
- B. [Enemy Type Dossier (Unified)](#appendix-b-enemy-type-dossier)
- C. [Save Data Schema](#appendix-c-save-data-schema)

---

## 1. GAME OVERVIEW

### 1.1 Core Concept

A 2D top-down/isometric roguelite helicopter combat game. The player pilots attack helicopters for the Coalition for Democratic Liberation (CDL), conducting deep-penetration operations in a fictional desert country. The game hybridizes **Desert Strike** (open-world helicopter combat), **Vampire Survivors** (auto-fire, Infamy-based weapon evolution), and **Roguelite** (permadeath per pilot, permanent meta-progression).

### 1.2 Platform

- **Target:** Web (mobile + desktop)
- **Rendering:** 2D Canvas (faux-3D projection, no WebGL)
- **Orientation:** Portrait-first on mobile, landscape equally supported, desktop reactive
- **Performance:** 60fps baseline, 120fps if display supports it
- **Assets:** Zero external assets. All graphics procedurally generated via Canvas primitives.

### 1.3 Campaign Structure

- **4 Acts** per campaign
- **4 Sorties per Act** (3 normal Sorties + 1 Stronghold act boss)
- **16 Sorties total** per campaign
- **Prestige loop** after beating the final boss (Act 4, Sortie 16)

### 1.4 Gunship Progression

| Act       | Gunship          | Unlock Condition                  |
| --------- | ---------------- | --------------------------------- |
| Act 1     | AH-1 Cobra       | Default (start game)              |
| Act 2     | AH-1W SuperCobra | Reach Act 2                       |
| Act 3     | AH-64 Apache     | Reach Act 3                       |
| Act 4     | AH-64D Longbow   | Reach Act 4                       |
| Post-game | RAH-66 Comanche  | Beat final boss (prestige reward) |

### 1.5 Key Design Pillars

1. **Zero assets** — everything procedurally generated on 2D canvas
2. **Data-driven entities** — adding content = adding data entries, no new classes
3. **Risk/reward** — clearing settlements makes boss come faster but gives loot
4. **Infamy tension** — higher Infamy = stronger weapon AND stronger boss
5. **Gunship progression** — each new gunship is a tangible upgrade with new capabilities
6. **Environmental storytelling** — the player is the villain, never explicitly stated

---

## 2. CORE GAMEPLAY LOOP

```
[MAIN MENU]
  |
  +--> [HANGAR] (spend Dollars on per-gunship upgrades)
  +--> [PILOT RECORD] (spend skill points on pilot skill grid, respec)
  |
  v
[PRE-SORTIE BRIEFING] (shows modifier, current gunship, pilot)
  |
  v
[SPAWN at world center]
  |
  v
[EXPLORE] ---> [DISCOVER SETTLEMENT] ---> [ENGAGE ENEMIES]
  |                                            |
  |    <--- Infamy level-up popup (pause) <----+
  |                                            |
  v                                            v
[FUEL DEPOT found] ---> [DESTROY IT] ---> [+20s timer bonus]
  |
  v
[BOSS TIMER TICKING DOWN...]
  |
  v (timer hits 0)
[BOSS SPAWNS from map edge] ---> [INCOMING HOSTILE — DIRECTION ARROW]
  |
  v
[BOSS FIGHT] ---> [WIN: XP + Dollars bonus] ---> [SORTIE COMPLETE]
  |                                                       |
  v                                                       v
[DIE: Pilot KIA]                               [POST-SORTIE SUMMARY]
  |                                                       |
  v                                                       v
[SORTIE SUMMARY] <----------------------------------------+
  |
  v
[NEW SORTIE] (fresh procedural world, new modifier)
```

### 2.1 Sortie Structure

- Each Sortie = one procedurally generated world
- World exists until the player dies OR defeats the boss
- Boss arrives after a timer (base time + modifiers)
- Clearing settlements ACCELERATES the timer (faster boss)
- Destroying fuel depots EXTENDS the timer (+20s per depot)
- Infamy level makes the boss STRONGER (more bodyguards, +5% HP per Infamy level)
- Boss fight is mandatory — Sortie ends with boss encounter (win or lose)
- After boss win: Sortie complete, collect rewards, return to menu
- After death: Pilot KIA, Sortie ends, go to summary

### 2.2 Boss Timer Mechanic

```
TIMER FORMULA:
  remainingTime = baseTime + jammerBonus + fuelBonus - settlementPenalty

Where:
  baseTime = 180 seconds (3 minutes)
  jammerBonus = 60 * jammerLevel (meta-upgrade, 0-3 levels)
  fuelBonus = 20 * fuelDepotsDestroyed (fuel tanks) + 10 * fuelTankersDestroyed
  settlementPenalty = varies by settlement type (see below)
```

```javascript
BOSS_TIMER = {
  baseTime: 180,
  jammerBonus: 60,
  maxJammerLevel: 3,

  clearPenalties: {
    rural: 15,
    town: 30,
    camp: 20,
    base: 45,
  },

  fuelTankBonus: 20,
  fuelTankerBonus: 10,
  commandBuildingBonus: 30,
  radarTowerBonus: 30,

  bossSpawnDistance: 80,
  bossWarningTime: 5,
};
```

---

## 3. LORE & TONE

### 3.1 The Coalition for Democratic Liberation (CDL)

**Callsign:** "Guardian Angel"
**Self-image:** We're bringing freedom. Democracy. Stability.
**Reality:** We're leveling entire neighborhoods to "neutralize threats."

The CDL is a coalition of advanced military powers who genuinely believe their intervention is justified. Their propaganda is immaculate. Every destroyed building was a "terrorist stronghold." Every killed enemy was a "confirmed hostile." Their pilots are young, idealistic, and completely bought in.

**The sardonic frame:** The player IS the villain, but the game never explicitly tells you. The evidence is environmental:

- Settlements you clear have no weapons in many of them
- "Confirmed hostiles" who were fleeing (the unarmed enemy type)
- The Infamy mechanic — the locals are afraid of YOU
- Radio chatter that's cheerful about destruction
- Post-sortie summaries using sanitized military language

### 3.2 The Crescent (Al-Hilal)

**Meaning:** "The Crescent" — a reference to the region's cultural identity
**Reality:** Not one unified group. Disparate local militias.

- Some are genuinely defending their homes (self-defense force)
- Some are the actual terrorists the CDL claims to fight
- The CDL can't tell the difference (or doesn't care)
- The "good" Crescent fighters and the terrorists are all labeled the same

**The dark truth:** The Crescent started as a legitimate self-defense force against foreign occupation. Some factions turned to terrorism. The CDL uses the terrorists as justification to occupy everything.

### 3.3 Environmental Storytelling (Radio Chatter)

Text pop-ups that appear at key moments. Zero assets, pure flavor.

**On discovering a settlement:**

```
"SECTOR 7: Al-Hilal checkpoint. Radio chatter: 'They're coming. Hold position.'"
"SECTOR 12: Abandoned village. Signs of recent habitation. Evacuated 72 hours ago."
"SECTOR 19: Crescent defensive position. They knew we were coming."
"SECTOR 3: [Arabic name]. Local militia. Light arms only."
```

**On clearing a settlement:**

```
"Area secured. Freedom index updated. No civilian casualties reported."
"Hostile resistance neutralized. Local threat level: REDUCED."
"Zone liberated. Reconstruction funds allocated. (Note: no structures remain.)"
"Mission success. The local population is now free. (Note: no population found.)"
```

**On approaching boss:**

```
"INCOMING: Heavy armored vehicle detected. Direction: [compass bearing]."
"Command, we have a bogey. Large. Tank-class. Moving to intercept."
"Guardian Angel [pilot name], be advised: hostile armor inbound."
```

**On pilot death:**

```
"Pilot KIA. Sector [X] has been liberated."
"Guardian Angel [name] completed their mission. Freedom prevails."
"Signal lost. Guardian Angel [name] made the ultimate sacrifice."
```

### 3.4 Settlement Naming

Arabic-sounding procedural names. Generated from syllable combinations:

```javascript
SYLLABLES = {
  prefix: ['al', 'bi', 'kha', 'sha', 'mal', 'dar', 'kar', 'bur', 'suk', 'qal'],
  root: ['am', 'ir', 'an', 'id', 'uk', 'ur', 'is', 'ah', 'un', 'at'],
  suffix: ['abad', 'istan', 'iya', 'ani', 'pur', 'garh', 'abad', 'iyya'],
};
// Generate: prefix + root + suffix = "al-amabad", "kar-irani", "suk-istan"
```

Settlement TYPE labels:

- Rural: "hamlet", "settlement", "outpost"
- Town: "town", "district", "quarter"
- Camp: "camp", "bivouac", "position"
- Base: "facility", "compound", "stronghold"
- Fuel Depot: "depot", "fuel point", "storage"

### 3.5 High-Priority Targets

Certain structures have a reddish tint to distinguish them:

- **Command buildings** (destroying them +30s to boss timer)
- **Radar towers** (destroying them +30s to boss timer)
- These are "high-value targets" — the player learns to recognize them visually

---

## 4. TECHNICAL ARCHITECTURE

### 4.1 Project Structure

> **Note (2026-08 SHIPPED vs GDD):** The tree below is the _aspirational_ GDD v2. The _shipped_ tree follows it. Where they differ, code is truth.

**Aspirational (GDD v2):**

```
gunship/
  index.html
  css/main.css
  js/
    app.js, config.js, rng.js, input.js, camera.js, view25.js, prims25.js, drawUtil.js,
    fx.js, palette.js, terrain.js, settlements.js, buildings.js, entities.js, helicopter.js,
    gunships.js, enemies.js, projectiles.js, combat.js, infamy.js, boss.js, signal.js,
    pilots.js, pilotSkills.js, equipment.js, modifiers.js, rewards.js, loot.js, minimap.js,
    hud.js, lore.js, save.js
    screens/title.js, briefing.js, hangar.js, pilotRecord.js, sortieSummary.js, infamyLevelUp.js
    data/...
    sim/world.js, sim.js, systems/movement.js, combat.js, ai.js, boss.js, signal.js, ...
```

**Shipped (2026-08) — actual filesystem:**

```
gunship/
  index.html
  css/main.css
  js/
    app.js                   # Bootstrap, screen router, loop (now delegates to sim/render)
    config.js                # Tunables + TIMER/INFAMY (some fields legacy, see §11)
    rng.js, noise.js, input.js, camera.js, view25.js, prims25.js, drawUtil.js, palette.js
    terrain.js               # SSOT desert model (dip→wadis→oases)
    world.js                 # Roads (A* MST), sites, convoys, decorations
    contracts.js             # Scenario×Style×Difficulty orthogonal contracts
    meta.js                  # Career, pilot, skill grid, hangar, persistence
    upgrades.js              # Fear field-upgrade cards (8)
    data/enemies.js          # Class→loadout resolution
    screens_meta.js          # Hangar + Pilot Record canvas screens
    appBridge.js             # Shared corner-bracket / back-button helpers
    sim/
      state.js               # SimState factories + FEAR/HEAT constants + hunterClockRate
      movement.js            # Road-aware steering, terrain speed, convoy arc-length
      objectives.js          # isTargetAlive, objectiveComplete, canExtract, focus
    render/
      terrain.js             # GPU-blitted terrain grid + grain/mottle/macro overlays
      roads.js               # Hierarchy-aware road overdraw + minimap cache
      hud.js                 # hudPlate, plateHeader, hudBar, offscreen markers
  tools/
    check.mjs                # Gate: lint + meta-check + sortie-smoke
    lint.mjs                 # Zero-dep syntax + invariants + optional eslint
    meta-check.mjs, sortie-smoke.mjs
```

### 4.2 Game Loop

```javascript
// ARCHITECTURE DECISION: Fixed-timestep simulation + decoupled rendering.
// WHY: Simulation must be deterministic regardless of frame rate.
// Rendering can happen at display refresh rate (60 or 120fps).

const SIM_HZ = 60;
const SIM_DT = 1 / SIM_HZ;

class App {
  constructor() {
    this.accum = 0;
    this._last = 0;
    this._raf = null;
    this.speed = 1;
  }
  start() {
    this._last = performance.now();
    const loop = (now) => {
      const rawDt = (now - this._last) / 1000;
      const dt = Math.min(rawDt, 0.05);
      this._last = now;
      this.accum += dt * this.speed;
      let guard = 0;
      while (this.accum >= SIM_DT && guard++ < 8) {
        this.accum -= SIM_DT;
        this.sim.tick();
      }
      this.draw();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }
  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
  }
}
```

### 4.3 Frame Rate Detection

```javascript
let targetFPS = 60;
function detectRefreshRate() {
  if (screen.refreshRate) {
    targetFPS = Math.min(screen.refreshRate, 144);
  }
}
```

### 4.4 Input System

```javascript
// ARCHITECTURE DECISION: Virtual joystick drawn on canvas, not DOM elements.
// WHY: Canvas-drawn controls are resolution-independent, DPR-aware,
// and don't introduce DOM layout thrashing.

class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.moveX = 0;
    this.moveY = 0;
    this.joystickActive = false;
    this.rocket = false;
    this.equipment = false;
    this.keys = {};
  }
  // Touch zones:
  // Left 40% of screen: virtual joystick (move)
  // Right bottom 40%: rocket button + equipment button
  // Right top: minimap tap target
}
```

### 4.5 Entity Factory

```javascript
// ARCHITECTURE DECISION: Single factory function for ALL entities.
// WHY: Data-driven entities mean one function handles creation for
// helicopters, enemies, projectiles, buildings, loot — everything.
// Adding a new entity type = adding a data entry, never new code.

function createEntity(type, x, y, overrides = {}) {
  const template = ENTITY_TEMPLATES[type];
  if (!template) throw new Error(`Unknown entity type: ${type}`);
  return {
    ...template,
    x,
    y,
    vx: 0,
    vy: 0,
    id: nextId++,
    type,
    ...overrides,
  };
}
```

### 4.6 World Bounds

```javascript
// ARCHITECTURE DECISION: Invisible wall at map edges, camera clamps.
// WHY: Clean, consistent behavior. Player cannot fly off the map.
// Camera keeps helicopter in view at all times.

const WORLD_BOUNDS = {
  minX: 0,
  minY: 0,
  maxX: WORLD_SIZE * TILE_SIZE,
  maxY: WORLD_SIZE * TILE_SIZE,
};

function clampToWorld(entity) {
  entity.x = Math.max(WORLD_BOUNDS.minX, Math.min(WORLD_BOUNDS.maxX, entity.x));
  entity.y = Math.max(WORLD_BOUNDS.minY, Math.min(WORLD_BOUNDS.maxY, entity.y));
}
```

### 4.7 Collision Shapes

```javascript
// ARCHITECTURE DECISION: Circles for most entities, AABB for buildings.
// WHY: Circle-vs-circle collision is fast and sufficient for helicopters,
// enemies, and projectiles. AABB is needed for rectangular buildings.

COLLISION_SHAPES = {
  helicopter: { type: 'circle', radius: 8 },
  infantry: { type: 'circle', radius: 4 },
  vehicle: { type: 'aabb', width: 16, height: 20 },
  building: { type: 'aabb', width: null, height: null }, // per-building
  projectile: { type: 'circle', radius: 2 },
};
```

### 4.8 Damage Types

```javascript
// ARCHITECTURE DECISION: Flat HP subtraction for prototype.
// WHY: Armor types add complexity without gameplay benefit at this stage.
// Can be expanded later with kinetic/explosive/fire damage types.

function applyDamage(target, amount) {
  target.hp -= amount;
  if (target.hp <= 0) {
    target.alive = false;
    onEntityDeath(target);
  }
}
```

### 4.9 Settlement Detection Radius

```javascript
// ARCHITECTURE DECISION: Settlements detected at ~80 tiles from player.
// WHY: Gives player time to see settlement on minimap, plan approach,
// and decide whether to engage. Not so far that everything is revealed.

const SETTLEMENT_DETECTION_RADIUS = 80; // tiles
```

### 4.10 Enemy Spawn Timing

```javascript
// ARCHITECTURE DECISION: Enemies generated on discovery, not upfront.
// WHY: Settlement exists but has no enemies until player enters detection
// radius. This means early discovery = easier enemies (lower Infamy).
// Late discovery = tougher enemies (higher Infamy, higher difficulty).

function onSettlementDiscovered(settlement, player, difficulty) {
  settlement.discovered = true;
  settlement.enemies = generateEnemyRoster(settlement.archetype, difficulty, player.infamyLevel);
}
```

---

## 5. RENDERING SYSTEM

### 5.1 Faux-3D Projection (from Tower Defence)

```javascript
// ARCHITECTURE DECISION: Two-factor projection model.
// WHY: A single pitch angle drives ALL 3D effects through two derived factors:
// D (depth factor) = cos(pitch)^1.5 — controls ground plane foreshortening
// V (vertical factor) = 0.72 + 0.92 * sin(pitch) — controls height dimensions

const VIEW25 = {
  pitchDeg: 24,
  trap: 0.42,
  yScale: 0.79,
  farScale: 0.62,
  nearScale: 1,
  deckRatio: 0.79,
  shadowSkew: 0.02,
  boxSkew: 0.14,
  rise: 0.24,
  vExag: 1.09,
  depthFog: 0.22,
};

// Key methods:
// project(boardLocal) -> screenPoint{ x, y, s }
// groundBasis(angle) -> { ax, ay, px, py, len, depth }
// capEllipse(basis, r) -> ellipse params
```

### 5.2 Drawing Primitives (from Tower Defence)

```javascript
cyl25(ctx, camera, params); // Cylinder (helicopter body, buildings)
box25(ctx, camera, params); // Box with 3 visible faces (vehicles)
frustum25(ctx, camera, params); // Tapered cylinder (turrets)
diamondPrism25(ctx, camera, params); // Diamond prism (tents)
ring25(ctx, camera, params); // Ground-plane ring (craters)
vz(s, k); // Vertical measure scaled by pitch factor
```

### 5.3 Color/Material System (from Tower Defence)

```javascript
shade(hex, amount); // Brighten (+) or darken (-) hex color
withAlpha(hex, a); // Convert hex to rgba string
matsFrom(col); // Returns { top, topHi, side, sideDark, sideDeep, rim, accent }
hash21(x, y); // Deterministic noise per tile
roundRect(ctx, x, y, w, h, r); // Rounded rectangle path
facePoly(ctx, points); // Polygon from point array
```

### 5.4 Particle/VFX System (from Tower Defence)

```javascript
class FxSystem {
  constructor(maxParticles = 500) {
    this.items = [];
    this.maxParticles = maxParticles;
  }
  hit(x, y, type)                  // Impact VFX
  muzzle(x, y, angle, type)        // Muzzle flash + sparks
  damageNumber(x, y, amount, type) // Floating damage text
  chain(x0, y0, x1, y1)           // Lightning bolt
  death(x, y, kind, armorKind)     // Enemy death VFX
  tick(dt)                         // Update all particles
  drawProjected(ctx, cam, colorFn) // Draw via camera.project()
}
// Object pool pattern: swap-and-pop removal for O(1) deletes
```

### 5.5 Rendering Pipeline (Per Frame)

```
1. Clear canvas (full viewport fill)
2. Camera transform:
   ctx.save()
   ctx.translate(-camera.x + canvas.width/2, -camera.y + canvas.height/2)
   ctx.scale(camera.zoom, camera.zoom)
3. Render terrain chunks (cached offscreen canvases)
4. Render settlement buildings (sorted by Y for depth)
5. Render ground enemies (sorted by Y)
6. Render helicopter
7. Render projectiles (bullets, rockets)
8. Render VFX/particles (explosions, trails, damage numbers)
9. ctx.restore()
10. Render minimap (bottom-right corner)
11. Render HUD overlay (HP, Infamy, rocket ammo, equipment cooldown)
12. Render screen-edge effects (boss direction arrow, low HP vignette)
```

### 5.6 Responsive Scaling

```javascript
function resizeCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  canvas.logicalWidth = w;
  canvas.logicalHeight = h;
}
```

---

## 6. WORLD GENERATION

### 6.1 Terrain System

```javascript
// ARCHITECTURE DECISION: Tile-based terrain with chunk caching.
// WHY: Tiles are simple to generate, render, and query for collision/pathfinding.
// Chunks cache rendered output to offscreen canvases.

const TILE_SIZE = 32;
const CHUNK_SIZE = 32;
const WORLD_SIZE = 500; // tiles per axis
const CHUNKS_PER_AXIS = Math.ceil(WORLD_SIZE / CHUNK_SIZE); // ~16
```

### 6.2 Terrain Types

```javascript
const TERRAIN = {
  SAND: { id: 0, color: '#d4a76a', speedMod: 1.0 },
  HARDPACK: { id: 1, color: '#c4975a', speedMod: 1.0 },
  ROCK: { id: 2, color: '#8b7355', speedMod: 0.8 },
  ROAD: { id: 3, color: '#6b5b4a', speedMod: 1.3 },
  WADI: { id: 4, color: '#7a9bb5', speedMod: 0.5 },
  OASIS: { id: 5, color: '#4a8b5a', speedMod: 0.7 },
  DUNES: { id: 6, color: '#e8c88a', speedMod: 0.6 },
};
```

### 6.3 Terrain Generation Algorithm

```
Step 1: Generate elevation noise (3 octaves, seeded)
Step 2: Map elevation to terrain type
  - < 0.2: WADI (dry riverbeds)
  - 0.2-0.4: HARDPACK (flat desert floor)
  - 0.4-0.6: SAND (standard desert)
  - 0.6-0.8: DUNES (rolling sand dunes)
  - > 0.8: ROCK (mountain ridges)
Step 3: Post-process
  - Carve roads between settlements
  - Place oases at wadi intersections
  - Smooth terrain transitions
  - Ensure world center is always HARDPACK (spawn point)
Step 4: Cache each chunk to offscreen canvas
```

---

## 7. SETTLEMENT GENERATION

### 7.1 Settlement Archetypes

Settlements are NOT rigid templates. They emerge from a **rule-based procedural system**.

```javascript
ARCHETYPES = {
  rural: {
    name: 'Rural Settlement',
    buildingCount: [1, 5],
    enemyCount: [1, 8],
    enemyComposition: { unarmed: 0.7, rifleman: 0.25, rocketeer: 0.05 },
    buildingTypes: ['hovel', 'shed', 'pen', 'well'],
    layoutRules: { spacing: [1, 3], organic: true, roads: false, clustering: 0.3 },
    fearReward: [5, 15],
    dollarReward: [10, 50],
    clearBonus: [5, 10],
  },

  town: {
    name: 'Town',
    buildingCount: [6, 20],
    enemyCount: [10, 40],
    enemyComposition: { unarmed: 0.5, rifleman: 0.35, rocketeer: 0.15 },
    buildingTypes: ['house', 'shop', 'market', 'mosque', 'apartment'],
    layoutRules: {
      spacing: [1, 2],
      organic: false,
      roads: true,
      clustering: 0.6,
      coreBuilding: ['mosque', 'market'],
    },
    fearReward: [20, 60],
    dollarReward: [50, 200],
    clearBonus: [10, 25],
  },

  camp: {
    name: 'Military Camp',
    buildingCount: [3, 8],
    enemyCount: [5, 15],
    enemyComposition: { unarmed: 0, rifleman: 0.6, rocketeer: 0.4 },
    buildingTypes: ['tent', 'commandTent', 'watchtower', 'vehicleBay', 'sandbagWall'],
    layoutRules: {
      spacing: [1, 2],
      organic: false,
      roads: false,
      perimeter: true,
      center: 'commandTent',
    },
    fearReward: [15, 40],
    dollarReward: [30, 120],
    clearBonus: [8, 15],
  },

  base: {
    name: 'Military Base',
    buildingCount: [8, 30],
    enemyCount: [20, 80],
    enemyComposition: {
      unarmed: 0,
      rifleman: 0.4,
      rocketeer: 0.3,
      technical: 0.15,
      aa_gun: 0.1,
      artillery: 0.05,
    },
    buildingTypes: [
      'bunker',
      'commandCenter',
      'barracks',
      'hangar',
      'ammoDump',
      'radarDish',
      'motorPool',
    ],
    layoutRules: {
      spacing: [1, 1],
      organic: false,
      roads: true,
      perimeter: true,
      grid: true,
      gate: true,
    },
    fearReward: [40, 120],
    dollarReward: [100, 500],
    clearBonus: [20, 50],
  },

  fuelDepot: {
    name: 'Fuel Depot',
    buildingCount: [3, 8],
    enemyCount: [5, 20],
    enemyComposition: { unarmed: 0.1, rifleman: 0.5, rocketeer: 0.4 },
    buildingTypes: ['fuelTank', 'storageShed', 'guardTower', 'pipeNetwork'],
    layoutRules: { spacing: [2, 4], organic: false, roads: true, explosive: true },
    fearReward: [10, 30],
    dollarReward: [20, 80],
    clearBonus: [5, 12],
    specialMechanic: 'fuelDepot',
  },
};
```

### 7.2 Building Definitions

```javascript
BUILDINGS = {
  hovel: { width: 2, height: 2, hp: 10, destructible: true },
  mosque: { width: 4, height: 4, hp: 30, destructible: true },
  fuelTank: {
    width: 2,
    height: 2,
    hp: 15,
    destructible: true,
    explosive: true,
    explosionRadius: 60,
    explosionDamage: 50,
    onDeath: 'extendBossTimer',
  },
  watchtower: { width: 1, height: 1, hp: 20, destructible: true, spawnsEnemy: 'rocketeer' },
  commandCenter: {
    width: 3,
    height: 3,
    hp: 40,
    destructible: true,
    highPriority: true,
    timerBonus: 30,
  },
  radarDish: {
    width: 2,
    height: 2,
    hp: 25,
    destructible: true,
    highPriority: true,
    timerBonus: 30,
  },
  bunker: { width: 3, height: 3, hp: 60, destructible: true },
  barracks: { width: 4, height: 3, hp: 35, destructible: true },
  hangar: { width: 5, height: 4, hp: 45, destructible: true },
  ammoDump: {
    width: 2,
    height: 2,
    hp: 20,
    destructible: true,
    explosive: true,
    explosionRadius: 80,
    explosionDamage: 80,
  },
  tent: { width: 2, height: 2, hp: 8, destructible: true },
  commandTent: { width: 3, height: 3, hp: 15, destructible: true, highPriority: true },
  sandbagWall: { width: 1, height: 1, hp: 25, destructible: true },
  motorPool: { width: 4, height: 3, hp: 30, destructible: true },
  storageShed: { width: 2, height: 2, hp: 12, destructible: true },
  pipeNetwork: { width: 1, height: 1, hp: 8, destructible: true },
  vehicleBay: { width: 3, height: 3, hp: 20, destructible: true },
  house: { width: 2, height: 2, hp: 15, destructible: true },
  shop: { width: 2, height: 2, hp: 12, destructible: true },
  market: { width: 3, height: 3, hp: 20, destructible: true },
  apartment: { width: 3, height: 4, hp: 30, destructible: true },
  well: { width: 1, height: 1, hp: 10, destructible: true },
  pen: { width: 2, height: 2, hp: 5, destructible: true },
  shed: { width: 1, height: 1, hp: 8, destructible: true },
};
```

### 7.3 Settlement Placement Algorithm

```
1. Generate 15-25 settlement positions on the map
   - Avoid water/wadi tiles
   - Minimum 30-tile gap between settlements
   - More settlements toward center (density falloff from center)

2. Assign archetype based on distance from center:
   - 0-50 tiles:  rural only
   - 50-100 tiles: rural + camp
   - 100-200 tiles: town + camp
   - 200-300 tiles: base + fuel depot appear
   - 300+ tiles: all types, max difficulty

3. Generate settlement contents on DISCOVERY (not upfront):
   - When player enters detection radius (~80 tiles)
   - Enemy roster generated at discovery time
   - Scaled by distance, Infamy level, and pilot level
```

### 7.4 Settlement Procedural Layout Generation

```
Pass 1: Skeleton
  - Place core building(s) first
  - For grid layouts: generate road grid
  - For organic layouts: Poisson disk sampling
  - Place perimeter structures if applicable

Pass 2: Fill
  - Fill remaining space with secondary buildings
  - Apply density falloff (denser near center)
  - Add props (fences, crates, vehicles as decoration)
  - Place enemy spawn points
```

---

## 8. GUNSHIPS

### 8.1 Gunship Progression

5 real historical gunships. Each is an objective upgrade over the previous. Higher-tier gunships are plainly superior in every way when fully upgraded.

| #   | Gunship          | Year | Unlock          | Role                                                   |
| --- | ---------------- | ---- | --------------- | ------------------------------------------------------ |
| 1   | AH-1 Cobra       | 1967 | Start game      | Light attack — fast, agile, limited weapons            |
| 2   | AH-1W SuperCobra | 1986 | Reach Act 2     | Medium attack — twin engines, more hardpoints          |
| 3   | AH-64 Apache     | 1986 | Reach Act 3     | Heavy attack — chain gun, Hellfire, devastating        |
| 4   | AH-64D Longbow   | 1997 | Reach Act 4     | Advanced attack — mast-mounted radar, fire-and-forget  |
| 5   | RAH-66 Comanche  | 1996 | Beat final boss | Stealth — experimental, cutting-edge, ultimate gunship |

### 8.2 Gunship Base Stats

```javascript
GUNSHIPS = {
  cobra: {
    name: 'AH-1 Cobra',
    year: 1967,
    description:
      'Light attack helicopter. First purpose-built gunship. Fast and agile but lightly armed.',
    stats: {
      hp: 150,
      maxHp: 150,
      speed: 260,
      handling: 1.1, // turn rate multiplier
      armor: 1.0, // damage multiplier received (lower = better)
      weaponSlots: 1,
      rocketCapacity: 8,
    },
    // Rendering: narrow attack profile, weapon pods on sides, 2-blade rotor
  },

  supercobra: {
    name: 'AH-1W SuperCobra',
    year: 1986,
    description: 'Medium attack helicopter. Twin engines, more weapons, more armor.',
    stats: {
      hp: 220,
      maxHp: 220,
      speed: 240,
      handling: 1.0,
      armor: 0.9,
      weaponSlots: 2,
      rocketCapacity: 14,
    },
    // Rendering: wider than Cobra, twin exhaust, 4-blade main rotor
  },

  apache: {
    name: 'AH-64 Apache',
    year: 1986,
    description: 'Heavy attack helicopter. The definitive modern gunship. Chain gun + Hellfire.',
    stats: {
      hp: 300,
      maxHp: 300,
      speed: 220,
      handling: 0.9,
      armor: 0.8,
      weaponSlots: 3,
      rocketCapacity: 16,
    },
    // Rendering: angular, aggressive, larger, chain gun under nose
  },

  longbow: {
    name: 'AH-64D Longbow',
    year: 1997,
    description: 'Apache with mast-mounted radar. Fire-and-forget Hellfire missiles.',
    stats: {
      hp: 320,
      maxHp: 320,
      speed: 215,
      handling: 0.9,
      armor: 0.75,
      weaponSlots: 3,
      rocketCapacity: 18,
    },
    // Rendering: Apache + dome radar on mast
  },

  comanche: {
    name: 'RAH-66 Comanche',
    year: 1996,
    description: 'Stealth reconnaissance/attack helicopter. The ultimate gunship.',
    stats: {
      hp: 280,
      maxHp: 280,
      speed: 280,
      handling: 1.2,
      armor: 0.7,
      weaponSlots: 4,
      rocketCapacity: 20,
    },
    // Rendering: stealth faceted body, internal weapons bay, 5-blade bearingless rotor
  },
};
```

### 8.3 Gunship Upgrade Trees

Per-gunship upgrades. Shared categories, different specific parts. Each gunship has **6 upgrade slots** with **2 levels each** = 12 upgrades per starter gunship. New gunships add 1 new slot.

```javascript
// Cobra (starter) — 6 slots x 2 levels = 12 upgrades
COBRA_UPGRADES = {
  engine: {
    name: 'Engine',
    levels: [
      { cost: 100, effect: { speed: +10, handling: +0.02 } }, // Turbine
      { cost: 250, effect: { speed: +20, handling: +0.05 } }, // Upgraded Turbine
    ],
  },
  armor: {
    name: 'Armor',
    levels: [
      { cost: 150, effect: { hp: +20, armor: -0.05 } }, // Skid Plates
      { cost: 350, effect: { hp: +40, armor: -0.1 } }, // Ballistic Armor
    ],
  },
  weaponMount: {
    name: 'Weapon Mount',
    levels: [
      { cost: 200, effect: { weaponSlots: +1 } }, // Pod Rail
      { cost: 500, effect: { weaponSlots: +1 } }, // Dual Rail
    ],
  },
  rotor: {
    name: 'Rotor',
    levels: [
      { cost: 120, effect: { handling: +0.05 } }, // 2-Blade Improved
      { cost: 300, effect: { handling: +0.1 } }, // 4-Blade Retrofit
    ],
  },
  fuel: {
    name: 'Fuel Tank',
    levels: [
      { cost: 100, effect: {/* extends boss timer bonus */} }, // Standard
      { cost: 250, effect: {/* extends boss timer bonus */} }, // Extended
    ],
  },
  countermeasures: {
    name: 'Countermeasures',
    levels: [
      { cost: 200, effect: {/* flare capacity +1 */} }, // Flare Dispenser
      { cost: 500, effect: {/* flare capacity +2 */} }, // Advanced CM
    ],
  },
};

// SuperCobra adds: Twin Engine slot
// Apache adds: Chain Gun Upgrade slot
// Longbow adds: Radar System slot
// Comanche adds: Stealth Coating slot
```

### 8.4 Gunship Rendering

```
All gunships procedurally drawn using 2D primitives:

Cobra: narrow body (box25), weapon pods (small box25 on sides),
       2-blade rotor (rotating line), tail boom, chin turret

SuperCobra: wider body, twin exhaust pipes, 4-blade rotor,
            external weapon pylons

Apache: angular body, chain gun under nose (frustum25),
        Hellfire pods on stub wings, 4-blade rotor,
        nose-mounted sensor turret

Longbow: Apache + dome radar on mast (cyl25 on top)

Comanche: faceted stealth body (angular box25), internal weapons bay,
          5-blade bearingless rotor (faster spin), tail fenestron

All use matsFrom() for material shading. Shadow: dark ellipse on ground.
Rotation: body rotates to face movement direction.
Tilt: slight forward lean when moving fast.
```

---

## 9. WEAPON SYSTEM

### 9.1 Primary Weapon (Auto-fire)

```
ARCHITECTURE DECISION: Single evolving weapon, not slot-based loadouts.
WHY: Vampire Survivors' depth comes from one weapon that transforms.
The player doesn't manage inventory — they make upgrade choices.
This keeps the action fast and the decision-making interesting.

The primary weapon auto-fires at the nearest enemy within range.
It starts as a simple gun shooting weak bullets forward.
Through Infamy upgrades, it evolves into something devastating.
```

### 9.2 Weapon State

```javascript
weaponState = {
  damage: 10,
  fireRate: 3, // shots per second
  bulletSpeed: 400,
  burstCount: 1,
  burstDelay: 0.06,
  barrels: 1,
  spreadAngle: 0.15,
  spreadType: 'forward', // 'forward' | 'radial' | 'cone'
  pierce: 0,
  explosive: false,
  explosiveRadius: 0,
  homing: false,
  homingStrength: 0,
  chainLightning: false,
  chainCount: 0,
  chainRange: 0,
  napalmTrail: false,
  napalmDuration: 0,
  napalmDamage: 0,
  ricochet: false,
  ricochetCount: 0,
  appliedUpgrades: new Set(),
};
```

### 9.3 Weapon Upgrade Pool

```javascript
WEAPON_UPGRADES = {
  // === TIER 1 (Common) ===
  damage_up: { name: 'AP Rounds', desc: '+25% damage', tier: 1, apply: (w) => (w.damage *= 1.25) },
  fire_rate_up: {
    name: 'Rapid Fire',
    desc: '+20% fire rate',
    tier: 1,
    apply: (w) => (w.fireRate *= 1.2),
  },
  burst_2: {
    name: 'Double Tap',
    desc: 'Fire 2 rounds in burst',
    tier: 1,
    apply: (w) => {
      w.burstCount = 2;
      w.burstDelay = 0.05;
    },
  },
  double_barrel: {
    name: 'Dual Barrel',
    desc: '2 barrels side-by-side',
    tier: 1,
    apply: (w) => (w.barrels += 1),
  },
  spread_narrow: {
    name: 'Tight Spread',
    desc: 'Narrower spread',
    tier: 1,
    apply: (w) => (w.spreadAngle *= 0.6),
  },
  spread_wide: {
    name: 'Wide Spread',
    desc: 'Wider spread, more coverage',
    tier: 1,
    apply: (w) => {
      w.spreadAngle *= 1.5;
      w.damage *= 0.85;
    },
  },
  pierce_1: {
    name: 'Armor Piercing',
    desc: 'Bullets pierce 1 enemy',
    tier: 1,
    apply: (w) => (w.pierce += 1),
  },

  // === TIER 2 (Uncommon — requires T1 prereq) ===
  damage_up_2: {
    name: 'HE Rounds',
    desc: '+50% damage',
    tier: 2,
    prereq: 'damage_up',
    apply: (w) => (w.damage *= 1.5),
  },
  fire_rate_up_2: {
    name: 'Minigun Barrel',
    desc: '+40% fire rate',
    tier: 2,
    prereq: 'fire_rate_up',
    apply: (w) => (w.fireRate *= 1.4),
  },
  burst_3: {
    name: 'Triple Burst',
    desc: '3 rounds in burst',
    tier: 2,
    prereq: 'burst_2',
    apply: (w) => {
      w.burstCount = 3;
      w.burstDelay = 0.04;
    },
  },
  triple_barrel: {
    name: 'Tri-Barrel',
    desc: '3 barrels',
    tier: 2,
    prereq: 'double_barrel',
    apply: (w) => (w.barrels = 3),
  },
  pierce_2: {
    name: 'Depleted Uranium',
    desc: 'Bullets pierce 2 enemies',
    tier: 2,
    prereq: 'pierce_1',
    apply: (w) => (w.pierce += 1),
  },
  explosive_rounds: {
    name: 'Explosive Rounds',
    desc: 'Bullets explode on hit (AoE)',
    tier: 2,
    apply: (w) => {
      w.explosive = true;
      w.explosiveRadius = 30;
    },
  },
  homing: {
    name: 'Homing Rounds',
    desc: 'Bullets curve toward enemies',
    tier: 2,
    apply: (w) => {
      w.homing = true;
      w.homingStrength = 2;
    },
  },
  ricochet: {
    name: 'Ricochet',
    desc: 'Bullets bounce to 1 enemy',
    tier: 2,
    apply: (w) => {
      w.ricochet = true;
      w.ricochetCount = 1;
    },
  },

  // === TIER 3 (Rare — requires T2 prereq) ===
  spread_360: {
    name: 'Ring of Death',
    desc: 'Bullets fire in all directions',
    tier: 3,
    prereq: 'spread_wide',
    apply: (w) => {
      w.spreadType = 'radial';
      w.spreadAngle = Math.PI * 2;
    },
  },
  chain_lightning: {
    name: 'Chain Lightning',
    desc: 'Bullets arc to nearby enemies',
    tier: 3,
    apply: (w) => {
      w.chainLightning = true;
      w.chainCount = 2;
      w.chainRange = 60;
    },
  },
  napalm_trail: {
    name: 'Napalm Trail',
    desc: 'Bullets leave burning trail',
    tier: 3,
    apply: (w) => {
      w.napalmTrail = true;
      w.napalmDuration = 2;
      w.napalmDamage = 5;
    },
  },
};
```

### 9.4 Level-Up Card Selection

```javascript
// ARCHITECTURE DECISION: Game pauses during level-up selection.
// WHY: The pause creates a moment of calm amid chaos, letting the player
// read and think about choices. Auto-fire stops, enemies freeze.

function generateUpgradeChoices(weaponState, infamyLevel) {
  const pool = Object.entries(WEAPON_UPGRADES).filter(([key, up]) => {
    if (up.prereq && !weaponState.appliedUpgrades.has(up.prereq)) return false;
    if (weaponState.appliedUpgrades.has(key) && !up.stackable) return false;
    return true;
  });

  const weighted = pool.map(([key, up]) => {
    let weight = 1;
    if (up.tier === 1) weight = 6;
    if (up.tier === 2) weight = 3;
    if (up.tier === 3) weight = 1;
    weight *= 1 + infamyLevel * 0.05 * up.tier;
    return { key, upgrade: up, weight };
  });

  return weightedRandomSample(weighted, 3);
}
```

### 9.5 Secondary Weapon (Rockets)

```javascript
ROCKET_TYPES = {
  dumbfire: {
    name: 'Unguided Rockets',
    damage: 80,
    speed: 350,
    radius: 40,
    ammoPerPickup: 4,
    behavior: 'straight',
  },
  guided: {
    name: 'Guided Missiles',
    damage: 50,
    speed: 250,
    radius: 35,
    ammoPerPickup: 6,
    behavior: 'lockOn',
    lockRange: 300,
    turnRate: 4,
  },
  area: {
    name: 'Cluster Rockets',
    damage: 25,
    speed: 300,
    radius: 120,
    ammoPerPickup: 3,
    behavior: 'area',
    submunitions: 8,
  },
};
```

---

## 10. ENEMY SYSTEM

### 10.1 Enemy Types (15 Core Types)

The full enemy dossier is in Appendix B. Here are the 15 core "must-have" types for the prototype:

```javascript
ENEMY_TYPES = {
  // === TIER 0: ORDINARY INFANTRY ===
  rifleman: {
    name: 'Rifleman',
    hp: 30,
    speed: 35,
    damage: 3,
    fireRate: 0.5,
    range: 150,
    fearWeight: 2,
    dollarWeight: 2,
    armed: true,
    weapon: 'rifle',
    behavior: 'guard',
    render: { radius: 4, color: '#6b4914' },
  },
  assaultRifle: {
    name: 'Assault Rifle Soldier',
    hp: 25,
    speed: 40,
    damage: 2,
    fireRate: 1.5,
    range: 140,
    fearWeight: 2,
    dollarWeight: 2,
    armed: true,
    weapon: 'assault_rifle',
    behavior: 'patrol',
    render: { radius: 4, color: '#5b4914' },
  },
  mgTeam: {
    name: 'Machine Gun Team',
    hp: 40,
    speed: 25,
    damage: 5,
    fireRate: 2,
    range: 200,
    fearWeight: 4,
    dollarWeight: 4,
    armed: true,
    weapon: 'lmg',
    behavior: 'guard',
    render: { radius: 5, color: '#4a3a2a' },
  },
  hmg: {
    name: 'Heavy Machine Gun',
    hp: 50,
    speed: 0,
    damage: 8,
    fireRate: 1.5,
    range: 300,
    fearWeight: 6,
    dollarWeight: 6,
    armed: true,
    weapon: 'hmg',
    behavior: 'fixed',
    render: { radius: 6, color: '#3a3a3a' },
  },

  // === TIER 1: LIGHT AA ===
  lightAA: {
    name: 'Light AA Gun',
    hp: 60,
    speed: 0,
    damage: 6,
    fireRate: 3,
    range: 280,
    fearWeight: 8,
    dollarWeight: 8,
    armed: true,
    weapon: 'aa_light',
    behavior: 'fixed',
    airThreat: true,
    threatRadius: 150,
    render: { radius: 7, color: '#3a3a3a' },
  },
  twin23: {
    name: 'Twin 23mm AA',
    hp: 80,
    speed: 0,
    damage: 12,
    fireRate: 4,
    range: 250,
    fearWeight: 10,
    dollarWeight: 10,
    armed: true,
    weapon: 'aa_23mm',
    behavior: 'fixed',
    airThreat: true,
    threatRadius: 180,
    render: { radius: 8, color: '#2a2a2a' },
  },

  // === TIER 2: MAN-PORTABLE MISSILES ===
  manpads: {
    name: 'MANPADS Team',
    hp: 25,
    speed: 30,
    damage: 30,
    fireRate: 0.1,
    range: 350,
    fearWeight: 12,
    dollarWeight: 12,
    armed: true,
    weapon: 'missile_manpad',
    behavior: 'ambush',
    airThreat: true,
    threatRadius: 200,
    render: { radius: 4, color: '#5b3914' },
  },

  // === TIER 3: HEAVY AA ===
  shilka: {
    name: 'Shilka (ZSU-23-4)',
    hp: 150,
    speed: 45,
    damage: 15,
    fireRate: 6,
    range: 250,
    fearWeight: 15,
    dollarWeight: 15,
    armed: true,
    weapon: 'aa_shilka',
    behavior: 'mobile_defense',
    airThreat: true,
    threatRadius: 220,
    render: { radius: 10, color: '#2a2a2a' },
  },
  heavyAA: {
    name: 'Heavy 57mm AA',
    hp: 200,
    speed: 0,
    damage: 40,
    fireRate: 0.5,
    range: 400,
    fearWeight: 18,
    dollarWeight: 18,
    armed: true,
    weapon: 'aa_57mm',
    behavior: 'fixed',
    airThreat: true,
    threatRadius: 300,
    render: { radius: 12, color: '#1a1a1a' },
  },

  // === TIER 4: MOBILE SAM ===
  mobileSAM: {
    name: 'Mobile SAM',
    hp: 120,
    speed: 40,
    damage: 50,
    fireRate: 0.15,
    range: 500,
    fearWeight: 20,
    dollarWeight: 20,
    armed: true,
    weapon: 'missile_sam',
    behavior: 'mobile_defense',
    airThreat: true,
    threatRadius: 400,
    render: { radius: 10, color: '#2a3a2a' },
  },

  // === TIER 5: VEHICLES ===
  tank: {
    name: 'Main Battle Tank',
    hp: 250,
    speed: 30,
    damage: 25,
    fireRate: 0.3,
    range: 300,
    fearWeight: 12,
    dollarWeight: 15,
    armed: true,
    weapon: 'main_gun',
    behavior: 'escort',
    render: { radius: 12, color: '#2a2a2a' },
  },
  apc: {
    name: 'Armored Personnel Carrier',
    hp: 120,
    speed: 50,
    damage: 5,
    fireRate: 1,
    range: 200,
    fearWeight: 6,
    dollarWeight: 8,
    armed: true,
    weapon: 'mounted_gun',
    behavior: 'patrol',
    render: { radius: 10, color: '#3a3a2a' },
  },
  technical: {
    name: 'Technical (Gun Truck)',
    hp: 60,
    speed: 70,
    damage: 4,
    fireRate: 2,
    range: 180,
    fearWeight: 4,
    dollarWeight: 5,
    armed: true,
    weapon: 'mounted_gun',
    behavior: 'patrol',
    render: { radius: 8, color: '#4a3a2a' },
  },

  // === TIER 6: AIR ===
  attackHeli: {
    name: 'Enemy Attack Helicopter',
    hp: 180,
    speed: 120,
    damage: 15,
    fireRate: 2,
    range: 300,
    fearWeight: 20,
    dollarWeight: 25,
    armed: true,
    weapon: 'air_cannon',
    behavior: 'air_interceptor',
    render: { radius: 10, color: '#555555' },
  },
  fighter: {
    name: 'Enemy Fighter',
    hp: 100,
    speed: 300,
    damage: 40,
    fireRate: 4,
    range: 350,
    fearWeight: 25,
    dollarWeight: 30,
    armed: true,
    weapon: 'air_cannon',
    behavior: 'air_interceptor',
    render: { radius: 8, color: '#666666' },
  },
};
```

### 10.2 AI Behavior Classes (8 Classes)

| Class | Name            | Examples                                  | Behavior                                                |
| ----- | --------------- | ----------------------------------------- | ------------------------------------------------------- |
| **A** | Guard           | Rifleman, MG Team, checkpoint guard       | Stay near position, react to helicopter, seek cover     |
| **B** | Patrol          | Assault Rifle, gun truck, scout vehicle   | Follow route, investigate disturbances, return to route |
| **C** | Ambush          | MANPADS team, RPG team, HMG               | Hide, wait, attack, relocate                            |
| **D** | Mobile Defense  | Shilka, mobile SAM, armored AA truck      | Follow formation, stop, engage, relocate                |
| **E** | Fixed Defense   | S-60 battery, AA battery, SAM site, radar | Never move, track targets, engage inside zone           |
| **F** | Escort          | Tank, APC, AA vehicle                     | Protect high-value units                                |
| **G** | Reinforcement   | Transport helicopter, troop truck         | Enter battlefield, deploy, withdraw                     |
| **H** | Air Interceptor | Attack helicopter, fighter                | Enter combat, attack, disengage, potentially return     |

### 10.3 AI Behavior Code

```javascript
AI_BEHAVIORS = {
  guard: (enemy, heli) => {
    const dx = heli.x - enemy.x;
    const dy = heli.y - enemy.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    enemy.angle = Math.atan2(dy, dx);
    if (dist <= enemy.range && enemy.fireCooldown <= 0) {
      fireAt(enemy, heli);
      enemy.fireCooldown = 1 / enemy.fireRate;
    }
  },

  patrol: (enemy, heli) => {
    // Follow waypoints, engage helicopter if in range
    // Similar to guard but follows patrol route
  },

  ambush: (enemy, heli) => {
    // Hidden until helicopter enters threat radius
    // Fires immediately, then relocates
    const dx = heli.x - enemy.x;
    const dy = heli.y - enemy.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= enemy.threatRadius && !enemy.engaged) {
      enemy.engaged = true;
      fireAt(enemy, heli); // immediate first shot
      enemy.fireCooldown = 1 / enemy.fireRate;
    }
    if (enemy.engaged) {
      // After firing, relocate
      if (enemy.fireCooldown <= 0) {
        relocate(enemy);
      }
    }
  },

  mobile_defense: (enemy, heli) => {
    // Follow formation, stop to engage, relocate after firing
    const dx = heli.x - enemy.x;
    const dy = heli.y - enemy.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= enemy.range) {
      // Stop and engage
      enemy.vx = 0;
      enemy.vy = 0;
      enemy.angle = Math.atan2(dy, dx);
      if (enemy.fireCooldown <= 0) {
        fireAt(enemy, heli);
        enemy.fireCooldown = 1 / enemy.fireRate;
        enemy.relocateTimer = 3; // relocate after 3 seconds
      }
    } else {
      // Move toward engagement range
      enemy.vx = (dx / dist) * enemy.speed * 0.5;
      enemy.vy = (dy / dist) * enemy.speed * 0.5;
    }
  },

  fixed: (enemy, heli) => {
    // Never move. Track and engage.
    const dx = heli.x - enemy.x;
    const dy = heli.y - enemy.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    enemy.angle = Math.atan2(dy, dx);
    if (dist <= enemy.range && enemy.fireCooldown <= 0) {
      fireAt(enemy, heli);
      enemy.fireCooldown = 1 / enemy.fireRate;
    }
  },

  escort: (enemy, heli) => {
    // Stay near assigned high-value unit
    // Engage helicopter if it approaches
  },

  reinforcement: (enemy, heli) => {
    // Enter battlefield from edge, deploy troops, withdraw
  },

  air_interceptor: (enemy, heli) => {
    // Fly past helicopter in a line, shooting during flyby
    // Then circle around for another pass
    const dx = heli.x - enemy.x;
    const dy = heli.y - enemy.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= enemy.range && enemy.fireCooldown <= 0) {
      fireAt(enemy, heli);
      enemy.fireCooldown = 1 / enemy.fireRate;
    }
    // Flyby pattern: approach, attack, disengage, return
  },
};
```

### 10.4 Air Defense Bubble System

Every serious AA unit has an invisible threat radius. NOT shown on minimap. Player learns through gameplay cues.

| Unit       | Threat Radius    | Cues                                             |
| ---------- | ---------------- | ------------------------------------------------ |
| HMG        | Small (100)      | Tracer fire direction                            |
| Light AA   | Medium (150)     | Wall of tracer fire                              |
| Twin 23mm  | Medium (180)     | Cannon flash, heavy tracers                      |
| Shilka     | Large (220)      | Radar tracking sound, sweeping tracers           |
| Heavy 57mm | Large (300)      | Heavy thumping report, explosions                |
| MANPADS    | Medium (200)     | Missile launch smoke trail (hidden until firing) |
| Mobile SAM | Very Large (400) | Missile warning alarm                            |

### 10.5 Convoy/Patrol System

Convoys drive between settlements on roads. Supply convoys have supply trucks. Patrols are infantry squads.

```javascript
CONVOY_TYPES = {
  supply: {
    name: 'Supply Convoy',
    composition: [
      { type: 'technical', count: 1 }, // escort
      { type: 'apc', count: 1 }, // escort
      { type: 'truck', count: 2 }, // supply trucks (loot)
      { type: 'rifleman', count: 4 }, // infantry
    ],
    speed: 30,
    lootBonus: 1.5, // better loot from supply trucks
  },
  patrol: {
    name: 'Patrol',
    composition: [
      { type: 'rifleman', count: 4 },
      { type: 'assaultRifle', count: 2 },
      { type: 'mgTeam', count: 1 },
    ],
    speed: 25,
  },
  armored: {
    name: 'Armored Column',
    composition: [
      { type: 'tank', count: 1 },
      { type: 'apc', count: 2 },
      { type: 'shilka', count: 1 },
      { type: 'rifleman', count: 6 },
    ],
    speed: 20,
  },
};
```

---

## 11. BOSS SYSTEM

### 11.1 Boss Timer Mechanic

```
ARCHITECTURE DECISION: Real-time countdown timer, ACCELERATED by settlement
clears, EXTENDED by fuel depot destruction.
WHY: This creates a beautiful risk/reward tension:
  - Clearing settlements = faster boss (but you get loot/XP/Infamy)
  - Destroying fuel depots = more time (but they're guarded)
  - Infamy level = stronger boss (more bodyguards, +5% HP per level)
  - Jammer upgrade = longer base timer (meta-progression)

TIMER FORMULA:
  remainingTime = baseTime + jammerBonus + fuelBonus - settlementPenalty
```

### 11.2 Timer Values

```javascript
BOSS_TIMER = {
  baseTime: 180,
  jammerBonus: 60,
  maxJammerLevel: 3,

  clearPenalties: { rural: 15, town: 30, camp: 20, base: 45 },
  fuelTankBonus: 20,
  fuelTankerBonus: 10,
  commandBuildingBonus: 30,
  radarTowerBonus: 30,

  bossSpawnDistance: 80,
  bossWarningTime: 5,
};
```

> **Shipped (2026-08):** Timer is now `Hunter ETA` driven by `hunterClockRate()` in `js/sim/state.js`:
> `clockRate = (0.72 + heat/100*1.18) * difficulty.hunterEtaMultiplier * style.hunterRateMultiplier`
> `timeRemaining -= dt * clockRate`. `baseTime` and `fuelTankBonus` are live; `clearPenalties` now feed Heat (see `js/app.js:applyClearPenalty`) not direct subtraction. Jammer/radar bonuses are legacy (not wired). `bossWarningTime 5s` unchanged. `TIMER` table in `js/config.js` is annotated legacy/live.

### 11.3 Boss Spawning

```javascript
// ARCHITECTURE DECISION: Boss spawns from nearest map edge, fixed distance
// from player, with directional warning arrow.

function spawnBoss(player, worldSize) {
  const angle = Math.atan2(player.y - worldCenter.y, player.x - worldCenter.x);
  const spawnDist = worldSize * TILE_SIZE * 0.6;
  const bossX = worldCenter.x + Math.cos(angle) * spawnDist;
  const bossY = worldCenter.y + Math.sin(angle) * spawnDist;
  return {
    x: bossX,
    y: bossY,
    targetX: player.x,
    targetY: player.y,
    ...getBossType(difficulty),
  };
}
```

### 11.4 Boss Progression (16 Sorties)

Each Sortie has a boss. Bosses escalate across 4 Acts.

```javascript
BOSS_PROGRESSION = {
  // Act 1 (Sorties 1-4): Ground bosses — tanks
  act1: {
    sortie1: { name: 'Armored Patrol', type: 'light_tank', hp: 300, bodyguards: 1 },
    sortie2: { name: 'Convoy Escort', type: 'medium_tank', hp: 400, bodyguards: 2 },
    sortie3: { name: 'Armored Column', type: 'heavy_tank', hp: 500, bodyguards: 3 },
    stronghold: {
      name: 'Fortified Checkpoint',
      type: 'fortified',
      hp: 600,
      bodyguards: 4,
      composition: 'checkpoint_with_aa',
    },
  },

  // Act 2 (Sorties 5-8): Harder ground/vehicle bosses
  act2: {
    sortie1: { name: 'SAM Convoy', type: 'sam_vehicle', hp: 500, bodyguards: 3 },
    sortie2: { name: 'AA Battery', type: 'aa_complex', hp: 600, bodyguards: 4 },
    sortie3: { name: 'Armored Brigade', type: 'heavy_column', hp: 700, bodyguards: 5 },
    stronghold: {
      name: 'Air Defense Complex',
      type: 'ad_complex',
      hp: 800,
      bodyguards: 6,
      composition: 'sam_site_with_aa',
    },
  },

  // Act 3 (Sorties 9-12): Air bosses start appearing
  act3: {
    sortie1: { name: 'Attack Helicopter', type: 'attack_heli', hp: 400, bodyguards: 2 },
    sortie2: { name: 'SAM Network', type: 'sam_network', hp: 800, bodyguards: 5 },
    sortie3: { name: 'Heavy Armor + Air', type: 'combined_arms', hp: 900, bodyguards: 6 },
    stronghold: {
      name: 'Strategic SAM Site',
      type: 'strategic_sam',
      hp: 1000,
      bodyguards: 8,
      composition: 'full_sam_site',
    },
  },

  // Act 4 (Sorties 13-16): Final escalation
  act4: {
    sortie1: {
      name: 'Fighter Intercept',
      type: 'fighter',
      hp: 300,
      bodyguards: 0,
      special: 'flyby_boss',
    },
    sortie2: { name: 'Heavy Air Defense', type: 'heavy_ad', hp: 1100, bodyguards: 8 },
    sortie3: { name: 'Armored Air Raid', type: 'combined_elite', hp: 1200, bodyguards: 10 },
    stronghold: {
      name: 'FINAL BOSS: Supergunship',
      type: 'supergunship',
      hp: 2000,
      bodyguards: 12,
      special: 'bullet_hell',
    },
  },
};
```

### 11.5 Boss Types

```javascript
BOSS_TYPES = {
  // Ground bosses
  light_tank: {
    name: 'Light Tank',
    hp: 300,
    speed: 80,
    armor: 1.2,
    damage: 20,
    fireRate: 0.5,
    range: 350,
    phases: [{ hpThreshold: 0.5, behavior: 'aggressive' }],
    loot: { xpBonus: 100, dollarBonus: 200 },
  },

  heavy_tank: {
    name: 'Heavy Tank',
    hp: 500,
    speed: 60,
    armor: 1.5,
    damage: 35,
    fireRate: 0.3,
    range: 400,
    phases: [
      { hpThreshold: 0.5, behavior: 'aggressive' },
      { hpThreshold: 0.25, behavior: 'berserk' },
    ],
    loot: { xpBonus: 200, dollarBonus: 400 },
  },

  // AA boss
  aa_complex: {
    name: 'AA Battery',
    hp: 600,
    speed: 0,
    armor: 1.0,
    damage: 15,
    fireRate: 6,
    range: 350,
    special: 'multiple_barrels',
    phases: [{ hpThreshold: 0.5, behavior: 'burst_fire' }],
    loot: { xpBonus: 250, dollarBonus: 500 },
  },

  // Air boss
  attack_heli: {
    name: 'Enemy Attack Helicopter',
    hp: 400,
    speed: 150,
    armor: 0.8,
    damage: 20,
    fireRate: 3,
    range: 300,
    special: 'aerial_duel',
    phases: [{ hpThreshold: 0.5, behavior: 'aggressive_strafe' }],
    loot: { xpBonus: 300, dollarBonus: 600 },
  },

  // FINAL BOSS
  supergunship: {
    name: 'Supergunship "Guardian"',
    hp: 2000,
    speed: 100,
    armor: 1.0,
    damage: 30,
    fireRate: 4,
    range: 400,
    special: 'bullet_hell',
    phases: [
      { hpThreshold: 0.75, behavior: 'spread_patterns' },
      { hpThreshold: 0.5, behavior: 'ring_attacks' },
      { hpThreshold: 0.25, behavior: 'ultimate_barrage' },
    ],
    loot: { xpBonus: 1000, dollarBonus: 2000 },
    // Large blimp-like aircraft with multiple gun turrets
    // Fires complex bullet patterns (inspired by bullet hell shooters)
    // Destroying the final boss = campaign complete = prestige unlock
  },
};
```

### 11.6 Boss Bodyguard Scaling

```javascript
function getBossBodyguards(infamyLevel, bossType) {
  const base = bossType.bodyguardCount;
  const infamyBonus = Math.floor(infamyLevel / 3);
  return base + infamyBonus;
}

function getBossHpScaling(infamyLevel, bossType) {
  return bossType.hp * (1 + infamyLevel * 0.05);
}
```

### 11.7 Boss Direction Indicator

```
When boss spawns, a UI element appears:
  - Pulsing red chevron on screen edge pointing toward boss
  - Distance counter showing tiles away
  - Chevron intensifies as boss approaches
  - Text: "INCOMING HOSTILE — [DIRECTION]"
  - Boss visible on minimap as large red triangle
```

### 11.8 Stronghold Sortie (Act Boss)

```
Stronghold Sorties are different from normal Sorties:
  - NO timer-based boss spawn
  - The compound IS the objective
  - Player must destroy the command building within a time limit
  - Timer expires = missile launch = game over
  - Facility commander boss is present from the start
  - Heavy defenses: AA batteries, SAM sites, armored units

Timer: 300 seconds (5 minutes) to destroy command building
Stronghold compositions scale by Act:
  Act 1: Fortified checkpoint with light AA
  Act 2: Air defense complex with SAM
  Act 3: Strategic SAM site with full defenses
  Act 4: Final stronghold with supergunship (bullet hell)
```

---

## 12. INFAMY SYSTEM

### 12.1 What is Infamy?

**Infamy** represents how much fear YOU are instilling in the enemy. NOT how afraid you are. Higher Infamy = the locals fear you more = the enemy sends tougher resistance.

### 12.2 Infamy Gains

```javascript
// Per-kill weighted + settlement clear bonus
function calculateInfamyGain(enemyType) {
  return enemyType.fearWeight;
}

function calculateClearBonus(settlement) {
  const size = settlement.buildings.length;
  const archetype = settlement.archetype;
  const baseBonus = archetype.clearBonus[0];
  const maxBonus = archetype.clearBonus[1];
  const t = Math.min(1, size / archetype.buildingCount[1]);
  return Math.floor(baseBonus + (maxBonus - baseBonus) * t);
}
```

### 12.3 Infamy Level Thresholds

```javascript
// Exponential scaling — each level requires more Infamy than the last
INFAMY_LEVELS = [
  { level: 0, threshold: 0 },
  { level: 1, threshold: 10 },
  { level: 2, threshold: 25 },
  { level: 3, threshold: 50 },
  { level: 4, threshold: 85 },
  { level: 5, threshold: 130 },
  { level: 6, threshold: 190 },
  { level: 7, threshold: 270 },
  { level: 8, threshold: 370 },
  { level: 9, threshold: 500 },
  { level: 10, threshold: 660 },
];

// KEY TENSION: Infamy = stronger weapon upgrades BUT stronger boss
```

> **Shipped (2026-08):** Infamy is now split into **Fear** (field upgrades) and **Heat** (Hunter ETA). Thresholds are identical to `FEAR_THRESHOLDS` in `js/sim/state.js:1` and `INFAMY` alias in `js/config.js:72` (deprecated). Fear levels show `FEAR GROWS` overlay with 3 cards from `js/upgrades.js:5` (AP_ROUNDS etc., 8 cards). Heat tiers (`QUIET…CRITICAL`) scale aggro `COMBAT.aggroPerHeatTier` and `hunterClockRate`. The tension is preserved: more Fear = stronger gun, more Heat = faster Hunter.

### 12.4 Level-Up Flow

```
1. Infamy bar fills to next threshold
2. Game PAUSES (enemies freeze, auto-fire stops)
3. Full-screen overlay appears:
   - Title: "INFAMY GROWS..."
   - Current level displayed
   - 3 weapon upgrade cards shown face-up
   - Each card: name, description, visual indicator
4. Player taps/clicks a card
5. Upgrade applied to weapon state
6. Game RESUMES
7. Infamy bar resets to 0, next threshold displayed
```

---

## 13. PILOT SYSTEM

### 13.1 Pilot Concept

```
ARCHITECTURE DECISION: Single pilot per career (not a roster).
WHY: The pilot IS the career. There's one pilot, they live or die.
Meta-progression affects Hangar upgrades (permanent) and gunship unlocks (permanent).
The pilot is a vessel for the player's progression through a campaign.
When the pilot dies, the career is over — new pilot starts fresh.
```

### 13.2 Pilot Generation

```javascript
function generatePilot() {
  const name = generatePilotName();
  const stats = {
    accuracy: 1 + Math.random() * 3, // 1-4, weapon accuracy/damage
    control: 1 + Math.random() * 3, // 1-4, handling/stability
    awareness: 1 + Math.random() * 3, // 1-4, minimap range/detection
    speed: 1 + Math.random() * 3, // 1-4, acceleration/max speed
    grit: 1 + Math.random() * 3, // 1-4, damage resistance/red screen
  };
  return {
    name,
    level: 1,
    stats,
    xp: 0,
    xpToNext: 100,
    skillPoints: 0,
    alive: true,
  };
}
```

### 13.3 Pilot Stats Effects

```javascript
PILOT_STAT_EFFECTS = {
  accuracy: {
    effect: (stat) => ({
      damageMultiplier: 1 + (stat - 1) * 0.1, // +10% damage per point above 1
      spreadMultiplier: 1 / (1 + (stat - 1) * 0.05), // less spread
    }),
  },
  control: {
    effect: (stat) => ({
      handlingMultiplier: 1 + (stat - 1) * 0.08, // +8% handling per point
      turnRateMultiplier: 1 + (stat - 1) * 0.05,
    }),
  },
  awareness: {
    effect: (stat) => ({
      minimapRange: 200 + (stat - 1) * 50, // +50 tiles per point
      detectionBonus: (stat - 1) * 0.05, // +5% detection per point
    }),
  },
  speed: {
    effect: (stat) => ({
      accelMultiplier: 1 + (stat - 1) * 0.08,
      maxSpeedMultiplier: 1 + (stat - 1) * 0.05,
    }),
  },
  grit: {
    effect: (stat) => ({
      damageReduction: 1 - 1 / (1 + (stat - 1) * 0.15),
      redScreenReduction: (stat - 1) * 0.1, // -10% red screen per point
    }),
  },
};
```

### 13.4 Pilot Leveling

```javascript
// Pilot gains XP from kills and settlement clears
// Level-ups happen BETWEEN Sorties only (not during)
// Player spends skill points on pilot skill grid

PILOT_XP = [
  { level: 1, xpToNext: 0 },
  { level: 2, xpToNext: 100 },
  { level: 3, xpToNext: 250 },
  { level: 4, xpToNext: 500 },
  { level: 5, xpToNext: 850 },
  { level: 6, xpToNext: 1300 },
  { level: 7, xpToNext: 1900 },
  { level: 8, xpToNext: 2600 },
  { level: 9, xpToNext: 3500 },
  { level: 10, xpToNext: 5000 },
];

// XP persists if pilot survives the Sortie
// XP is LOST if pilot dies
// Between Sorties: pilot levels up, player spends skill points
```

### 13.5 Pilot Skill Grid (5 Branches x 6 Nodes)

Path of Exile-style allocation. 30 total nodes. Pilots earn **1 skill point per level**. Free respec between Sorties.

#### Marksman Branch (Accuracy)

```
[+5% Damage] -> [+10% Damage] -> [+15% Damage]
       |               |               |
[+5% Fire Rate] -> [+10% Fire Rate] -> [Double Tap]
```

- Stabilizer: +5% accuracy
- Marksman: +10% damage
- Dead Eye: +15% critical hit chance
- Rapid Fire: +10% fire rate
- Sniper: +20% damage at range
- Double Tap: 15% chance for projectiles to fire twice

#### Pilot Branch (Control)

```
[+10% Handling] -> [+15% Lock-On] -> [+20% Tracking]
       |               |               |
[-15% Spread] -> [+10% Turn Rate] -> [Targeting Computer]
```

- Steady Hands: +10% handling
- Locked On: +15% lock-on speed
- Interceptor: +20% tracking accuracy
- Recoil Control: -15% weapon spread
- Smooth Operator: +10% turn rate
- Targeting Computer: auto-lead targets

#### Recon Branch (Awareness)

```
[+20% Minimap] -> [+15% Detection] -> [Full Spectrum]
       |               |               |
[Missile Warning] -> [+10% Dmg Detected] -> [Recon Flyover]
```

- Sharp Eyes: +20% minimap range
- Intel Network: +15% threat detection radius
- Full Spectrum: reveal hidden enemies (MANPADS, ambush)
- Threat Detector: warning before incoming missiles
- Marked Target: +10% damage to detected enemies
- Recon Flyover: reveal entire minimap for 10 seconds (30s cooldown)

#### Thrust Branch (Speed)

```
[+10% Acceleration] -> [+15% Max Speed] -> [+20% Boost Duration]
       |               |               |
[-20% Boost CD] -> [+25% Accel Boost] -> [Maximum Overdrive]
```

- Light Frame: +10% acceleration
- Turbo: +15% max speed
- Afterburner: +20% boost duration
- Quick Start: -20% boost cooldown
- Zoom: +25% acceleration while boosting
- Maximum Overdrive: temporary +50% speed for 5 seconds (30s cooldown)

#### Fortitude Branch (Grit)

```
[+10% Dmg Resist] -> [+15% Dmg Resist] -> [+20% Dmg Resist]
       |               |               |
[-20% Red Screen] -> [+25% HP] -> [Last Stand]
```

- Hardened: +10% damage resistance
- Iron Skin: +15% damage resistance
- Bulletproof: +20% damage resistance
- Steady: -20% red screen effect when taking fire
- Unbreakable: +25% HP
- Last Stand: survive lethal damage once per Sortie (60s cooldown)

### 13.6 Pilot Respec

```javascript
// Free respec between Sorties
// All skill points refunded, player re-allocates
// Encourages experimentation with different builds
```

### 13.7 Pilot Death

```
When pilot dies:
  - Sortie ends immediately
  - Pilot is gone (career over)
  - XP earned during run is LOST
  - Dollars earned during run ARE retained (can spend in Hangar)
  - Gunship unlocks persist
  - Hangar upgrades persist
  - New random pilot generated for next campaign (free, level 1)

DEATH TEXT: "Pilot KIA. Sector [X] has been liberated."
(never "killed" — always sanitized military language)
```

### 13.8 Pilot Name Generation

```javascript
NAME_PARTS = {
  first: [
    'Ahmad',
    'Mohammed',
    'Omar',
    'Yusuf',
    'Ali',
    'Hassan',
    'Hussein',
    'Ibrahim',
    'Khalid',
    'Abdullah',
    'Rashid',
    'Tariq',
    'Jamal',
    'Faris',
  ],
  callsigns: [
    'Viper',
    'Hawk',
    'Eagle',
    'Phoenix',
    'Shadow',
    'Ghost',
    'Storm',
    'Raven',
    'Falcon',
    'Cobra',
    'Wolf',
    'Lynx',
    'Panther',
    'Blade',
  ],
};

function generatePilotName() {
  const first = random(NAME_PARTS.first);
  const callsign = random(NAME_PARTS.callsigns);
  return { first, callsign, display: `${first} "${callsign}"` };
}
```

---

## 14. EQUIPMENT

### 14.1 Equipment Slot

```
ARCHITECTURE DECISION: Single equipment slot (not loadout).
WHY: One slot means the player makes ONE choice: what to bring?
Equipment has cooldown + limited uses per Sortie.
```

### 14.2 Equipment Types

```javascript
EQUIPMENT = {
  flares: {
    name: 'Flare Burst',
    desc: 'Deflects incoming missiles',
    uses: 5,
    cooldown: 10,
    behavior: 'deflect',
  },
  chaff: {
    name: 'Chaff Cloud',
    desc: 'Disables radar-guided missiles for 5s',
    uses: 3,
    cooldown: 15,
    behavior: 'emp',
    radius: 100,
    duration: 5,
  },
  smoke: {
    name: 'Smoke Screen',
    desc: 'Blocks line of sight for 8s',
    uses: 2,
    cooldown: 20,
    behavior: 'smoke',
    radius: 80,
    duration: 8,
  },
  recon: {
    name: 'Recon Flyover',
    desc: 'Reveals entire minimap for 10s',
    uses: 1,
    cooldown: 30,
    behavior: 'reveal',
    duration: 10,
  },
  repair: {
    name: 'Repair Drone',
    desc: 'Restores 25% HP over 10s',
    uses: 1,
    cooldown: 45,
    behavior: 'heal',
    healAmount: 0.25,
    healDuration: 10,
  },
};
```

---

## 15. META-PROGRESSION

### 15.1 Currencies

```
XP (Pilot Experience):
  - Earned from ALL kills and settlement clears
  - Spent on Pilot Skill Grid (between Sorties)
  - LOST when pilot dies

Dollars ($):
  - Earned from settlement clear rewards and boss loot
  - Spent in Hangar on per-gunship upgrades
  - RETAINED when pilot dies (permanent)

Infamy:
  - In-run only, resets each Sortie
  - Drives weapon evolution through level-ups
  - Makes boss stronger (bodyguards, HP)
```

### 15.2 Hangar (Per-Gunship Upgrades — Dollars)

Each gunship has its own upgrade tree. Upgrades are permanent across pilots.

```javascript
// See Section 8.3 for full upgrade trees
// Cobra: 6 slots x 2 levels = 12 upgrades
// SuperCobra: +1 slot = 14 upgrades
// Apache: +1 slot = 16 upgrades
// Longbow: +1 slot = 18 upgrades
// Comanche: +1 slot = 20 upgrades
```

### 15.3 Gunship Unlocks

```javascript
GUNSHIP_UNLOCKS = {
  supercobra: {
    name: 'AH-1W SuperCobra',
    condition: 'reach_act_2', // beat Act 1 Stronghold
    flavorText: 'Command has approved your request for upgraded hardware.',
  },
  apache: {
    name: 'AH-64 Apache',
    condition: 'reach_act_3', // beat Act 2 Stronghold
    flavorText: 'Your performance has earned you access to the Apache platform.',
  },
  longbow: {
    name: 'AH-64D Longbow',
    condition: 'reach_act_4', // beat Act 3 Stronghold
    flavorText: 'Longbow radar systems have been assigned to your unit.',
  },
  comanche: {
    name: 'RAH-66 Comanche',
    condition: 'beat_final_boss', // beat Act 4 final boss
    flavorText: 'The Comanche program has been declassified for your unit.',
  },
};
```

### 15.4 Prestige / NG+ System

After beating the final boss (Act 4, Sortie 16):

```
1. Comanche unlocked permanently
2. New campaign starts at HIGHER DIFFICULTY
3. Pilot resets to Level 1 (new random stats)
4. Hangar upgrades persist
5. Gunship unlocks persist

Difficulty scaling per prestige:
  - Enemy HP +20%
  - Enemy damage +15%
  - Map size +25% (longer Sorties)
  - Boss timer +30s (more time before boss)
  - Settlement count +2 (more targets)
  - Dollar rewards +30% (offsets difficulty)

After 3 prestiges:
  - Maps are 75% larger
  - Boss timer is 90s longer
  - 6 more settlements
  - Enemies are much tougher but rewards are better
```

### 15.5 Starting Pilot Level Upgrade

```javascript
// Meta-progression: upgrade the level your pilot starts at
STARTING_LEVEL_COSTS = {
  1: 0, // always start at level 1
  2: 500,
  3: 1500,
  4: 4000,
  5: 10000,
};
```

### 15.6 Sortie Summary Screen

```
After pilot death or boss defeat:

1. Show summary:
   - Time survived
   - Enemies killed
   - Settlements cleared
   - Infamy level reached
   - Boss defeated? (yes/no)
   - XP earned (total)
   - Dollars earned (total)
   - Pilot level reached

2. XP is LOST if pilot died
   XP persists if pilot survived boss

3. Dollars are RETAINED

4. "NEXT SORTIE" button -> fresh world, new modifier
```

---

## 16. HUD & UI

### 16.1 Minimal HUD

```
+---------------------------------------------+
|  [HP BAR]                    [BOSS TIMER]    |
|  ████████░░                 02:15            |
|                                              |
|  [INFAMY BAR]                                |
|  ██████░░░░░░░░░░░░░░                        |
|                                              |
|            (game world)                      |
|                                              |
|                                              |
|  [ROCKET AMMO]            [MINIMAP]          |
|  ●●●●                    +----------+       |
|                           | ·  ·  ·  |       |
|  [EQUIPMENT]              |  ·     · |       |
|  ◆◆                      | ·  ·  ·  |       |
|                           +----------+       |
+---------------------------------------------+
```

### 16.2 Contextual HUD Elements

```
- Enemy health bars: appear only when damaged, fade after 3s
- Settlement name/distance: appears when approaching
- Kill count: briefly flashes on each kill
- Damage numbers: float up from hit enemies
- Low HP warning: red vignette on screen edges
- Infamy level-up: full-screen overlay (pauses game)
- Settlement clear: brief banner with name + reward
- Boss warning: pulsing red border + directional arrow
- Rocket/equipment: shows ammo/cooldown when applicable
- High-priority targets: reddish tint on command/radar buildings
```

### 16.3 Expandable Minimap

```
Default: small (100x100px), bottom-right
  - Player (green dot)
  - Enemies (red dots)
  - Settlements (yellow diamonds)
  - Boss (large red triangle, when spawned)
  - Dark background with grid lines (radar aesthetic)

Expanded (tap): 200x200px
  - Building outlines
  - Settlement names
  - Terrain color hints
  - Player view cone

Fullscreen (double-tap):
  - Full world view
  - All discovered settlements named
  - Difficulty zones color-coded
  - Can tap to set waypoints
```

### 16.4 Touch Controls

```
Left thumb (bottom-left 40%):
  - Virtual joystick (appears on touch)
  - Circle with inner knob
  - Drag to move helicopter

Right thumb (bottom-right 40%):
  - Rocket button (large, tap to fire)
  - Equipment button (smaller, below rocket)
  - Minimap tap target

Auto-fire: primary weapon always fires at nearest enemy
```

### 16.5 Pause Menu

```
Pause button: top-right corner (small icon)
Pause menu:
  - Resume
  - Settings (audio, controls)
  - Quit to Menu (abandons current Sortie, pilot survives)
```

---

## 17. RUN MODIFIERS

### 17.1 Modifier System

```javascript
// One modifier per Sortie, randomly selected at Sortie start.
// Displayed in pre-sortie briefing.

RUN_MODIFIERS = {
  sandstorm: {
    name: 'Sandstorm',
    desc: 'Reduced visibility. Enemy positions hidden beyond 60% range.',
    effect: { visibilityRange: 0.6 },
    unlockCondition: null,
  },
  clearSkies: {
    name: 'Clear Skies',
    desc: 'Perfect visibility. +10% detection range.',
    effect: { detectionRange: 1.1 },
    unlockCondition: null,
  },
  hostileAirspace: {
    name: 'Hostile Airspace',
    desc: 'Fighter patrols active. Random flyby encounters.',
    effect: { fighterChance: 0.15 },
    unlockCondition: 'First boss kill',
  },
  armsBazaar: {
    name: 'Arms Bazaar',
    desc: 'Increased weapon caches. +50% rocket ammo finds.',
    effect: { rocketAmmoMult: 1.5 },
    unlockCondition: null,
  },
  blackout: {
    name: 'Blackout',
    desc: 'Enemy comms jammed. +30 seconds to boss timer.',
    effect: { bossTimerBonus: 30 },
    unlockCondition: null,
  },
  desertFever: {
    name: 'Desert Fever',
    desc: '-15% movement speed. Sand is thick.',
    effect: { speedMod: 0.85 },
    unlockCondition: null,
  },
};
```

---

## 18. AUDIO

```
Placeholder: silent for 2D prototype.
Later: procedural audio via Web Audio API.

Planned sounds:
  - Gunfire: short burst oscillator
  - Rockets: noise sweep
  - Explosions: noise burst with decay
  - Engine: low frequency oscillator
  - Ambient: wind noise
  - Alarm: boss approaching
  - UI clicks: short blip
  - Missile warning: alarm tone
  - Settlement discovery: radio static + voice
```

---

## 19. IMPLEMENTATION PHASES

### Phase 1: Foundation (Week 1)

1. Project scaffolding (index.html, css, module structure)
2. Game loop (rAF + fixed timestep, 120fps detection)
3. Canvas setup + responsive scaling (DPR-aware)
4. Input system (virtual joystick + keyboard)
5. Camera system (world scroll + zoom + follow)
6. Faux-3D projection system (adapted from TD: view25.js)
7. Drawing primitives (adapted from TD: prims25.js)
8. Color/material utilities (adapted from TD: drawUtil.js)

### Phase 2: World (Week 2)

9. Terrain generation (noise-based, chunk system)
10. Terrain rendering (cached chunk canvases)
11. Settlement archetype data definitions
12. Settlement placement algorithm
13. Building procedural rendering
14. Settlement discovery system

### Phase 3: Helicopter (Week 2-3)

15. Helicopter entity + physics (momentum movement)
16. Helicopter rendering (procedural 2.5D)
17. Primary weapon auto-fire system
18. Projectile system (bullets)
19. Secondary weapon (rockets — dumbfire first)
20. Collision detection (bullets vs enemies, rockets vs ground)

### Phase 4: Enemies (Week 3)

21. Enemy entity system + entity factory
22. Enemy AI behaviors (all 8 classes)
23. Enemy rendering (silhouette system)
24. Enemy spawning in settlements
25. Difficulty scaling (radial distance + Infamy)
26. Enemy projectiles (bullets, rockets, missiles)
27. Air defense bubble system

### Phase 5: Combat & Infamy (Week 3-4)

28. Damage calculation
29. Health system (player + enemies)
30. Death/explosion effects
31. Infamy meter + gain system
32. Level-up trigger
33. Upgrade card selection UI
34. Weapon upgrade application
35. Settlement clear detection + rewards

### Phase 6: Boss (Week 4)

36. Boss timer system (signal.js)
37. Boss entity + physics
38. Boss AI (approach, attack phases)
39. Boss bodyguard spawning
40. Boss direction indicator
41. Boss combat resolution
42. Boss loot drops
43. Stronghold Sortie type (command building timer)

### Phase 7: Pilot & Meta (Week 4-5)

44. Pilot generation (name, stats)
45. Pilot stat effects on gameplay
46. Pilot leveling (XP thresholds)
47. Pilot skill grid screen (5 branches x 6 nodes)
48. Pilot respec functionality
49. Dollars persistence (localStorage)
50. Hangar screen + gunship upgrade/upgrade logic
51. Gunship unlock system
52. Starting level upgrade
53. Main menu screen
54. Pre-sortie briefing screen

### Phase 8: Equipment & Modifiers (Week 5)

55. Equipment definitions + data
56. Equipment usage + cooldowns + limited uses
57. Equipment UI (3rd button)
58. Run modifier selection + application
59. Modifier UI display

### Phase 9: UI Polish (Week 5-6)

60. HUD rendering (HP, Infamy, timer, ammo)
61. Minimap (military radar style)
62. Expandable minimap behavior
63. Contextual HUD elements
64. Damage numbers / kill feed
65. Low HP warning effects
66. Settlement discovery/clear banners
67. Boss warning system
68. Pause menu

### Phase 10: Content & VFX (Week 6)

69. Particle system (adapted from TD: fx.js)
70. Explosion effects
71. Bullet trails
72. Rocket smoke trails
73. Screen shake, flash effects
74. All gunship types rendering
75. All 15 enemy types defined
76. All weapon upgrades balanced
77. All settlement archetypes implemented
78. Lore text + settlement names
79. Radio chatter system
80. Boss progression (all Acts)
81. Convoy/patrol system

### Phase 11: Responsive & Mobile (Week 6-7)

82. Touch control refinement
83. Portrait/landscape layout adaptation
84. Performance optimization (object pooling, spatial hashing)
85. Mobile-specific UI adjustments
86. 120fps verification
87. Save system (localStorage auto-save)
88. Prestige/NG+ system
89. Final balance pass

---

## 20. BALANCE FORMULAS

### 20.1 Difficulty Scaling

```javascript
// Three-factor difficulty multiplier
function getDifficultyMultiplier(distance, metaLevel, infamyLevel) {
  const distanceFactor = 1 + distance / 500; // 1.0 at center, 2.0 at 500 tiles
  const metaFactor = 1 + metaLevel * 0.03; // +3% per meta upgrade
  const infamyFactor = 1 + infamyLevel * 0.1; // +10% per Infamy level
  return distanceFactor * metaFactor * infamyFactor;
}
```

### 20.2 Enemy Scaling in Settlements

```javascript
function scaleEnemyRoster(baseRoster, difficultyMultiplier) {
  const scaledCount = Math.floor(baseRoster.count * difficultyMultiplier);
  const scaledComposition = { ...baseRoster.composition };
  if (difficultyMultiplier > 1.5) {
    scaledComposition.rocketeer *= 1.5;
    scaledComposition.unarmed *= 0.5;
  }
  if (difficultyMultiplier > 2.0) {
    scaledComposition.technical = 0.1;
    scaledComposition.aa_gun = 0.05;
  }
  return { count: scaledCount, composition: scaledComposition };
}
```

### 20.3 Loot Scaling

```javascript
function getLootMultiplier(gritStat, settlementSize) {
  return (1 + (gritStat - 1) * 0.5) * (1 + settlementSize * 0.05);
}
```

### 20.4 Infamy Gain Scaling

```javascript
function getInfamyGain(baseInfamyWeight, pilotAccuracyStat) {
  return Math.floor(baseInfamyWeight * (1 + (pilotAccuracyStat - 1) * 0.1));
}
```

### 20.5 Boss Scaling

```javascript
function getBossStats(bossType, infamyLevel, prestigeLevel) {
  const infamyMult = 1 + infamyLevel * 0.05;
  const prestigeMult = 1 + prestigeLevel * 0.2;
  return {
    hp: bossType.hp * infamyMult * prestigeMult,
    damage: bossType.damage * prestigeMult,
    bodyguards: bossType.bodyguardCount + Math.floor(infamyLevel / 3),
  };
}
```

---

## APPENDIX A: KEY ARCHITECTURE DECISIONS LOG

| Decision              | Chosen                                                          | Rejected                | Why                                                         |
| --------------------- | --------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------- |
| Sim/render coupling   | Fixed timestep (60Hz) sim + decoupled render                    | Coupled sim/render      | Deterministic sim regardless of display refresh rate        |
| Canvas DPR            | DPR-aware scaling                                               | 1:1 pixel mapping       | Crisp on Retina/HiDPI displays                              |
| Controls              | Canvas-drawn virtual joystick                                   | DOM elements            | Resolution-independent, same coord space as game            |
| Terrain               | Tile-based + chunk caching                                      | Full world render       | O(1) render for visited chunks, memory efficient            |
| Settlement generation | Rule-based procedural                                           | Template-based          | Infinite variation, maintainable archetype identity         |
| Weapon system         | Single evolving weapon                                          | Multiple loadout slots  | Faster gameplay, deeper decisions (Vampire Survivors model) |
| Boss timer            | Real-time countdown + settlement penalties + fuel depot bonuses | Distance-based trigger  | Player controls pacing through risk/reward choices          |
| Infamy mechanic       | Pause + card choice                                             | Slow-mo overlay         | Clear decision moment, mobile-friendly reading time         |
| Pilot system          | Single pilot per career                                         | Roster of pilots        | Simple, focused, the pilot IS the career                    |
| Equipment             | Single slot + cooldown + limited uses                           | Multiple loadout        | One meaningful choice, no management overhead               |
| Settlement naming     | Procedural Arabic syllables                                     | Static name list        | Infinite variety, authentic feel                            |
| Lore delivery         | Environmental text popups                                       | Cutscenes/dialogue      | Zero assets, integrates with gameplay flow                  |
| Entity system         | Data-driven (factory + templates)                               | Class-based inheritance | Adding content = adding data, never new classes             |
| Gunships              | 5 real historical gunships                                      | Fictional designs       | Historically grounded, recognizable, meaningful progression |
| Fear -> Infamy        | Renamed "Infamy" (we instill fear)                              | Keep "Fear"             | Clearer for player — THEY are feared, not afraid            |

---

## APPENDIX B: ENEMY TYPE DOSSIER (UNIFIED)

### Historical Foundation

The enemy military is inspired by Iraqi air defense doctrine (1980s-1991). Key characteristics:

- Soviet-supplied equipment (tanks, AA, missiles)
- Layered air defense (MANPADS -> light AA -> heavy AA -> SAM)
- Mixed regular/irregular forces
- Static defenses protecting key installations

### Enemy Type Categories

#### Tier 0: Ordinary Infantry (5 types)

| Type                  | Weapon               | HP  | Speed | Behavior     | Fear Weight |
| --------------------- | -------------------- | --- | ----- | ------------ | ----------- |
| Pistol Soldier        | 9mm pistol           | 15  | 35    | Guard        | 1           |
| Rifleman              | 7.62mm assault rifle | 30  | 35    | Guard        | 2           |
| Assault Rifle Soldier | AK-pattern rifle     | 25  | 40    | Patrol       | 2           |
| Machine Gun Team      | Belt-fed 7.62mm LMG  | 40  | 25    | Guard        | 4           |
| Heavy Machine Gun     | 12.7mm/14.5mm HMG    | 50  | 0     | Guard/Ambush | 6           |

#### Tier 1: Light AA (3 types)

| Type            | Weapon                  | HP  | Speed | Behavior       | Fear Weight |
| --------------- | ----------------------- | --- | ----- | -------------- | ----------- |
| Light AA Gun    | Twin/quad heavy MG AA   | 60  | 0     | Fixed          | 8           |
| Twin 23mm AA    | Twin 23mm cannon        | 80  | 0     | Fixed          | 10          |
| Mobile AA Truck | Twin 23mm truck-mounted | 70  | 45    | Mobile Defense | 10          |

#### Tier 2: Heavy AA (3 types)

| Type             | Weapon                | HP  | Speed | Behavior       | Fear Weight |
| ---------------- | --------------------- | --- | ----- | -------------- | ----------- |
| Shilka           | Quad 23mm (ZSU-23-4)  | 150 | 45    | Mobile Defense | 15          |
| Heavy 57mm AA    | Twin 57mm cannon      | 200 | 0     | Fixed          | 18          |
| Heavy AA Battery | 57mm artillery (S-60) | 180 | 0     | Fixed          | 18          |

#### Tier 3: Man-Portable Missiles (2 types)

| Type                 | Weapon           | HP  | Speed | Behavior | Fear Weight |
| -------------------- | ---------------- | --- | ----- | -------- | ----------- |
| MANPADS Team         | SA-7/SA-14 class | 25  | 30    | Ambush   | 12          |
| Veteran Missile Team | Improved MANPADS | 30  | 30    | Ambush   | 14          |

#### Tier 4: Mobile SAM (1 type)

| Type       | Weapon           | HP  | Speed | Behavior       | Fear Weight |
| ---------- | ---------------- | --- | ----- | -------------- | ----------- |
| Mobile SAM | SA-9/SA-13 class | 120 | 40    | Mobile Defense | 20          |

#### Tier 5: Vehicles (3 types)

| Type             | Weapon         | HP  | Speed | Behavior      | Fear Weight |
| ---------------- | -------------- | --- | ----- | ------------- | ----------- |
| Technical        | MG or light AA | 60  | 70    | Patrol        | 5           |
| APC              | Machine gun    | 120 | 50    | Patrol/Escort | 8           |
| Main Battle Tank | Main gun + MG  | 250 | 30    | Escort        | 12          |

#### Tier 6: Aircraft (2 types)

| Type              | Weapon          | HP  | Speed | Behavior        | Fear Weight |
| ----------------- | --------------- | --- | ----- | --------------- | ----------- |
| Attack Helicopter | Rockets, cannon | 180 | 120   | Air Interceptor | 20          |
| Fighter           | Full armament   | 100 | 300   | Air Interceptor | 25          |

### Air Defense Bubble System

Every serious AA unit has an invisible threat radius. NOT shown on minimap.

| Unit       | Threat Radius | Visual Cues                                      |
| ---------- | ------------- | ------------------------------------------------ |
| HMG        | 100           | Tracer fire direction                            |
| Light AA   | 150           | Wall of tracer fire                              |
| Twin 23mm  | 180           | Cannon flash, heavy tracers                      |
| Shilka     | 220           | Radar tracking sound, sweeping tracers           |
| Heavy 57mm | 300           | Heavy thumping report, explosions                |
| MANPADS    | 200           | Missile launch smoke trail (hidden until firing) |
| Mobile SAM | 400           | Missile warning alarm                            |

### Design Principles

1. Each weapon answers a different gameplay question
2. Visual and mechanical distinction — recognize by sight and sound
3. Fixed guns need environmental protection (sandbags, revetments)
4. MANPADS: hidden, quiet, sudden — opposite of Shilka
5. Decoys prevent pattern memorization
6. Infantry should NOT be useless — close range = still dangerous

---

## APPENDIX C: SAVE DATA SCHEMA

### localStorage Structure

```javascript
SAVE_DATA = {
  // Pilot (current career)
  pilot: {
    name: { first: 'Ahmad', callsign: 'Viper', display: 'Ahmad "Viper"' },
    stats: { accuracy: 3.2, control: 2.1, awareness: 2.8, speed: 1.5, grit: 2.4 },
    level: 8,
    skillPoints: 8,
    skills: ['marksman_1', 'marksman_2', 'pilot_1', 'recon_1', 'thrust_1', 'fort_1'],
    alive: true,
  },

  // Hangar (permanent, per-gunship)
  hangar: {
    cobra: { engine: 2, armor: 1, weaponMount: 2, rotor: 1, fuel: 0, countermeasures: 0 },
    supercobra: {
      engine: 0,
      armor: 0,
      weaponMount: 0,
      rotor: 0,
      fuel: 0,
      countermeasures: 0,
      twinEngine: 0,
    },
    apache: null,
    longbow: null,
    comanche: null,
  },

  // Gunship unlocks (permanent)
  gunshipsUnlocked: ['cobra', 'supercobra'],

  // Milestones (permanent, across all pilots)
  milestones: {
    bossesDefeated: 5,
    settlementsCleared: 22,
    sortiesCompleted: 8,
    finalBossDefeated: false,
  },

  // Currencies
  dollars: 1250,

  // Prestige
  prestigeLevel: 0,

  // Stats
  totalPlaytime: 14400,
  totalKills: 342,
  totalSortiesCompleted: 8,
};
```

### Save Triggers

- Auto-save after each Sortie completion
- Auto-save after Hangar upgrades
- Auto-save after pilot level-up (skill allocation)
- Auto-save on browser close/tab switch

---

_End of Document_

---

## RENDERING & VISUAL SPECIFICATIONS

> **Theme:** Gulf War action movie. 90s vibrant cartoon aesthetic. Steel panels, military fonts, wood crate textures, hazard stripes. Think "Desert Strike meets Command & Conquer cutscenes." The game should feel like a playable 90s military cartoon — bold outlines, saturated colors, readable at a glance.

### R1. Visual Identity

```
ART STYLE: Vibrant cartoon (not photorealistic, not muted)
OUTLINES: Bold dark outlines on all entities (2px black stroke)
FILLS: Saturated, flat colors with simple shading (2-tone: base + shadow)
TEXTURE: Minimal — steel panels, wood grain, hazard stripes as accents
FONT: Military stencil (Impact, Arial Black, or custom stencil)
MOTION: Juice — screen shake, flash, particles on everything

REFERENCE POINTS:
  - Desert Strike (Sega Genesis) — the direct inspiration
  - Command & Conquer cutscenes — military cartoon aesthetic
  - Advance Wars — readable silhouettes, vibrant colors
  - Metal Slug — exaggerated military hardware, expressive animations
```

### R2. Color Palette

```javascript
// ARCHITECTURE DECISION: Vibrant cartoon palette for 90s Gulf War aesthetic.
// WHY: Bold, readable, fun. Every entity is instantly recognizable by color.
// Player = olive drab. Enemies = brown. Buildings = concrete/steel.
// High-priority targets = red glow. The palette pops off the screen.

PALETTE = {
  // === TERRAIN ===
  terrain: {
    sand: '#e8c87a', // warm desert sand (brighter, more vibrant)
    hardpack: '#d4a860', // packed earth
    rock: '#9a8060', // dark rocky ground
    road: '#8a7050', // worn dirt road
    wadi: '#6a9ab0', // dry riverbed (blue-ish)
    oasis: '#4a9a5a', // vegetation green (vibrant)
    dunes: '#f0d890', // light sand dunes (sunny)
  },

  // === PLAYER GUNSHIPS ===
  // Olive drab — the classic 90s military green
  // Bold outlines, steel panel accents, visible rivets
  gunship: {
    body: '#5a7a3a', // olive drab (main body — vibrant)
    bodyHi: '#6a8a4a', // highlight (lighter olive)
    bodyDark: '#3a5a2a', // shadow (darker olive)
    steel: '#8a8a7a', // steel panel accent (gray-silver)
    steelHi: '#9a9a8a', // steel highlight
    steelDark: '#6a6a5a', // steel shadow
    cockpit: '#88ccdd', // glass blue (tinted canopy — bright)
    cockpitHi: '#aaeeff', // glass highlight (specular)
    rotor: '#555555', // dark gray (spinning)
    tail: '#5a7a3a', // same as body
    weaponPod: '#4a4a4a', // dark gray (weapons)
    weaponHi: '#5a5a5a', // weapon highlight
    skid: '#333333', // black (landing skids)
    shadow: 'rgba(0,0,0,0.35)', // ground shadow
    outline: '#222222', // bold outline color
    // Comanche: darker, stealth coating
    stealth: '#3a5a3a', // darker olive for stealth
    stealthHi: '#4a6a4a', // stealth highlight
  },

  // === ENEMIES ===
  // Brown — simple, unified. All enemies are brown.
  // Player instantly recognizes ANY enemy by color: brown = bad.
  enemy: {
    base: '#8a6a4a', // BROWN (all enemies)
    baseHi: '#9a7a5a', // highlight
    baseDark: '#6a4a2a', // shadow
    outline: '#3a2a1a', // bold outline
    // Vehicles get a slightly different brown (warmer)
    vehicle: '#7a6040', // darker brown (vehicles)
    vehicleHi: '#8a7050', // vehicle highlight
    vehicleDark: '#5a4020', // vehicle shadow
    // Aircraft: gray-brown
    aircraft: '#7a7a6a', // gray-brown (aircraft)
    aircraftHi: '#8a8a7a', // aircraft highlight
  },

  // === BUILDINGS ===
  // Concrete, steel, wood — military construction materials
  building: {
    concrete: '#c0b898', // concrete/mud brick (warm)
    concreteHi: '#d0c8a8', // highlight
    concreteDark: '#a09878', // shadow
    steel: '#8a8a7a', // steel panels (gray)
    steelHi: '#9a9a8a', // steel highlight
    steelDark: '#6a6a5a', // steel shadow
    wood: '#a08050', // wood crate texture
    woodHi: '#b09060', // wood highlight
    woodDark: '#806030', // wood shadow
    tent: '#9a8060', // canvas tent
    tentHi: '#aa9070', // highlight
    sandbag: '#b0a070', // sandbag color
    sandbagHi: '#c0b080', // highlight
    fuel: '#cc4433', // fuel tank (RED — dangerous)
    fuelHi: '#dd5544', // fuel highlight
    fuelStripe: '#ffcc00', // HAZARD STRIPE (yellow/black)
    hazard: '#ffcc00', // hazard stripe color
    hazardDark: '#222222', // hazard stripe dark
    radar: '#6a7a6a', // radar equipment
    radarHi: '#7a8a7a', // highlight
    antenna: '#888888', // antenna/metal
  },

  // === HIGH-PRIORITY TARGETS ===
  // Red glow + hazard stripes — unmistakable
  highPriority: {
    base: '#cc4433', // red base
    highlight: '#ee6655', // bright red
    glow: 'rgba(220,60,40,0.4)', // red glow aura
    stripe: '#ffcc00', // hazard stripe accent
    pulse: 'rgba(220,60,40,0.2)', // pulsing glow
  },

  // === UI/HUD ===
  // Military90s radar aesthetic — diegetic (part of helicopter dashboard)
  ui: {
    bg: 'rgba(10,15,10,0.75)', // dark green-black (CRT feel)
    bgSolid: '#0a100a', // solid dark background
    border: '#3a5a2a', // olive border
    borderHi: '#5a7a3a', // bright olive border
    scanline: 'rgba(50,80,50,0.1)', // CRT scanline effect
    text: '#88cc66', // green text (radar green)
    textBright: '#aaff88', // bright green text
    textDim: '#446633', // dim green text
    // HP bar: green when healthy, red when critical
    hp: '#44aa44', // green (healthy)
    hpMed: '#ccaa33', // yellow (medium)
    hpLow: '#cc3333', // red (critical)
    hpBar: '#1a2a1a', // dark background
    hpBorder: '#3a5a2a', // olive border
    // Infamy: orange-amber (warning color)
    infamy: '#cc8833', // amber (Infamy)
    infamyBar: '#1a1a0a', // dark background
    infamyBorder: '#5a4a2a', // amber border
    // Ammo/Equipment: cyan (electronics)
    rocket: '#44cccc', // cyan (rocket ammo)
    rocketEmpty: '#224444', // dim cyan (empty)
    equipment: '#44cccc', // cyan (equipment)
    equipEmpty: '#224444', // dim cyan (empty)
    equipCooldown: '#666633', // olive (recharging)
    // Minimap: military radar
    minimap: '#0a120a', // very dark green-black
    minimapGrid: '#1a2a1a', // subtle green grid
    minimapSweep: 'rgba(50,200,50,0.1)', // radar sweep line
    player: '#44ff44', // bright green dot
    enemy: '#ff4444', // bright red dot
    settlement: '#ffcc44', // yellow diamond
    boss: '#ff2222', // bright red triangle
    // Timer
    timer: '#88cc66', // green (normal)
    timerLow: '#ff4444', // red (low time, pulsing)
    // Direction arrow
    arrow: '#ff4444', // red (boss direction)
  },

  // === PROJECTILES ===
  projectile: {
    bullet: '#ffdd44', // bright yellow (tracer — very visible)
    bulletTrail: '#ffaa33', // orange (trail)
    rocket: '#ff6633', // orange-red (rocket body)
    rocketFlame: '#ffcc33', // yellow (exhaust flame)
    rocketTrail: '#aa6633', // brown (smoke)
    missile: '#ff4444', // red (missile body)
    missileTrail: '#aa3333', // darker (smoke)
    enemy: '#ff8866', // light red-orange (enemy bullets)
    enemyTrail: '#cc5533', // darker trail
  },

  // === VFX ===
  vfx: {
    explosion: ['#ffdd44', '#ff8833', '#cc3333', '#663333'], // flash->fire->smoke->ash
    muzzle: '#ffdd44', // muzzle flash (bright yellow)
    spark: '#ffdd44', // spark (yellow)
    sparkHi: '#ffffff', // white-hot spark center
    smoke: '#777777', // gray smoke
    smokeDark: '#444444', // dark smoke
    fire: '#ff6633', // fire orange
    fireBright: '#ffaa33', // bright fire
    chainLight: '#44ddff', // cyan-blue (chain lightning)
    napalm: '#ff6633', // orange (burning)
    napalmBright: '#ffaa33', // bright napalm
    damageNum: '#ffffff', // white (damage numbers)
    damageCrit: '#ffdd44', // yellow (critical hit)
    healNum: '#44ff44', // green (heal numbers)
    infamyUp: '#ffaa33', // amber (Infamy gain)
  },

  // === TERRAIN DECORATION ===
  deco: {
    crater: '#7a6a4a', // dark crater
    craterRim: '#9a8a5a', // crater rim (lighter)
    stain: 'rgba(100,60,20,0.3)', // ground stain (death mark)
    bush: '#4a8a3a', // desert bush (vibrant green)
    rock: '#8a7a5a', // small rock
    crate: '#a08050', // wood crate
    crateHi: '#b09060', // crate highlight
    crateStripe: '#cc3333', // crate marking (red)
  },
};
```

### R2. Gunship Rendering (5 Types)

All gunships drawn using primitives. The body faces the movement direction. Rotor spins continuously (~10 rev/sec visual). Shadow is a dark ellipse on the ground below.

#### R2.1 AH-1 Cobra (Starter)

```
Profile: Narrow, sleek, aggressive. The original attack helicopter.
Size: Small (body width ~12px, length ~20px at scale 1)

Drawing order (back to front):
1. Shadow: dark ellipse on ground (offset down by vExag factor)
2. Tail boom: thin box25 extending behind body
   - Width: 2px, Height: 2px, Length: 10px
   - Color: gunship.body
3. Tail rotor: small rotating circle on tail
   - Radius: 1px, Color: gunship.rotor
   - Spin: counter-rotate to main rotor
4. Main body: narrow box25 (fuselage)
   - Width: 8px, Height: 5px, Length: 14px
   - Color: gunship.body, Side: gunship.bodyDark
5. Cockpit: small dome on front
   - cyl25 with r:3, h:2
   - Color: gunship.cockpit (glass blue)
   - Specular highlight arc
6. Weapon pods: two small box25 on sides
   - Width: 2px, Height: 2px, Length: 6px
   - Color: gunship.weaponPod
   - Position: mid-body, one each side
7. Chin turret: small frustum25 under nose
   - rxBot: 1.5, rxTop: 1, h: 2
   - Color: gunship.weaponPod
   - Rotates toward nearest enemy
8. Main rotor: rotating line on top
   - Line from -8px to +8px (rotating)
   - Color: gunship.rotor
   - Blur effect: draw 2 lines at 90° offset for motion blur
9. Landing skids: two thin lines underneath
   - Width: 1px, Length: 10px
   - Color: gunship.skid

Tilt: leans forward 5-10° when moving fast
```

#### R2.2 AH-1W SuperCobra

```
Profile: Wider than Cobra, twin exhaust, 4-blade rotor.
Size: Medium (body width ~14px, length ~22px)

Differences from Cobra:
- Body: wider box25 (10px vs 8px)
- Twin exhaust pipes: two small cylinders on rear sides
- 4-blade rotor: two crossing lines (instead of one)
- External pylons: visible weapon hardpoints on stub wings
- Slightly darker body color (more military green)
```

#### R2.3 AH-64 Apache

```
Profile: Angular, aggressive, larger. THE modern gunship.
Size: Large (body width ~16px, length ~26px)

Drawing order:
1. Shadow
2. Tail boom: wider than Cobra/SC, with horizontal stabilizer
3. Tail rotor: on right side of tail
4. Main body: angular box25 (NOT rounded — angular = aggressive)
   - Width: 14px, Height: 7px, Length: 20px
   - Extra angles: top face slightly angled
5. Cockpit: tandem (two-seat, longer canopy)
   - Two glass domes in sequence
   - Color: gunship.cockpit
6. Stub wings: short wings on each side
   - Width: 3px, Length: 8px
   - Weapon pylons underneath (rockets, Hellfire)
7. Chain gun: frustum25 under nose
   - Longer than Cobra's turret
   - Color: gunship.weaponPod
   - Visible barrel
8. Sensor turret: small sphere on nose (above chain gun)
   - cyl25 with r:2, h:1.5
   - Color: gunship.weaponPod
9. Main rotor: 4-blade (two crossing lines)
10. Landing gear: wheels (not skids)
    - Two small circles underneath

Tilt: leans forward 8-12° when moving fast
```

#### R2.4 AH-64D Longbow

```
Profile: Apache + mast-mounted radar dome.
Size: Same as Apache + radar on top

Differences from Apache:
- Mast radar: dome on top of main rotor mast
  - cyl25 with r:3, h:2, on top of rotor hub
  - Color: gunship.weaponPod
  - Slight rotation animation (spins slowly)
- Slightly darker body (representing upgraded systems)
```

#### R2.5 RAH-66 Comanche (Prestige)

```
Profile: Stealth faceted body, futuristic, sleek.
Size: Medium-large (body width ~14px, length ~24px)

Drawing order:
1. Shadow
2. Tail: fenestron (enclosed tail rotor)
   - Not exposed like other gunships
   - Small circle inside tail structure
3. Main body: FACETED (angular, flat panels — stealth look)
   - NOT rounded — all straight edges
   - Width: 12px, Height: 6px, Length: 22px
   - Color: gunship.stealth (darker olive)
   - Extra specular highlights on facets (metallic look)
4. Cockpit: single-seat, low-profile canopy
   - Smaller glass area than Apache
   - Color: gunship.cockpit
5. Internal weapons bay: NOT external pylons
   - Weapons emerge from belly (bay doors open briefly)
   - When firing: bay doors open, weapon extends, fires, retracts
6. Main rotor: 5-blade (three lines at 72° intervals)
   - Bearingless rotor (smoother visual)
   - Faster spin rate than other gunships
7. Landing gear: retractable (not visible in flight)

Tilt: leans forward 10-15° when moving fast (more agile feel)
Special: occasional visual "shimmer" effect (stealth field)
```

### R3. Enemy Rendering (15 Types)

All enemies drawn as simple silhouettes. The goal: player recognizes enemy type BY SHAPE, not by color. Each type has a unique silhouette.

#### R3.1 Infantry (4 types)

```
All infantry: small circle body + directional indicator

Rifleman (circle + line):
  - Body: filled circle, r=3, color: enemy.infantry
  - Direction: short line extending toward player (gun direction)
  - Line length: 4px
  - Color: enemy.infantry

Assault Rifle (circle + thicker line):
  - Body: filled circle, r=3, color: enemy.infantry
  - Direction: slightly thicker line (3px vs 2px)
  - Indicates higher volume of fire

Machine Gun Team (circle + wide line + dot):
  - Body: filled circle, r=3, color: enemy.infantry
  - Direction: wide line (4px) representing sustained fire
  - Extra dot on line (bipod indicator)

Heavy Machine Gun (circle + long line + base):
  - Body: filled circle, r=4, color: enemy.infantry (slightly larger)
  - Direction: long line (6px)
  - Small rectangle behind circle (sandbag base)
  - Stationary indicator (no movement jitter)
```

#### R3.2 Light AA (2 types)

```
Light AA Gun (rectangle + barrel):
  - Base: small rectangle (4x3px), color: enemy.aa
  - Barrel: line extending from rectangle (5px)
  - Two barrels side-by-side (twin mount indicator)

Twin 23mm AA (rectangle + thick barrel):
  - Base: medium rectangle (5x4px), color: enemy.aa
  - Barrel: thicker line (3px wide, 6px long)
  - Slightly larger than Light AA
  - Muzzle flash indicator when firing
```

#### R3.3 Heavy AA (2 types)

```
Shilka (tracked vehicle + quad barrels):
  - Body: rectangle (8x6px), color: enemy.aa
  - Tracks: two small rectangles underneath (1x6px each)
  - Turret: small square on top (3x3px)
  - Barrels: four short lines from turret (quad mount)
  - Radar dish: small circle on turret (r=2)
  - MOVES: slight jitter when relocating

Heavy 57mm AA (rectangle + long barrel):
  - Base: large rectangle (10x6px), color: enemy.aa
  - Barrel: long line (8px, thick)
  - No turret (fixed mount)
  - Sandbag indicators: small rectangles around base
  - Stationary (never moves)
```

#### R3.4 MANPADS (1 type)

```
MANPADS Team (circle + missile shape):
  - Body: small circle, r=3, color: enemy.infantry
  - Weapon: thin rectangle on shoulder (2x4px)
  - HIDDEN: semi-transparent until firing (alpha: 0.3)
  - When firing: full opacity, missile trail visible
  - RELOCATES: after firing, fades back to semi-transparent
  - Key visual: the "surprise" factor — hard to spot
```

#### R3.5 Mobile SAM (1 type)

```
Mobile SAM (vehicle + radar + launcher):
  - Body: rectangle (8x5px), color: enemy.aa
  - Radar: circle on top (r=2.5), color: enemy.aaHi
  - Launcher: angled rectangle on rear (2x4px, tilted 30°)
  - Tracks: two small rectangles underneath
  - MOVES: follows formation, stops to engage
  - When engaging: radar spins, launcher elevates
```

#### R3.6 Vehicles (3 types)

```
Technical (jeep + mounted gun):
  - Body: small rectangle (6x4px), color: enemy.vehicle
  - Gun mount: small square on rear (2x2px) + barrel line
  - Open top (no roof indicator)
  - FAST: moves quickly between positions

APC (armored box + turret):
  - Body: medium rectangle (8x5px), color: enemy.vehicle
  - Turret: small square on top (3x3px)
  - Barrel: short line from turret
  - Tracks: two small rectangles underneath
  - Armored look: thicker borders

Main Battle Tank (large box + turret + long barrel):
  - Body: large rectangle (10x7px), color: enemy.tank
  - Turret: medium square on top (5x5px)
  - Barrel: long line (8px, thick)
  - Tracks: two rectangles underneath (1x8px each)
  - HEAVY: slow movement, imposing silhouette
```

#### R3.7 Aircraft (2 types)

```
Attack Helicopter (similar to player but different shape):
  - Body: medium box25 (10x5px), color: enemy.heli
  - Turret: small circle underneath (chin-mounted)
  - Stub wings: short lines on sides
  - Rotor: single rotating line on top
  - Shadow: ellipse on ground
  - Key difference from player: different body proportions, enemy colors

Fighter (sleek triangle + swept wings):
  - Body: triangle shape (nose pointing forward)
  - Wings: swept-back triangles on sides
  - Tail: vertical stabilizer (small triangle)
  - FAST: moves quickly, brief flyby
  - Key visual: the "Oh shit" moment — clearly not a helicopter
```

### R4. Building Rendering (20+ Types)

Buildings drawn as static silhouettes. Consistent style: box25 base + unique detail.

#### R4.1 Civilian Buildings

```
Hovel (small, round):
  - Base: cyl25, r:1.5, h:2
  - Color: building.concrete
  - Roof: cone on top (pointed)
  - Size: small (2x2 tiles)

House (small, rectangular):
  - Base: box25, w:2, h:2, d:2
  - Color: building.concrete
  - Flat roof (no dome)
  - Size: small (2x2 tiles)

Shop (small, open front):
  - Base: box25, w:2, h:1.5, d:2
  - Color: building.concrete
  - One face missing (open front)
  - Size: small (2x2 tiles)

Mosque (medium, dome):
  - Base: cyl25, r:3, h:4
  - Color: building.concrete
  - Dome on top: smaller cyl25
  - Minaret: thin cylinder on side (tall, thin)
  - Size: large (4x4 tiles)

Apartment (medium, rectangular):
  - Base: box25, w:3, h:5, d:4
  - Color: building.concrete
  - Multiple windows (small squares on faces)
  - Flat roof
  - Size: large (3x4 tiles)
```

#### R4.2 Military Buildings

```
Tent (triangle profile):
  - Base: diamondPrism25, rx:2, h:1.5
  - Color: building.tent
  - Flaps visible on sides
  - Size: small (2x2 tiles)

Command Tent (larger tent):
  - Base: diamondPrism25, rx:3, h:2
  - Color: building.tent
  - Antenna on top (thin line)
  - Size: medium (3x3 tiles)

Watchtower (tall thin structure):
  - Base: cyl25, r:0.5, h:6 (tall and thin)
  - Color: building.metal
  - Platform on top: box25, w:2, h:1, d:2
  - Searchlight: small circle on platform
  - Size: small footprint (1x1 tiles)

Bunker (low thick structure):
  - Base: box25, w:3, h:2, d:3
  - Color: building.concrete
  - Sandbag indicators around entrance
  - Thick walls (extra border)
  - Size: medium (3x3 tiles)

Barracks (medium rectangular):
  - Base: box25, w:4, h:2, d:3
  - Color: building.concrete
  - Multiple doors/windows
  - Size: large (4x3 tiles)

Hangar (large arched):
  - Base: half-cylinder shape (arched roof)
  - Color: building.metal
  - Large door on one face
  - Size: large (5x4 tiles)

Ammo Dump (small, explosive):
  - Base: box25, w:2, h:2, d:2
  - Color: building.metal
  - Explosive indicator: red stripes on sides
  - EXPLODES when destroyed (large radius)
  - Size: small (2x2 tiles)

Radar Dish (tall with dish):
  - Base: cyl25, r:1, h:4 (tower)
  - Color: building.metal
  - Dish on top: ring25, r:3 (rotating)
  - HIGH-PRIORITY: reddish tint
  - Timer bonus: +30s when destroyed
  - Size: small footprint (2x2 tiles)

Command Center (large, important):
  - Base: box25, w:3, h:3, d:3
  - Color: building.concrete
  - Antenna on top (multiple thin lines)
  - Satellite dish on roof
  - HIGH-PRIORITY: reddish tint
  - Timer bonus: +30s when destroyed
  - Size: medium (3x3 tiles)

Motor Pool (medium, vehicle storage):
  - Base: box25, w:4, h:2, d:3
  - Color: building.metal
  - Open bay doors
  - Size: large (4x3 tiles)

Sandbag Wall (short barrier):
  - Base: box25, w:1, h:1, d:1
  - Color: building.sandbag
  - Low profile (cover for infantry)
  - Size: small (1x1 tiles)
```

#### R4.3 Fuel Depot Buildings

```
Fuel Tank (cylinder, explosive):
  - Base: cyl25, r:1.5, h:3
  - Color: building.fuel
  - Red warning stripe around middle
  - EXPLODES when destroyed (radius: 60, damage: 50)
  - Extends boss timer: +20s
  - Size: small (2x2 tiles)

Storage Shed (small):
  - Base: box25, w:2, h:1.5, d:2
  - Color: building.metal
  - Generic storage
  - Size: small (2x2 tiles)

Pipe Network (ground-level):
  - Base: ring25 on ground + connecting lines
  - Color: building.metal
  - Visual: pipes running between fuel tanks
  - Size: small (1x1 tiles)
```

### R5. HUD Rendering

```
All HUD elements rendered on top of game world (after camera restore).
Position: fixed screen coordinates, not world coordinates.

Layout (portrait mode):
+---------------------------------------------+
| [HP BAR]                       [BOSS TIMER]  |
| ████░░░░░░                    02:15          |
|                                              |
| [INFAMY BAR]                                 |
| ████████░░░░░░░░                             |
|                                              |
|              (game world)                    |
|                                              |
|                                              |
| [ROCKETS]                  [MINIMAP]         |
| ●●●●                     +----------+       |
|                           | ·  ·  ·  |       |
| [EQUIPMENT]               |  ·     · |       |
| ◆◆◆                      | ·  ·  ·  |       |
|                           +----------+       |
+---------------------------------------------+

HP BAR:
  Position: top-left, margin 10px
  Size: 120px wide, 8px tall
  Background: ui.hpBar (dark)
  Fill: ui.hp (green) or ui.hpLow (red when < 30%)
  Border: ui.border (olive)
  Label: "HP" text to the left
  Text: current/max HP to the right

INFAMY BAR:
  Position: below HP bar, 4px gap
  Size: 120px wide, 6px tall
  Background: ui.infamyBar (dark)
  Fill: ui.infamy (orange-red)
  Label: "INFAMY" text to the left
  Text: current level to the right (e.g., "Lv. 5")

BOSS TIMER:
  Position: top-right, margin 10px
  Size: text-based (MM:SS format)
  Color: ui.timer (light tan)
  Color when < 30s: ui.timerLow (red, pulsing)
  Label: "INCOMING" above timer
  When boss spawns: replaced with direction arrow

ROCKETS:
  Position: bottom-left, margin 10px
  Style: filled circles (●) for ammo
  Color: ui.rocket (yellow)
  Empty: outline circle (○)
  Label: "ROCKETS" above dots

EQUIPMENT:
  Position: below rockets, 4px gap
  Style: filled diamonds (◆) for charges
  Color: ui.equipment (cyan)
  Empty: outline diamond (◇)
  Cooldown: gray fill + countdown number
  Label: "EQUIPMENT" above diamonds

MINIMAP:
  Position: bottom-right, margin 10px
  Default size: 100x100px
  Background: ui.minimap (very dark)
  Grid: ui.minimapGrid (subtle olive lines)
  Border: ui.border (olive)
  Player: ui.player (green dot, center)
  Enemies: ui.enemy (red dots)
  Settlements: ui.settlement (yellow diamonds)
  Boss: ui.boss (large red triangle)
  View cone: triangle showing player's view direction
```

### R6. Minimap Rendering

```
Default (small):
  - 100x100px, bottom-right
  - Dark background with grid
  - Player dot (green, center)
  - Enemy dots (red, relative position)
  - Settlement diamonds (yellow, relative position)
  - Boss triangle (red, when spawned)

Expanded (tap to expand):
  - 200x200px
  - Building outlines (simple rectangles)
  - Settlement names (text labels)
  - Terrain color hints (sand = tan, rock = brown)
  - Player view cone (triangle)

Fullscreen (double-tap):
  - 300x300px or fullscreen overlay
  - Full world view
  - All discovered settlements named
  - Difficulty zones color-coded (green -> yellow -> red from center)
  - Can tap to set waypoints
```

### R7. Projectile Rendering

```
Bullet (primary weapon):
  - Shape: small elongated rectangle (2x1px)
  - Color: projectile.bullet (yellow)
  - Trail: short line fading behind (2-3 frames)
  - Trail color: projectile.bulletTrail (orange)
  - Angle: matches travel direction

Rocket (dumbfire):
  - Shape: larger rectangle (4x2px)
  - Color: projectile.rocket (orange-red)
  - Flame at back: small triangle (exhaust)
  - Smoke trail: expanding circles fading behind
  - Impact: large explosion circle + debris particles

Guided Missile:
  - Shape: thin rectangle (3x1px)
  - Color: projectile.missile (red)
  - Smoke trail: curves with missile path
  - Launch arc: pops up then dives toward target
  - Tracking indicator: slight wobble in flight

Enemy Bullet:
  - Shape: small circle (1px radius)
  - Color: projectile.enemy (light red)
  - Trail: very short (1 frame)
  - Tracer effect: line behind bullet

Enemy Missile:
  - Shape: thin rectangle (2x1px)
  - Color: projectile.missile (red)
  - Smoke trail: visible
  - Warning: alarm sound when launched
```

### R8. VFX Rendering

```
Explosion (3 stages):
  Stage 1 (0-0.1s): bright flash (circle, vfx.muzzle, expanding rapidly)
  Stage 2 (0.1-0.3s): fire ball (circle, vfx.fire, expanding slower)
  Stage 3 (0.3-0.8s): smoke cloud (circle, vfx.smoke, expanding slowly, fading)
  Particles: sparks flying outward (vfx.spark)
  Debris: small rectangles flying outward (if building destroyed)

Muzzle Flash:
  - Small radial gradient (circle, vfx.muzzle)
  - Duration: 0.05s (very brief)
  - 3 sparks flying outward

Chain Lightning:
  - Zigzag line between source and target
  - Color: vfx.chainLight (blue)
  - Kinks: 3-5 random offset points along line
  - Duration: 0.2s
  - Branch: splits to 1-2 nearby enemies

Napalm Trail:
  - Ground-level fire (elongated ellipse)
  - Color: vfx.napalm (orange)
  - Duration: 2s
  - Damage: 5 per tick to enemies in area
  - Visual: flickering animation

Damage Numbers:
  - Text floating upward from hit enemy
  - Color: vfx.damageNum (white)
  - Size: 12px font
  - Duration: 0.8s
  - Fade out as they float up

Heal Numbers:
  - Text floating upward from helicopter
  - Color: vfx.healNum (green)
  - Size: 12px font
  - Duration: 0.8s

Smoke Screen:
  - Large semi-transparent gray cloud
  - Color: vfx.smoke with alpha 0.5
  - Duration: 8s
  - Blocks line of sight (enemies can't target player inside)

Flare Burst:
  - Multiple small bright circles expanding outward
  - Color: #ffcc33 (bright yellow)
  - Duration: 0.5s
  - 8-10 particles

Status Puff (for effects like napalm burn):
  - Small upward-drifting puff
  - Color: depends on status type
  - Duration: 0.3s
```

### R9. Screen Effects

```
Low HP Warning:
  - Red vignette on screen edges (radial gradient)
  - Intensity: scales with missing HP
  - Most intense when < 20% HP
  - Subtle pulsing animation

Boss Warning:
  - Pulsing red border around entire screen
  - Intensity: increases as boss approaches
  - Direction arrow: red chevron on screen edge pointing to boss
  - Distance counter: "1200m" text near arrow

Settlement Clear:
  - Brief banner (center screen)
  - Text: settlement name + "CLEARED" + reward
  - Duration: 2s
  - Fade in/out animation

Infamy Level Up:
  - Full-screen overlay (game pauses)
  - Title: "INFAMY GROWS..." (large text)
  - Current level displayed
  - 3 weapon upgrade cards (see UI section)
  - Cards have distinct colors per tier (T1: tan, T2: orange, T3: red)

Damage Direction:
  - Red flash on screen edge where damage came from
  - Duration: 0.2s
  - Helps player identify threat direction
```
