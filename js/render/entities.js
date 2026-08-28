/**
 * render/entities.js — helicopter, enemy, boss drawing.
 * Extracted from app.js for testability and to thin the bootstrap.
 */
import { P, mats } from '../palette.js';
import { withAlpha } from '../drawUtil.js';
import { VIEW25, deckRy } from '../view25.js';
import { box25, frustum25 } from '../prims25.js';

let _boss = null;
export function setBoss(boss) { _boss = boss; }


function drawHeliShadow(ctx, h) {
  ctx.fillStyle = P.gunship.shadow;
  ctx.beginPath();
  ctx.ellipse(h.x + 4, h.y + 6, 22, 8, h.angle, 0, Math.PI * 2);
  ctx.fill();
}

function drawGunship(ctx, h) {
  const cx = h.x;
  const cy = h.y;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(h.angle);
  const bw = 10, bl = 30; // larger gunship

  // Shadow underneath
  ctx.fillStyle = P.gunship.shadow;
  ctx.beginPath();
  ctx.ellipse(2, 4, bl * 0.9, bw * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tail boom
  ctx.fillStyle = P.gunship.bodyDark;
  ctx.fillRect(-bl - 8, -1.5, 12, 3);
  ctx.fillStyle = P.gunship.body;
  ctx.fillRect(-bl - 8, -1.5, 12, 2);
  // Tail fin (vertical stabilizer)
  ctx.fillStyle = P.gunship.bodyDark;
  ctx.beginPath();
  ctx.moveTo(-bl - 6, -1.5);
  ctx.lineTo(-bl - 10, -8);
  ctx.lineTo(-bl - 2, -1.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = P.gunship.outline;
  ctx.lineWidth = 1;
  ctx.stroke();
  // Tail rotor
  const tailAngle = (h.bladeAngle * 2.5) % (Math.PI * 2);
  ctx.strokeStyle = P.gunship.rotor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-bl - 6 + Math.cos(tailAngle) * 4, -5 + Math.sin(tailAngle) * 1.5);
  ctx.lineTo(-bl - 6 - Math.cos(tailAngle) * 4, -5 - Math.sin(tailAngle) * 1.5);
  ctx.stroke();

  // Fuselage — dark underside
  ctx.fillStyle = P.gunship.bodyDark;
  ctx.beginPath();
  ctx.moveTo(-bl, 1.5); ctx.lineTo(-bl * 0.4, -bw - 1.5); ctx.lineTo(bl * 0.5, -bw * 0.8 - 1.5);
  ctx.lineTo(bl, -2.5); ctx.lineTo(bl * 0.5, bw * 0.8 - 1.5); ctx.lineTo(-bl * 0.4, bw - 1.5);
  ctx.closePath(); ctx.fill();

  // Fuselage — main body
  ctx.fillStyle = P.gunship.body;
  ctx.beginPath();
  ctx.moveTo(-bl, 0); ctx.lineTo(-bl * 0.4, -bw); ctx.lineTo(bl * 0.5, -bw * 0.8);
  ctx.lineTo(bl, -1); ctx.lineTo(bl * 0.5, bw * 0.8); ctx.lineTo(-bl * 0.4, bw);
  ctx.closePath(); ctx.fill();

  // Fuselage — highlight panel (top surface)
  ctx.fillStyle = P.gunship.bodyHi;
  ctx.beginPath();
  ctx.moveTo(-bl * 0.2, -bw * 0.5); ctx.lineTo(bl * 0.3, -bw * 0.5);
  ctx.lineTo(bl * 0.4, -bw * 0.2); ctx.lineTo(-bl * 0.2, -bw * 0.2);
  ctx.closePath(); ctx.fill();

  // Cockpit canopy (glass)
  ctx.fillStyle = P.gunship.cockpit;
  ctx.beginPath(); ctx.ellipse(bl * 0.15, 0, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = P.gunship.cockpitHi;
  ctx.beginPath(); ctx.ellipse(bl * 0.1, -1.5, 3.5, 2.5, -0.2, 0, Math.PI * 2); ctx.fill();
  // Canopy frame
  ctx.strokeStyle = withAlpha(P.gunship.outline, 0.4);
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.ellipse(bl * 0.15, 0, 7, 5, 0, 0, Math.PI * 2); ctx.stroke();

  // Engine intakes (side-mounted)
  ctx.fillStyle = P.gunship.steelDark;
  ctx.fillRect(-bl * 0.1, -bw - 2, 8, 3);
  ctx.fillRect(-bl * 0.1, bw - 1, 8, 3);
  ctx.fillStyle = P.gunship.steel;
  ctx.fillRect(-bl * 0.1, -bw - 2, 8, 1.5);
  ctx.fillRect(-bl * 0.1, bw - 0.5, 8, 1.5);

  // Weapon pylons + pods
  ctx.fillStyle = P.gunship.weaponPod;
  ctx.fillRect(-2, -bw - 4, 12, 4); // left pod
  ctx.fillRect(-2, bw, 12, 4);       // right pod
  ctx.fillStyle = P.gunship.weaponHi;
  ctx.fillRect(0, -bw - 4, 10, 1.5);
  ctx.fillRect(0, bw, 10, 1.5);
  // Gun barrels (M230 chain gun under nose)
  ctx.fillStyle = P.gunship.steelDark;
  ctx.fillRect(bl * 0.3, -1, 8, 2);

  // Fuselage outline — thin, clean
  ctx.strokeStyle = P.gunship.outline;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-bl, 0); ctx.lineTo(-bl * 0.4, -bw); ctx.lineTo(bl * 0.5, -bw * 0.8);
  ctx.lineTo(bl, -1); ctx.lineTo(bl * 0.5, bw * 0.8); ctx.lineTo(-bl * 0.4, bw);
  ctx.closePath(); ctx.stroke();

  // Skid struts
  ctx.strokeStyle = P.gunship.skid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-bl * 0.2, -bw - 2); ctx.lineTo(-bl * 0.2, -bw - 5);
  ctx.moveTo(bl * 0.2, -bw - 2); ctx.lineTo(bl * 0.2, -bw - 5);
  ctx.moveTo(-bl * 0.2, bw + 2); ctx.lineTo(-bl * 0.2, bw + 5);
  ctx.moveTo(bl * 0.2, bw + 2); ctx.lineTo(bl * 0.2, bw + 5);
  ctx.stroke();
  // Skid bars
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-bl * 0.3, -bw - 5); ctx.lineTo(bl * 0.3, -bw - 5);
  ctx.moveTo(-bl * 0.3, bw + 5); ctx.lineTo(bl * 0.3, bw + 5);
  ctx.stroke();

  ctx.restore();

  // Main rotor disc (blur effect)
  const rotAngle = h.bladeAngle % (Math.PI * 2);
  const bladeLen = 34;
  ctx.fillStyle = withAlpha('#888888', 0.06);
  ctx.beginPath();
  ctx.ellipse(cx, cy, bladeLen, bladeLen * VIEW25.deckRatio, 0, 0, Math.PI * 2);
  ctx.fill();
  // Rotor blades
  ctx.strokeStyle = P.gunship.rotor;
  ctx.lineWidth = 2;
  for (let i = 0; i < 2; i++) {
    const a = rotAngle + (i * Math.PI);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * bladeLen, cy + Math.sin(a) * bladeLen * VIEW25.deckRatio);
    ctx.lineTo(cx - Math.cos(a) * bladeLen, cy - Math.sin(a) * bladeLen * VIEW25.deckRatio);
    ctx.stroke();
  }
  // Rotor hub
  ctx.fillStyle = P.gunship.steel;
  ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
}

