/**
 * render/world.js — physical places, decorations, scenario overlays, buildings.
 * Extracted from app.js. Functions take explicit world/heli/enemies/boss for testability.
 */
import { P, mats } from '../palette.js';
import { withAlpha } from '../drawUtil.js';
import { VIEW25, deckRy } from '../view25.js';
import { box25, frustum25, footprintPrism25 } from '../prims25.js';
import { WORLD_SIZE } from '../config.js';
import { clamp } from '../rng.js';
import { getConvoyMembers } from '../sim/movement.js';
import { isTargetAlive as _isTargetAlive } from '../sim/objectives.js';

let _world = null,
  _heli = null,
  _enemies = null,
  _boss = null;
export function setWorldState(world, heli, enemies, boss) {
  _world = world;
  _heli = heli;
  _enemies = enemies;
  _boss = boss;
}

function tracePolygon(ctx, polygon) {
  if (!polygon || polygon.length < 2) return false;
  ctx.beginPath();
  ctx.moveTo(polygon[0].x, polygon[0].y);
  for (let i = 1; i < polygon.length; i++) ctx.lineTo(polygon[i].x, polygon[i].y);
  ctx.closePath();
  return true;
}

function drawBuilding(ctx, b) {
  if (b.destroyed) {
    ctx.fillStyle = withAlpha('#3a2a1a', 0.7);
    if (tracePolygon(ctx, b.footprint)) ctx.fill();
    else {
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, b.w * 0.55, b.d * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  const m = mats(b.col);
  const cx = b.x;
  const cy = b.y;

  // Shadow
  ctx.fillStyle = withAlpha('#000000', 0.2);
  if (b.footprint?.length >= 3) {
    const shadow = b.footprint.map((point) => ({ x: point.x + 4, y: point.y + 5 }));
    tracePolygon(ctx, shadow);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.ellipse(cx + 3, cy + 4, b.w * 0.6, b.d * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (b.court && !b.destroyed) {
    ctx.fillStyle = withAlpha('#7d6840', 0.38);
    ctx.beginPath();
    ctx.ellipse(
      b.court.x,
      b.court.y,
      Math.max(5, b.w * 0.16),
      Math.max(4, b.d * 0.14),
      b.rotation || 0,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  if (b.type === 'tower' || b.type === 'minaret' || b.type === 'water_tower') {
    const top = b.type === 'water_tower' ? b.w / 1.6 : b.w / 2.6;
    frustum25(ctx, cx, cy - b.h, b.w / 2, top, b.h, m);
    if (b.type !== 'minaret') {
      ctx.strokeStyle = P.building.antenna;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy - b.h - 8);
      ctx.lineTo(cx, cy - b.h);
      ctx.stroke();
      ctx.fillStyle = withAlpha('#ff4444', 0.6 + Math.sin(performance.now() / 300) * 0.3);
      ctx.beginPath();
      ctx.arc(cx, cy - b.h - 8, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (b.type === 'water_tower') {
      ctx.fillStyle = withAlpha('#6d684f', 0.7);
      ctx.beginPath();
      ctx.ellipse(cx, cy - b.h + 3, b.w * 0.42, b.w * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (b.footprint?.length >= 3) {
    footprintPrism25(ctx, b.footprint, b.h, m);
  } else {
    box25(ctx, cx, cy - b.h, b.w, b.d, b.h, m);
  }

  // Building-specific details
  if (b.type === 'depot' || b.type === 'garage') {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(b.rotation || 0);
    // Rolling door
    ctx.fillStyle = withAlpha(P.building.steelDark, 0.6);
    ctx.fillRect(-b.w * 0.25, -b.h * 0.3, b.w * 0.5, b.h * 0.3);
    ctx.strokeStyle = P.building.steel;
    ctx.lineWidth = 0.8;
    // Door slats
    for (let i = 0; i < 3; i++) {
      const dy = -b.h * 0.3 + i * (b.h * 0.1);
      ctx.beginPath();
      ctx.moveTo(-b.w * 0.25, dy);
      ctx.lineTo(b.w * 0.25, dy);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (b.type === 'barracks') {
    // Windows
    ctx.fillStyle = withAlpha('#2a3a2a', 0.5);
    const winW = 4,
      winH = 3;
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

  // Ground-facing outline on all buildings.
  ctx.strokeStyle = P.enemy.outline;
  ctx.lineWidth = 1.2;
  if (b.type === 'tower' || b.type === 'minaret' || b.type === 'water_tower') {
    ctx.beginPath();
    ctx.arc(cx, cy - b.h, b.w / 2 + 1, 0, Math.PI * 2);
    ctx.stroke();
  } else if (b.footprint?.length >= 3) {
    tracePolygon(ctx, b.footprint);
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

function drawLandUseShape(ctx, shape) {
  const type = shape.kind || shape.type || 'yard';
  const polygon = shape.polygon || shape.footprint;
  const points = shape.points || shape.centerline;
  if (
    type === 'canal' ||
    type === 'irrigation' ||
    type === 'irrigation_canal' ||
    type === 'falaj_channel'
  ) {
    if (!points || points.length < 2) return;
    ctx.strokeStyle = withAlpha('#57756d', 0.58);
    ctx.lineWidth = shape.width || 5;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
    ctx.strokeStyle = withAlpha('#a9b28a', 0.28);
    ctx.lineWidth = 1;
    ctx.stroke();
    return;
  }
  if (!polygon || polygon.length < 3) return;
  const colors = {
    field: ['#9b8b50', 0.18],
    grove: ['#526b38', 0.22],
    palm_grove: ['#526b38', 0.24],
    sabkha: ['#c8bd91', 0.18],
    yard: ['#a98e5e', 0.12],
    courtyard: ['#b79d6b', 0.14],
    industrial_pad: ['#756f5b', 0.2],
    parade: ['#8e815f', 0.15],
  };
  const [color, alpha] = colors[type] || ['#9c875b', 0.1];
  ctx.fillStyle = withAlpha(color, alpha);
  tracePolygon(ctx, polygon);
  ctx.fill();
  ctx.strokeStyle = withAlpha(color, Math.min(0.42, alpha + 0.12));
  ctx.lineWidth = 1;
  ctx.stroke();
  if (type === 'field') {
    const minX = Math.min(...polygon.map((point) => point.x));
    const maxX = Math.max(...polygon.map((point) => point.x));
    const minY = Math.min(...polygon.map((point) => point.y));
    const maxY = Math.max(...polygon.map((point) => point.y));
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const span = Math.hypot(maxX - minX, maxY - minY);
    ctx.save();
    tracePolygon(ctx, polygon);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(shape.angle || 0);
    ctx.strokeStyle = withAlpha('#645f36', 0.16);
    ctx.lineWidth = 1;
    for (let y = -span; y <= span; y += 16) {
      ctx.beginPath();
      ctx.moveTo(-span, y);
      ctx.lineTo(span, y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** Draw generated land use and enclosure geometry below roads/buildings. */
function drawWorldGround(ctx, cam) {
  if (!_world) return;
  for (const shape of _world.landUse || []) drawLandUseShape(ctx, shape);

  for (const feature of _world.features || []) {
    const type = feature.kind || feature.type;
    const points = feature.points || feature.polygon || feature.footprint;
    if (!points?.length) continue;
    if (type === 'wall' || type === 'fence' || type === 'berm' || type === 'revetment' || type === 'barrier') {
      ctx.strokeStyle =
        type === 'fence'
          ? withAlpha('#524c3a', 0.62)
          : type === 'berm'
            ? withAlpha('#756342', 0.75)
            : withAlpha('#66583f', 0.82);
      ctx.lineWidth = type === 'berm' ? 6 : type === 'wall' ? 4 : type === 'barrier' ? 3 : 2;
      ctx.setLineDash(type === 'fence' ? [5, 4] : []);
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      if (feature.closed || feature.polygon) ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (type === 'well' || type === 'tank' || type === 'oil_tank') {
      ctx.fillStyle = withAlpha(type === 'well' ? '#5b716a' : '#77776a', 0.55);
      ctx.beginPath();
      ctx.arc(feature.x, feature.y, feature.radius || 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = withAlpha('#332f27', 0.7);
      ctx.stroke();
    }
  }

  if (_world.debugWorldgen) {
    for (const parcel of _world.parcels || []) {
      ctx.strokeStyle = withAlpha('#44ddff', 0.3);
      ctx.lineWidth = 1;
      tracePolygon(ctx, parcel.polygon);
      ctx.stroke();
    }
    for (const place of _world.places || []) {
      for (const access of place.accessPoints || []) {
        ctx.fillStyle = withAlpha('#44ddff', 0.8);
        ctx.beginPath();
        ctx.arc(access.x, access.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.setLineDash([8, 7]);
    for (const encounter of _world.encounters || []) {
      ctx.strokeStyle = withAlpha('#ff44aa', 0.35);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(encounter.x, encounter.y, encounter.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
}

/** Labels and tactical contacts; the place itself is already visible geometry. */
function drawPlaces(ctx, cam) {
  if (!_world) return;
  for (const place of _world.places || []) {
    if (!cam.isVisible(place.x, place.y, 520)) continue;
    const distance = _heli ? Math.hypot(place.x - _heli.x, place.y - _heli.y) : Infinity;
    if (!place.discovered && distance > 900) continue;
    const top = place.bounds?.minY ?? place.bounds?.y0 ?? place.y - 80;
    const categoryColor =
      place.category === 'military'
        ? withAlpha(P.ui.enemy, place.discovered ? 0.92 : 0.55)
        : withAlpha(P.ui.place, place.discovered ? 0.92 : 0.58);
    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = categoryColor;
    ctx.fillText(place.name, place.x, top - 16);
    ctx.fillStyle = P.ui.textDim;
    ctx.font = '8px "Courier New", monospace';
    ctx.fillText(String(place.kind || place.category).replaceAll('_', ' ').toUpperCase(), place.x, top - 5);
  }

  for (const encounter of _world.encounters || []) {
    if (!encounter.discovered || !cam.isVisible(encounter.x, encounter.y, 80)) continue;
    const alive = _enemies.filter(
      (enemy) =>
        enemy.encounterId === encounter.id &&
        enemy.className !== 'unarmed' &&
        enemy.state !== 'dead'
    ).length;
    const color = encounter.cleared ? '#44ff44' : P.ui.enemy;
    const pulse = encounter.cleared ? 10 : 11 + Math.sin(performance.now() / 240) * 2;
    ctx.strokeStyle = withAlpha(color, 0.72);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(encounter.x, encounter.y, pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = 'bold 8px "Courier New", monospace';
    ctx.textAlign = 'center';
    if (encounter.cleared) {
      ctx.fillText('SECURED', encounter.x, encounter.y + 24);
    } else {
      ctx.fillText(`${alive} CONTACT${alive === 1 ? '' : 'S'}`, encounter.x, encounter.y + 24);
    }
  }
}

function drawDecorations(ctx, cam) {
  if (!_world) return;
  for (const d of _world.decorations || []) {
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
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
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
    const dL = _heli.x + lim,
      dR = lim - _heli.x;
    const dT = _heli.y + lim,
      dB = lim - _heli.y;
    const m = Math.min(dL, dR, dT, dB);
    const pulse = 0.55 + 0.35 * Math.sin(performance.now() / 220);
    ctx.strokeStyle = withAlpha('#44ddff', pulse);
    ctx.lineWidth = 6;
    ctx.beginPath();
    if (m === dL) {
      ctx.moveTo(-lim, -lim);
      ctx.lineTo(-lim, lim);
    } else if (m === dR) {
      ctx.moveTo(lim, -lim);
      ctx.lineTo(lim, lim);
    } else if (m === dT) {
      ctx.moveTo(-lim, -lim);
      ctx.lineTo(lim, -lim);
    } else {
      ctx.moveTo(-lim, lim);
      ctx.lineTo(lim, lim);
    }
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
    ctx.moveTo(crate.x - 6, crate.y);
    ctx.lineTo(crate.x + 6, crate.y);
    ctx.moveTo(crate.x, crate.y - 6);
    ctx.lineTo(crate.x, crate.y + 6);
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
      ctx.fillRect(
        target.x - barW / 2,
        target.y - 22,
        barW * clamp(target.hp / target.maxHp, 0, 1),
        4
      );
    }
    ctx.fillStyle = '#ff8844';
    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(
      _world.objective.type === 'intercept' ? 'CONVOY TARGET' : 'PRIMARY TARGET',
      target.x,
      target.y - 28
    );
  }
}

export { drawBuilding, drawPlaces, drawWorldGround, drawDecorations, drawScenarioOverlays };
