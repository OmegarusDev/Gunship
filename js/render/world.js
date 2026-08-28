/**
 * render/world.js — sites, decorations, scenario overlays, buildings.
 * Extracted from app.js. Functions take explicit world/heli/enemies/boss for testability.
 */
import { P, mats } from '../palette.js';
import { withAlpha } from '../drawUtil.js';
import { VIEW25, deckRy } from '../view25.js';
import { box25, frustum25 } from '../prims25.js';
import { WORLD_SIZE } from '../config.js';
import { clamp } from '../rng.js';
import { getConvoyMembers } from '../sim/movement.js';
import { isTargetAlive as _isTargetAlive } from '../sim/objectives.js';

let _world = null, _heli = null, _enemies = null, _boss = null;
export function setWorldState(world, heli, enemies, boss) { _world = world; _heli = heli; _enemies = enemies; _boss = boss; }


function drawBuilding(ctx, b) {
  if (b.destroyed) {
    ctx.fillStyle = withAlpha('#3a2a1a', 0.7);
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, b.w * 0.55, b.d * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const m = mats(b.col);
  const cx = b.x;
  const cy = b.y;

  // Shadow
  ctx.fillStyle = withAlpha('#000000', 0.2);
  ctx.beginPath();
  ctx.ellipse(cx + 3, cy + 4, b.w * 0.6, b.d * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  if (b.type === 'tower') {
    frustum25(ctx, cx, cy - b.h, b.w / 2, b.w / 2.5, b.h, m);
    // Antenna on top
    ctx.strokeStyle = P.building.antenna;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy - b.h - 8);
    ctx.lineTo(cx, cy - b.h);
    ctx.stroke();
    // Antenna tip light
    ctx.fillStyle = withAlpha('#ff4444', 0.6 + Math.sin(performance.now() / 300) * 0.3);
    ctx.beginPath();
    ctx.arc(cx, cy - b.h - 8, 1.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    box25(ctx, cx, cy - b.h, b.w, b.d, b.h, m);
  }

  // Building-specific details
  if (b.type === 'depot' || b.type === 'garage') {
    // Rolling door
    ctx.fillStyle = withAlpha(P.building.steelDark, 0.6);
    ctx.fillRect(cx - b.w * 0.25, cy - b.h * 0.3, b.w * 0.5, b.h * 0.3);
    ctx.strokeStyle = P.building.steel;
    ctx.lineWidth = 0.8;
    // Door slats
    for (let i = 0; i < 3; i++) {
      const dy = cy - b.h * 0.3 + i * (b.h * 0.1);
      ctx.beginPath();
      ctx.moveTo(cx - b.w * 0.25, dy);
      ctx.lineTo(cx + b.w * 0.25, dy);
      ctx.stroke();
    }
  }

  if (b.type === 'barracks') {
    // Windows
    ctx.fillStyle = withAlpha('#2a3a2a', 0.5);
    const winW = 4, winH = 3;
    for (let i = -1; i <= 1; i++) {
      ctx.fillRect(cx + i * 12 - winW / 2, cy - b.h * 0.6, winW, winH);
    }
  }

  if (b.type === 'fuel') {
    ctx.strokeStyle = withAlpha(P.highPriority.stripe, 0.6);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, b.w / 2 + 4, 0, Math.PI * 2);
    ctx.stroke();
    const ry = deckRy(b.d / 2);
    ctx.fillStyle = P.building.hazard;
    ctx.fillRect(cx - b.w / 3, cy - ry * 0.3, b.w / 1.5, 2);
    ctx.fillRect(cx - b.w / 3, cy + ry * 0.3, b.w / 1.5, 2);
  }

  // Outline on all buildings
  ctx.strokeStyle = P.enemy.outline;
  ctx.lineWidth = 1.2;
  if (b.type === 'tower') {
    ctx.beginPath();
    ctx.arc(cx, cy - b.h, b.w / 2 + 1, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // Bottom edge only for box buildings
    const ry = deckRy(b.d / 2);
    ctx.beginPath();
    ctx.moveTo(cx - b.w / 2, cy);
    ctx.lineTo(cx + b.w / 2, cy);
    ctx.lineTo(cx + b.w / 2, cy - b.h);
    ctx.stroke();
  }
}

function drawSites(ctx, cam) {
  if (!_world) return;
  for (const v of _world.sites) {
    if (!cam.isVisible(v.x, v.y, 120)) continue;
    const markerColor = v.cleared ? '#44ff44' : v.archetype === 'base' ? P.ui.enemy : P.ui.settlement;

    // Village perimeter glow
    ctx.fillStyle = withAlpha(markerColor, 0.08);
    ctx.beginPath();
    ctx.arc(v.x, v.y, 60, 0, Math.PI * 2);
    ctx.fill();

    // Archetype-specific marker
    ctx.strokeStyle = withAlpha(markerColor, 0.4);
    ctx.lineWidth = 1.5;
    if (v.archetype === 'base') {
      // Square perimeter for bases
      ctx.strokeRect(v.x - 45, v.y - 45, 90, 90);
    } else if (v.archetype === 'town') {
      // Double circle for towns
      ctx.beginPath(); ctx.arc(v.x, v.y, 50, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(v.x, v.y, 40, 0, Math.PI * 2); ctx.stroke();
    } else if (v.archetype === 'camp') {
      // Triangle for camps
      ctx.beginPath();
      ctx.moveTo(v.x, v.y - 45);
      ctx.lineTo(v.x + 40, v.y + 25);
      ctx.lineTo(v.x - 40, v.y + 25);
      ctx.closePath();
      ctx.stroke();
    } else {
      // Circle for rural
      ctx.beginPath(); ctx.arc(v.x, v.y, 35, 0, Math.PI * 2); ctx.stroke();
    }

    // Site name
    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = v.cleared ? '#44ff44' : P.ui.settlement;
    ctx.fillText(v.name, v.x, v.y - 60);
    // Archetype label
    ctx.fillStyle = P.ui.textDim;
    ctx.font = '8px "Courier New", monospace';
    ctx.fillText(v.archetype.toUpperCase(), v.x, v.y - 49);
    // Enemy count (if discovered, not cleared)
    if (v.discovered && !v.cleared) {
      const alive = _enemies.filter(e => e.siteId === v.id && e.state !== 'dead').length;
      ctx.fillStyle = alive > 0 ? P.ui.enemy : '#44ff44';
      ctx.fillText(`${alive} HOSTILE${alive !== 1 ? 'S' : ''}`, v.x, v.y + 50);
    }
    if (v.cleared) {
      ctx.fillStyle = '#44ff44';
      ctx.fillText('CLEARED', v.x, v.y + 50);
    }
  }
}

function drawDecorations(ctx, cam) {
  if (!_world) return;
  for (const d of _world.decorations) {
    if (!cam.isVisible(d.x, d.y, 20)) continue;
    if (d.type === 'bush') {
      ctx.fillStyle = withAlpha('#6a8a3a', 0.7);
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = withAlpha('#4a6a2a', 0.4);
      ctx.beginPath();
      ctx.arc(d.x + 1, d.y + 1, d.size * 0.7, 0, Math.PI * 2);
      ctx.fill();
    } else if (d.type === 'rock') {
      ctx.fillStyle = '#8a7a5a';
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, d.size, d.size * 0.6, d.angle, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = withAlpha('#000000', 0.15);
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (d.type === 'palm') {
      ctx.strokeStyle = '#8a6a3a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x + 2, d.y - d.size * 1.5);
      ctx.stroke();
      const fx = d.x + 2;
      const fy = d.y - d.size * 1.5;
      ctx.fillStyle = withAlpha('#4a8a2a', 0.8);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + d.angle;
        ctx.beginPath();
        ctx.ellipse(fx, fy, d.size * 0.8, 2, a, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (d.type === 'crater') {
      ctx.strokeStyle = withAlpha('#6a5a3a', 0.3);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = withAlpha('#7a6a4a', 0.15);
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.size * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawScenarioOverlays(ctx, cam) {
  if (!_world) return;

  // ── INFRA mode: mark the eligible target pool so it's visible ──
  if (_heli.targetMode === 'infrastructure') {
    const cands = [];
    for (const b of _world.buildings) {
      if (!b.destructible || b.destroyed) continue;
      const d = Math.hypot(b.x - _heli.x, b.y - _heli.y);
      if (d < _heli.weaponRange) cands.push({ x: b.x, y: b.y, d, r: Math.max(b.w, b.d) * 0.6 });
    }
    for (const convoy of _world.convoys) {
      if (!convoy.active || convoy.destroyed) continue;
      const d = Math.hypot(convoy.x - _heli.x, convoy.y - _heli.y);
      if (d < _heli.weaponRange) cands.push({ x: convoy.x, y: convoy.y, d, r: 14 });
    }
    cands.sort((a, b) => a.d - b.d);
    ctx.strokeStyle = 'rgba(68,221,255,0.4)';
    ctx.lineWidth = 1;
    for (const c of cands.slice(0, 14)) {
      if (!cam.isVisible(c.x, c.y, 40)) continue;
      const r = Math.max(c.r, 8);
      // Four corner ticks
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.beginPath();
        ctx.moveTo(c.x + sx * r, c.y + sy * r - sy * 5);
        ctx.lineTo(c.x + sx * r, c.y + sy * r);
        ctx.lineTo(c.x + sx * r - sx * 5, c.y + sy * r);
        ctx.stroke();
      }
    }
  }

  if (_world.extraction?.active) {
    // Extraction = leave the map. Highlight the nearest boundary edge.
    const lim = WORLD_SIZE * 0.48;
    const dL = _heli.x + lim, dR = lim - _heli.x;
    const dT = _heli.y + lim, dB = lim - _heli.y;
    const m = Math.min(dL, dR, dT, dB);
    const pulse = 0.55 + 0.35 * Math.sin(performance.now() / 220);
    ctx.strokeStyle = withAlpha('#44ddff', pulse);
    ctx.lineWidth = 6;
    ctx.beginPath();
    if (m === dL) { ctx.moveTo(-lim, -lim); ctx.lineTo(-lim, lim); }
    else if (m === dR) { ctx.moveTo(lim, -lim); ctx.lineTo(lim, lim); }
    else if (m === dT) { ctx.moveTo(-lim, -lim); ctx.lineTo(lim, -lim); }
    else { ctx.moveTo(-lim, lim); ctx.lineTo(lim, lim); }
    ctx.stroke();
  }

  for (const crate of _world.supplyCrates || []) {
    if (crate.collected || !cam.isVisible(crate.x, crate.y, 30)) continue;
    const pulse = 1 + Math.sin(performance.now() / 240 + crate.x) * 0.08;
    ctx.fillStyle = '#c09050';
    ctx.fillRect(crate.x - 7 * pulse, crate.y - 7 * pulse, 14 * pulse, 14 * pulse);
    ctx.strokeStyle = '#ffcc44';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(crate.x - 7 * pulse, crate.y - 7 * pulse, 14 * pulse, 14 * pulse);
    ctx.strokeStyle = '#ffcc44';
    ctx.beginPath();
    ctx.moveTo(crate.x - 6, crate.y); ctx.lineTo(crate.x + 6, crate.y);
    ctx.moveTo(crate.x, crate.y - 6); ctx.lineTo(crate.x, crate.y + 6);
    ctx.stroke();
  }

  const target = _world.objective?.target;
  if (target && _isTargetAlive(_world, _boss, target) && target !== _boss) {
    ctx.strokeStyle = withAlpha('#ff4444', 0.75);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(target.x, target.y, target.w ? Math.max(target.w, target.d) * 0.7 : 18, 0, Math.PI * 2);
    ctx.stroke();
    if (target.hp !== undefined && target.maxHp) {
      const barW = target.w ? Math.max(34, target.w * 1.5) : 34;
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(target.x - barW / 2, target.y - 22, barW, 4);
      ctx.fillStyle = '#ff4444';
      ctx.fillRect(target.x - barW / 2, target.y - 22, barW * clamp(target.hp / target.maxHp, 0, 1), 4);
    }
    ctx.fillStyle = '#ff8844';
    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(_world.objective.type === 'intercept' ? 'CONVOY TARGET' : 'PRIMARY TARGET', target.x, target.y - 28);
  }
}

export { drawBuilding, drawSites, drawDecorations, drawScenarioOverlays };
