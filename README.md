<p align="center">
  <a href="https://omegarusdev.github.io/Gunship/">
    <img src="https://img.shields.io/badge/▶_PLAY_NOW-playable_in_browser-brightgreen?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Play Now" height="40" />
  </a>
</p>

<p align="center"><strong>No install.</strong> Works in the browser (desktop & mobile).</p>

# Gunship — Freedom Protocol

A browser helicopter-combat roguelite. Take contracts, fly the op, complete the
objective, then **exit the map** to extract. Bank dollars and pilot XP between
sorties — level your pilot, spend skill points on a cross-linked skill grid, and
buy chopper upgrades in the hangar. The campaign advances one sortie at a time.

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

`TITLE → OPERATIONS → contract → briefing → SORTIE → debrief → next board`

Complete the primary objective, then fly off the map edge to extract. Kills and
objective completion award pilot XP and dollars; the debrief banks them into
your persistent career.

## Development

It's a static site — no build step.

```bash
# from the repo root
python3 -m http.server 8000
# then open http://localhost:8000
```

Run the headless verification gate:

```bash
node tools/check.mjs
```

## Design

See [`GAME_DESIGN.md`](GAME_DESIGN.md) for the full design doc.