function drawEnemy(ctx, e) {
  const cx = e.x, cy = e.y;
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
        const tx = -s + i * (s * 2 / 5);
        ctx.beginPath();
        ctx.moveTo(tx, -s * 0.85); ctx.lineTo(tx, -s * 0.6);
        ctx.moveTo(tx, s * 0.6); ctx.lineTo(tx, s * 0.85);
        ctx.stroke();
      }
      // Hull body
      ctx.fillStyle = bodyColor;
      ctx.fillRect(-s * 0.8, -s * 0.6, s * 1.8, s * 1.2);
      // Sloped front armor
      ctx.fillStyle = isFlashing ? '#ffffff' : (P.enemy.vehicleHi || '#8a7050');
      ctx.beginPath();
      ctx.moveTo(s * 0.8, -s * 0.5);
      ctx.lineTo(s * 1.1, 0);
      ctx.lineTo(s * 0.8, s * 0.5);
      ctx.closePath();
      ctx.fill();
      // Turret (offset forward, rounded)
      ctx.fillStyle = isFlashing ? '#ffffff' : (P.enemy.vehicleDark || '#5a4020');
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
      ctx.fillStyle = isFlashing ? '#ffffff' : (P.enemy.vehicleHi || '#8a7050');
      ctx.beginPath();
      ctx.moveTo(s * 0.7, -s * 0.4);
      ctx.lineTo(s * 0.95, 0);
      ctx.lineTo(s * 0.7, s * 0.4);
      ctx.closePath();
      ctx.fill();
      // Small turret
      ctx.fillStyle = isFlashing ? '#ffffff' : (P.enemy.vehicleDark || '#5a4020');
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
      ctx.fillStyle = isFlashing ? '#ffffff' : (P.enemy.vehicleDark || '#5a4020');
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
      ctx.fillStyle = isFlashing ? '#ffffff' : (P.enemy.vehicleDark || '#5a4020');
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
  const cx = _boss.x, cy = _boss.y;
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
  ctx.fillText('HIND PURSUIT GUNSHIP', cx, barY - 4);
}

function drawHunter(ctx) { drawBoss(ctx); }

export { drawHeliShadow, drawGunship, drawEnemy, drawBoss, drawHunter };
