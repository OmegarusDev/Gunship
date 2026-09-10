<p align="center">
  <a href="https://omegarusdev.github.io/Gunship/">
    <img src="https://img.shields.io/badge/▶_PLAY_NOW-playable_in_browser-brightgreen?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Play Now" height="40" />
  </a>
</p>

<p align="center"><strong>No install.</strong> Works in the browser (desktop & mobile).</p>

# Gunship — Freedom Protocol

A browser helicopter-combat roguelite. Take contracts, fly the op, complete the
objective, defeat the responding commander, and return with the aircraft. Bank
dollars and pilot XP between sorties — level your pilot, spend skill points on a
cross-linked skill grid, and buy chopper upgrades in the hangar. The campaign has
four acts of three normal sorties plus a stronghold.

## Play

Click the badge above, or open **[omegarusdev.github.io/Gunship](https://omegarusdev.github.io/Gunship/)**.
It boots straight into the game — no setup.

## Controls

- **Menus / briefings** — mouse / touch (click the on-screen buttons; click **[ CLICK TO INSERT ]** to launch a sortie)
- **Move** — `WASD` or arrow keys
- **Fire** — `Space`
- **Cycle target priority** (closest / strongest / infrastructure) — `Shift`
- **Use equipment** (repair / overboost / rocket / flares) — `E`
- **Lock target** — click an enemy / vehicle / building

## Loop

`TITLE → OPERATIONS → contract → briefing → SORTIE → commander → debrief → next board`

Complete the primary objective and defeat the commander. Kills, objectives, and
commander victories award pilot XP and dollars; the debrief banks them into your
persistent career. The final stronghold awards prestige and starts a new
campaign with the Comanche unlocked.

**Practice** is available from the campaign hub for testing. It uses the active
campaign pilot and gunship, but grants no XP or dollars and cannot kill or reset
the pilot. In campaign mode, a hull loss kills the current pilot and restarts
campaign progress, while the selected gunship, hangar upgrades, unlocks, and
dollars persist.

## Development

It's a static site — no build step (ES modules, zero runtime deps).

```bash
# from the repo root
python3 -m http.server 8000
# then open http://localhost:8000
```

Run the verification gate (lint + meta + worldgen + sortie + targeting + browser smoke):

```bash
node tools/check.mjs
# or individually:
node tools/lint.mjs
node tools/meta-check.mjs
node tools/sortie-smoke.mjs
node tools/browser-smoke.mjs
```

With dev deps installed, you also get `eslint` + `prettier`:

```bash
npm install
npm run lint          # eslint + node --check
npm run format        # prettier
npm run check         # same as node tools/check.mjs
```

**Code layout:** `js/app.js` is the bootstrap/loop; sim logic lives in `js/sim/`, the geometry-first generator lives in `js/terrain.js` + `js/world/`, rendering in `js/render/`, and career state in `js/meta.js`. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the data flow.

## Rebuild

```bash
git clone https://github.com/OmegarusDev/Gunship.git && cd Gunship
npm ci && node tools/check.mjs   # syntax/invariants + meta + worldgen + sortie
python3 -m http.server 8000      # http://localhost:8000
```

`npm run dev` does the same. Push to `main` triggers `deploy-pages.yml` (setup-node → gate → deploy). See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Design

See [`GAME_DESIGN.md`](GAME_DESIGN.md) for the full design doc and [`ARCHITECTURE.md`](ARCHITECTURE.md) for how to extend it.
