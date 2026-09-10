/**
 * render/entities.js — helicopter, enemy, boss drawing.
 * Extracted from app.js for testability and to thin the bootstrap.
 */
import { P } from '../palette.js';
import { withAlpha } from '../drawUtil.js';
import { drawHeliShadow, drawGunship } from './gunships.js';

let _boss = null;
export function setBoss(boss) {
  _boss = boss;
}

function drawEnemy(ctx, e) {
  const cx = e.x,
    cy = e.y;
  const isFlashing = e.flashTimer > 0;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(e.angle);

  const s = e.size;
  const bodyColor = isFlashing ? '#ffffff' : e.color;

  if (e.category === 'vehicle') {
    // ── ARMORED VEHICLES — historically based ──
    if (e.className === 'tank') {
      // T-55/T-72 style: low profile, wide tracks, rounded turret
      // Tracks
      ctx.fillStyle = isFlashing ? '#ffffff' : '#3a3a2a';
      ctx.fillRect(-s, -s * 0.85, s * 2, s * 0.25);
      ctx.fillRect(-s, s * 0.6, s * 2, s * 0.25);
      // Track detail
      ctx.strokeStyle = isFlashing ? '#ffffff' : '#2a2a1a';
      ctx.lineWidth = 0.8;
      for (let i = 0; i < 5; i++) {
        const tx = -s + i * ((s * 2) / 5);
        ctx.beginPath();
        ctx.moveTo(tx, -s * 0.85);
        ctx.lineTo(tx, -s * 0.6);
        ctx.moveTo(tx, s * 0.6);
        ctx.lineTo(tx, s * 0.85);
        ctx.stroke();
      }
      // Hull body
      ctx.fillStyle = bodyColor;
      ctx.fillRect(-s * 0.8, -s * 0.6, s * 1.8, s * 1.2);
      // Sloped front armor
      ctx.fillStyle = isFlashing ? '#ffffff' : P.enemy.vehicleHi || '#8a7050';
      ctx.beginPath();
      ctx.moveTo(s * 0.8, -s * 0.5);
      ctx.lineTo(s * 1.1, 0);
      ctx.lineTo(s * 0.8, s * 0.5);
      ctx.closePath();
      ctx.fill();
      // Turret (offset forward, rounded)
      ctx.fillStyle = isFlashing ? '#ffffff' : P.enemy.vehicleDark || '#5a4020';
      ctx.beginPath();
      ctx.arc(s * 0.1, 0, s * 0.4, 0, Math.PI * 2);
      ctx.fill();
      // Gun barrel
      ctx.fillStyle = isFlashing ? '#ffffff' : '#4a4a3a';
      ctx.fillRect(s * 0.4, -s * 0.06, s * 0.9, s * 0.12);
      ctx.strokeStyle = P.enemy.outline;
      ctx.lineWidth = 1;
      ctx.strokeRect(s * 0.4, -s * 0.06, s * 0.9, s * 0.12);
      // muzzle brake
      ctx.fillRect(s * 1.2, -s * 0.09, s * 0.12, s * 0.18);
      // ERA blocks on hull front (reactive armor)
      ctx.fillStyle = isFlashing ? '#ffffff' : '#6a6a4a';
      for (let i = -2; i <= 2; i++) {
        ctx.fillRect(s * 0.6, i * s * 0.18 - s * 0.06, s * 0.15, s * 0.12);
      }
    } else if (e.className === 'apc') {
      // BMP/BRDM style: wheeled or tracked APC
      // Tracks/wheels
      ctx.fillStyle = isFlashing ? '#ffffff' : '#3a3a2a';
      ctx.fillRect(-s * 0.9, -s * 0.7, s * 1.8, s * 0.2);
      ctx.fillRect(-s * 0.9, s * 0.5, s * 1.8, s * 0.2);
      // Hull
      ctx.fillStyle = bodyColor;
      ctx.fillRect(-s * 0.7, -s * 0.5, s * 1.6, s * 1.0);
      // Angled front
      ctx.fillStyle = isFlashing ? '#ffffff' : P.enemy.vehicleHi || '#8a7050';
      ctx.beginPath();
      ctx.moveTo(s * 0.7, -s * 0.4);
      ctx.lineTo(s * 0.95, 0);
      ctx.lineTo(s * 0.7, s * 0.4);
      ctx.closePath();
      ctx.fill();
      // Small turret
      ctx.fillStyle = isFlashing ? '#ffffff' : P.enemy.vehicleDark || '#5a4020';
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.25, 0, Math.PI * 2);
      ctx.fill();
      // MG barrel
      ctx.fillStyle = isFlashing ? '#ffffff' : '#4a4a3a';
      ctx.fillRect(s * 0.2, -s * 0.04, s * 0.6, s * 0.08);
    } else if (e.className === 'shilka') {
      // ZSU-23-4 Shilka: 4-barrel AA
      // Tracks
      ctx.fillStyle = isFlashing ? '#ffffff' : '#3a3a2a';
      ctx.fillRect(-s, -s * 0.8, s * 2, s * 0.2);
      ctx.fillRect(-s, s * 0.6, s * 2, s * 0.2);
      // Hull
      ctx.fillStyle = bodyColor;
      ctx.fillRect(-s * 0.8, -s * 0.6, s * 1.8, s * 1.2);
      // Turret (large, boxy)
      ctx.fillStyle = isFlashing ? '#ffffff' : P.enemy.vehicleDark || '#5a4020';
      ctx.fillRect(-s * 0.3, -s * 0.4, s * 0.8, s * 0.8);
      // 4 gun barrels
      ctx.fillStyle = isFlashing ? '#ffffff' : '#4a4a3a';
      for (let i = -1.5; i <= 1.5; i += 1) {
        ctx.fillRect(s * 0.4, i * s * 0.12 - s * 0.03, s * 0.7, s * 0.06);
      }
      // Radar dish on top
      ctx.fillStyle = isFlashing ? '#ffffff' : '#6a6a5a';
      ctx.beginPath();
      ctx.arc(s * 0.1, -s * 0.5, s * 0.2, 0, Math.PI, true);
      ctx.fill();
    } else if (e.className === 'sam') {
      // SA-6/SA-8 style mobile SAM
      // Tracks
      ctx.fillStyle = isFlashing ? '#ffffff' : '#3a3a2a';
      ctx.fillRect(-s, -s * 0.8, s * 2, s * 0.2);
      ctx.fillRect(-s, s * 0.6, s * 2, s * 0.2);
      // Hull
      ctx.fillStyle = bodyColor;
      ctx.fillRect(-s * 0.8, -s * 0.6, s * 1.8, s * 1.2);
      // Launch rails (3 missiles)
      ctx.fillStyle = isFlashing ? '#ffffff' : P.enemy.vehicleDark || '#5a4020';
      ctx.fillRect(-s * 0.2, -s * 0.35, s * 0.8, s * 0.7);
      // Missiles
      ctx.fillStyle = isFlashing ? '#ffffff' : '#8a8a6a';
      for (let i = -1; i <= 1; i++) {
        ctx.fillRect(s * 0.3, i * s * 0.2 - s * 0.04, s * 0.6, s * 0.08);
        // Warhead
        ctx.fillStyle = isFlashing ? '#ffffff' : '#cc3333';
        ctx.fillRect(s * 0.85, i * s * 0.2 - s * 0.05, s * 0.12, s * 0.1);
        ctx.fillStyle = isFlashing ? '#ffffff' : '#8a8a6a';
      }
    } else {
      // Generic vehicle fallback
      ctx.fillStyle = bodyColor;
      ctx.fillRect(-s, -s * 0.7, s * 2, s * 1.4);
      ctx.fillStyle = isFlashing ? '#ffffff' : P.enemy.vehicleDark;
      ctx.fillRect(s * 0.5, -s * 0.3, s * 0.8, s * 0.6);
    }
    // Outline on all vehicles
    ctx.strokeStyle = P.enemy.outline;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(-s * 0.8, -s * 0.6, s * 1.8, s * 1.2);
  } else if (e.category === 'emplacement') {
    // ── FIXED EMPLACEMENTS ──
    // Sandbag base
    ctx.fillStyle = isFlashing ? '#ffffff' : '#b0a070';
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = P.enemy.outline;
    ctx.lineWidth = 1;
    ctx.stroke();
    // Gun
    ctx.fillStyle = isFlashing ? '#ffffff' : '#4a4a3a';
    ctx.fillRect(s * 0.2, -s * 0.08, s * 0.8, s * 0.16);
    // Mount
    ctx.fillStyle = isFlashing ? '#ffffff' : '#5a5a4a';
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // ── INFANTRY — simple diamond ──
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(0, -s * 0.6);
    ctx.lineTo(-s * 0.5, 0);
    ctx.lineTo(0, s * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = P.enemy.outline;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.restore();

  // HP bar (only if damaged)
  if (e.hp < e.maxHp && e.state !== 'dead') {
    const barW = s * 3;
    const barH = 3;
    const barX = cx - barW / 2;
    const barY = cy - s - 8;
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = P.ui.hpLow;
    ctx.fillRect(barX, barY, barW * (e.hp / e.maxHp), barH);
  }
}

function drawBoss(ctx) {
  if (!_boss.spawned || _boss.state === 'dead') return;
  if (isGroundBoss(_boss)) {
    drawGroundBoss(ctx);
    return;
  }
  const cx = _boss.x,
    cy = _boss.y;
  const s = _boss.size;
  const isFlashing = _boss.flashTimer > 0;
  const body = isFlashing ? '#ffffff' : '#6a6a5a';
  const dark = isFlashing ? '#ffffff' : '#4a4a3a';
  const accent = isFlashing ? '#ffffff' : '#8a5a3a';

  // Shadow
  ctx.fillStyle = withAlpha('#000000', 0.35);
  ctx.beginPath();
  ctx.ellipse(cx + 4, cy + 8, s * 1.1, s * 0.4, _boss.angle, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(_boss.angle);

  // Main rotor arc (subtle, spinning)
  const rotorPhase = (performance.now() / 80) % (Math.PI * 2);
  ctx.strokeStyle = withAlpha(dark, 0.5);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 1.8, s * 0.12, rotorPhase, 0, Math.PI * 2);
  ctx.stroke();

  // Tail boom
  ctx.fillStyle = dark;
  ctx.fillRect(-s * 1.6, -s * 0.08, s * 0.8, s * 0.16);

  // Tail fin
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(-s * 1.6, -s * 0.25);
  ctx.lineTo(-s * 1.9, 0);
  ctx.lineTo(-s * 1.6, s * 0.25);
  ctx.closePath();
  ctx.fill();

  // Fuselage (elongated oval)
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 1.0, s * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = P.enemy.outline;
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // Cockpit canopy (forward bubble)
  ctx.fillStyle = isFlashing ? '#ffffff' : '#3a5a4a';
  ctx.beginPath();
  ctx.ellipse(s * 0.65, -s * 0.05, s * 0.3, s * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = P.enemy.outline;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Stub wings (small, angled back)
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(s * 0.1, -s * 0.38);
  ctx.lineTo(s * 0.5, -s * 0.65);
  ctx.lineTo(s * 0.6, -s * 0.55);
  ctx.lineTo(s * 0.3, -s * 0.32);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(s * 0.1, s * 0.38);
  ctx.lineTo(s * 0.5, s * 0.65);
  ctx.lineTo(s * 0.6, s * 0.55);
  ctx.lineTo(s * 0.3, s * 0.32);
  ctx.closePath();
  ctx.fill();

  // Hardpoints / rocket pods under wings
  ctx.fillStyle = accent;
  ctx.fillRect(s * 0.3, -s * 0.58, s * 0.25, s * 0.1);
  ctx.fillRect(s * 0.3, s * 0.48, s * 0.25, s * 0.1);

  // Fuselage outline
  ctx.strokeStyle = P.enemy.outline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 1.0, s * 0.4, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();

  // Nose gun turret (tracks independently)
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(_boss.turretAngle);
  ctx.fillStyle = dark;
  ctx.fillRect(s * 0.3, -s * 0.06, s * 0.6, s * 0.12);
  ctx.strokeStyle = P.enemy.outline;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(s * 0.3, -s * 0.06, s * 0.6, s * 0.12);
  ctx.restore();

  // HP bar above
  const barW = s * 3;
  const barH = 5;
  const barX = cx - barW / 2;
  const barY = cy - s - 16;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(barX, barY, barW, barH);
  const hpPct = _boss.hp / _boss.maxHp;
  ctx.fillStyle = hpPct > 0.5 ? '#cc4444' : hpPct > 0.25 ? '#ff6644' : '#ff2222';
  ctx.fillRect(barX, barY, barW * hpPct, barH);
  ctx.strokeStyle = '#880000';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, barY, barW, barH);
  ctx.fillStyle = '#ff4444';
  ctx.font = 'bold 9px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(_boss.name || 'HIND PURSUIT GUNSHIP', cx, barY - 4);
}

function isGroundBoss(boss) {
  return /tank|fortified|sam|aa|column|brigade|complex|ad|combined/.test(boss.type || '');
}

function drawGroundBoss(ctx) {
  const cx = _boss.x;
  const cy = _boss.y;
  const s = Math.max(18, _boss.size * 0.9);
  const isFlashing = _boss.flashTimer > 0;
  const isAirDefense = /sam|aa|air_defense|ad_complex|heavy_ad/.test(_boss.type || '');
  const body = isFlashing ? '#ffffff' : isAirDefense ? '#4f665c' : '#665744';
  const dark = isFlashing ? '#ffffff' : '#39352d';
  const accent = isFlashing ? '#ffffff' : isAirDefense ? '#6f8f7b' : '#9b6a3d';

  ctx.fillStyle = withAlpha('#000000', 0.4);
  ctx.beginPath();
  ctx.ellipse(cx + 5, cy + 8, s * 1.2, s * 0.42, _boss.angle, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(_boss.angle);
  ctx.fillStyle = dark;
  ctx.fillRect(-s * 1.1, -s * 0.72, s * 2.2, s * 0.22);
  ctx.fillRect(-s * 1.1, s * 0.5, s * 2.2, s * 0.22);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-s * 0.9, -s * 0.55);
  ctx.lineTo(s * 0.7, -s * 0.55);
  ctx.lineTo(s, 0);
  ctx.lineTo(s * 0.7, s * 0.55);
  ctx.lineTo(-s * 0.9, s * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = P.enemy.outline;
  ctx.lineWidth = 1.8;
  ctx.stroke();

  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(-s * 0.1, 0, s * 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  if (isAirDefense) {
    ctx.fillStyle = accent;
    ctx.fillRect(-s * 0.2, -s * 0.46, s * 0.85, s * 0.12);
    ctx.fillRect(-s * 0.2, s * 0.34, s * 0.85, s * 0.12);
    ctx.strokeStyle = dark;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(-s * 0.1, -s * 0.62, s * 0.24, Math.PI, 0);
    ctx.stroke();
  } else {
    ctx.fillStyle = accent;
    ctx.fillRect(s * 0.05, -s * 0.07, s * 0.95, s * 0.14);
    ctx.fillRect(s * 0.82, -s * 0.14, s * 0.16, s * 0.28);
  }
  ctx.restore();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(_boss.turretAngle);
  ctx.fillStyle = dark;
  ctx.fillRect(s * 0.15, -s * 0.07, s * 0.95, s * 0.14);
  ctx.strokeStyle = P.enemy.outline;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(s * 0.15, -s * 0.07, s * 0.95, s * 0.14);
  ctx.restore();

  const barW = s * 3;
  const barH = 5;
  const barX = cx - barW / 2;
  const barY = cy - s - 16;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(barX, barY, barW, barH);
  const hpPct = _boss.hp / _boss.maxHp;
  ctx.fillStyle = hpPct > 0.5 ? '#cc4444' : hpPct > 0.25 ? '#ff6644' : '#ff2222';
  ctx.fillRect(barX, barY, barW * hpPct, barH);
  ctx.strokeStyle = '#880000';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, barY, barW, barH);
  ctx.fillStyle = '#ff6666';
  ctx.font = 'bold 9px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(_boss.name || 'ARMORED COMMANDER', cx, barY - 4);
}

function drawHunter(ctx) {
  drawBoss(ctx);
}

export { drawHeliShadow, drawGunship, drawEnemy, drawBoss, drawHunter };
