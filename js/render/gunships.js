/**
 * Top-down airframes from US Army / Wikimedia 3-views.
 * Local +X is the nose. Rotor hub sits on the gameplay origin.
 */
import { P } from '../palette.js';
import { withAlpha, shade } from '../drawUtil.js';
import { VIEW25 } from '../view25.js';
import { currentSun, setSun } from '../sun.js';

function paintFrom(body, extras = {}) {
  return {
    body,
    bodyHi: shade(body, 0.14),
    bodyDark: shade(body, -0.14),
    steel: P.gunship.steel,
    steelDark: P.gunship.steelDark,
    cockpit: extras.cockpit || P.gunship.cockpit,
    cockpitHi: extras.cockpitHi || P.gunship.cockpitHi,
    rotor: P.gunship.rotor,
    rotorTip: extras.rotorTip || P.gunship.rotorTip,
    weapon: P.gunship.weaponPod,
    weaponHi: P.gunship.weaponHi,
    skid: P.gunship.skid,
    outline: P.gunship.outline,
    stripe: extras.stripe || null,
    ...extras,
  };
}

const PAINT = {
  cobra: paintFrom('#5c7c38', { stripe: '#d4b43a' }),
  supercobra: paintFrom('#3f5c4a', { stripe: null, rotorTip: '#c8b24a' }),
  apache: paintFrom('#4a5334', { cockpit: '#6aa8b8', rotorTip: '#d8c24a' }),
  longbow: paintFrom('#3d4a30', { cockpit: '#5a9aaa', rotorTip: '#d8c24a' }),
  comanche: paintFrom('#3a4c42', {
    cockpit: '#7ec8c0',
    cockpitHi: '#b8ece4',
    rotorTip: '#8a8a50',
  }),
  dap: paintFrom('#454838', { cockpit: '#6a9aaa', rotorTip: '#d8c24a' }),
};

function turretLocal(h) {
  const t = h.manualTarget || h.target;
  if (!t || !Number.isFinite(t.x) || !Number.isFinite(t.y)) return 0;
  let local = Math.atan2(t.y - h.y, t.x - h.x) - h.angle;
  while (local > Math.PI) local -= Math.PI * 2;
  while (local < -Math.PI) local += Math.PI * 2;
  return Math.max(-1.85, Math.min(1.85, local));
}

/** Draw in a 2× art space, then shrink so fine strokes survive at game size. */
const ART = 2;
const FIT = 0.58;

function airScale(h) {
  return (h.drawScale || 1) * (h.airframeScale || 1);
}

function hullScale(h) {
  return airScale(h) * FIT * ART;
}

const BANK_THIN = 0.18;
const BANK_SHEAR = 0.15;
const BANK_ROLL = 0.22;

let _pose = { angle: 0, bank: 0 };

function applyBankDeform(ctx, bank) {
  if (!bank) return;
  const thin = 1 - Math.abs(bank) * BANK_THIN;
  ctx.rotate(bank * BANK_ROLL);
  ctx.transform(1, 0, bank * BANK_SHEAR, thin, 0, 0);
}

function beginHull(ctx, h) {
  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.rotate(h.angle || 0);
  applyBankDeform(ctx, h.bank || 0);
  ctx.scale(airScale(h) * FIT, airScale(h) * FIT);
  ctx.scale(ART, ART);
  _pose.angle = h.angle || 0;
  _pose.bank = h.bank || 0;
}

function worldSunLocal() {
  const sun = currentSun();
  const a = _pose.angle || 0;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const lx = sun.dirX * c + sun.dirY * s;
  const ly = -sun.dirX * s + sun.dirY * c;
  const mag = Math.hypot(lx, ly) || 1;
  return { ux: lx / mag, uy: ly / mag, sun };
}

function metalSunOverlay(ctx, fill, x0, y0, x1, y1, kind = 'path') {
  if (_halo || !isHex(fill) || luma(fill) <= 28) return;
  const { ux, uy, sun } = worldSunLocal();
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const reach = Math.hypot(x1 - x0, y1 - y0) * 0.55;
  const amt = 0.1 * (0.35 + 0.65 * sun.strength);
  const g = ctx.createLinearGradient(
    cx - ux * reach,
    cy - uy * reach,
    cx + ux * reach,
    cy + uy * reach
  );
  g.addColorStop(0, shade(fill, -amt));
  g.addColorStop(0.42, fill);
  g.addColorStop(1, shade(fill, amt * 1.15));
  ctx.save();
  ctx.globalAlpha = 0.38 + 0.22 * sun.strength;
  ctx.fillStyle = g;
  if (kind === 'rect') ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  else ctx.fill();
  ctx.restore();
}

const HALO = '#000000';
/** Screen-pixel outline so hangar scale and in-world scale stay the same weight. */
const HALO_PX = 2.9;
const INNER = 0.5;
let _halo = false;

function detail() {
  return !_halo;
}

function paintHaloThen(paint) {
  _halo = true;
  paint();
  _halo = false;
  paint();
}

function haloStroke(ctx) {
  let scale = 1;
  if (typeof ctx.getTransform === 'function') {
    const m = ctx.getTransform();
    const sx = Math.hypot(m.a, m.b) || 1;
    const sy = Math.hypot(m.c, m.d) || 1;
    // Min axis so bank-shear never fattens the rim, and hangar vs world stay equal.
    scale = Math.min(sx, sy);
  }
  ctx.fillStyle = HALO;
  ctx.strokeStyle = HALO;
  ctx.lineWidth = HALO_PX / scale;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
}

function isHex(c) {
  return typeof c === 'string' && c[0] === '#' && c.length >= 7;
}

function luma(hex) {
  const n = parseInt(hex.slice(1, 7), 16);
  return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11;
}

/**
 * Ridge light: high along the middle of a part (spine, wing top, tube crown),
 * shade on both shoulders. Not a one-sided sun.
 */
function sunGradBox(ctx, mid, x0, y0, x1, y1) {
  const w = Math.max(0.6, x1 - x0);
  const h = Math.max(0.6, y1 - y0);
  const g =
    w >= h
      ? ctx.createLinearGradient((x0 + x1) / 2, y0, (x0 + x1) / 2, y1)
      : ctx.createLinearGradient(x0, (y0 + y1) / 2, x1, (y0 + y1) / 2);
  g.addColorStop(0, shade(mid, -0.1));
  g.addColorStop(0.5, shade(mid, 0.14));
  g.addColorStop(1, shade(mid, -0.1));
  return g;
}

function paintFill(ctx, fill, x0, y0, x1, y1) {
  if (isHex(fill) && luma(fill) > 28) ctx.fillStyle = sunGradBox(ctx, fill, x0, y0, x1, y1);
  else ctx.fillStyle = fill;
}

function bboxOf(pts) {
  let minX = pts[0][0];
  let minY = pts[0][1];
  let maxX = minX;
  let maxY = minY;
  for (let i = 1; i < pts.length; i++) {
    minX = Math.min(minX, pts[i][0]);
    minY = Math.min(minY, pts[i][1]);
    maxX = Math.max(maxX, pts[i][0]);
    maxY = Math.max(maxY, pts[i][1]);
  }
  return [minX, minY, maxX, maxY];
}

function beginPoly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function fillPoly(ctx, pts, fill, stroke, lw = 1) {
  beginPoly(ctx, pts);
  if (_halo) {
    haloStroke(ctx);
    ctx.fill();
    ctx.stroke();
    return;
  }
  if (fill) {
    const [minX, minY, maxX, maxY] = bboxOf(pts);
    paintFill(ctx, fill, minX, minY, maxX, maxY);
    ctx.fill();
    metalSunOverlay(ctx, fill, minX, minY, maxX, maxY);
  }
  void stroke;
  void lw;
}

/** Fuselage as a tube: wrap across Y so the sheen isn't hidden under the glass. */
function fillHull(ctx, pts, fill) {
  beginPoly(ctx, pts);
  if (_halo) {
    haloStroke(ctx);
    ctx.fill();
    ctx.stroke();
    return;
  }
  if (!isHex(fill) || luma(fill) <= 28) {
    ctx.fillStyle = fill;
    ctx.fill();
    return;
  }
  const [minX, minY, maxX, maxY] = bboxOf(pts);
  const cx = (minX + maxX) / 2;
  const g = ctx.createLinearGradient(cx, minY, cx, maxY);
  g.addColorStop(0, shade(fill, -0.14));
  g.addColorStop(0.22, fill);
  g.addColorStop(0.5, shade(fill, 0.16));
  g.addColorStop(0.78, fill);
  g.addColorStop(1, shade(fill, -0.14));
  ctx.fillStyle = g;
  ctx.fill();
  metalSunOverlay(ctx, fill, minX, minY, maxX, maxY);
}

function fillFlat(ctx, pts, fill) {
  beginPoly(ctx, pts);
  if (_halo) {
    haloStroke(ctx);
    ctx.fill();
    ctx.stroke();
    return;
  }
  ctx.fillStyle = fill;
  ctx.fill();
}

function contactShade(ctx, x, y, rx, ry) {
  if (!detail()) return;
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function fillGlass(ctx, pts, mid, hi, stroke, lw = 0.7) {
  beginPoly(ctx, pts);
  if (_halo) {
    haloStroke(ctx);
    ctx.fill();
    ctx.stroke();
    return;
  }
  const [minX, minY, maxX, maxY] = bboxOf(pts);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const r = Math.max(maxX - minX, maxY - minY) * 0.78;
  const g = ctx.createRadialGradient(cx, cy, r * 0.06, cx, cy, r);
  g.addColorStop(0, shade(mid, 0.08));
  g.addColorStop(0.55, mid);
  g.addColorStop(1, shade(mid, -0.12));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.fillStyle = withAlpha(hi || shade(mid, 0.35), 0.4);
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.04, cy - r * 0.18, r * 0.16, r * 0.08, -0.2, 0, Math.PI * 2);
  ctx.fill();
  void stroke;
  void lw;
}

function fillBox(ctx, x, y, w, h, fill) {
  if (_halo) {
    haloStroke(ctx);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    return;
  }
  paintFill(ctx, fill, x, y, x + w, y + h);
  ctx.fillRect(x, y, w, h);
  metalSunOverlay(ctx, fill, x, y, x + w, y + h, 'rect');
}

function fillOval(ctx, x, y, rx, ry, rot, fill) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot || 0, 0, Math.PI * 2);
  if (_halo) {
    haloStroke(ctx);
    ctx.fill();
    ctx.stroke();
    return;
  }
  paintFill(ctx, fill, x - rx, y - ry, x + rx, y + ry);
  ctx.fill();
  metalSunOverlay(ctx, fill, x - rx, y - ry, x + rx, y + ry);
}

function fillDot(ctx, x, y, r, fill) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (_halo) {
    haloStroke(ctx);
    ctx.fill();
    ctx.stroke();
    return;
  }
  if (isHex(fill) && luma(fill) > 40) {
    const g = ctx.createRadialGradient(x - r * 0.32, y - r * 0.38, r * 0.08, x, y, r);
    g.addColorStop(0, shade(fill, 0.18));
    g.addColorStop(0.55, fill);
    g.addColorStop(1, shade(fill, -0.1));
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = fill;
  }
  ctx.fill();
}

function capsule(ctx, x0, y0, x1, y1, r, fill) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  ctx.beginPath();
  ctx.moveTo(x0 + nx * r, y0 + ny * r);
  ctx.lineTo(x1 + nx * r, y1 + ny * r);
  ctx.arc(x1, y1, r, Math.atan2(ny, nx), Math.atan2(ny, nx) + Math.PI);
  ctx.lineTo(x0 - nx * r, y0 - ny * r);
  ctx.arc(x0, y0, r, Math.atan2(-ny, -nx), Math.atan2(ny, nx));
  if (_halo) {
    haloStroke(ctx);
    ctx.fill();
    ctx.stroke();
    return;
  }
  if (isHex(fill)) {
    const g = ctx.createLinearGradient(x0 + nx * r, y0 + ny * r, x0 - nx * r, y0 - ny * r);
    g.addColorStop(0, shade(fill, -0.1));
    g.addColorStop(0.5, shade(fill, 0.16));
    g.addColorStop(1, shade(fill, -0.1));
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = fill;
  }
  ctx.fill();
  if (isHex(fill)) {
    metalSunOverlay(
      ctx,
      fill,
      Math.min(x0, x1) - r,
      Math.min(y0, y1) - r,
      Math.max(x0, x1) + r,
      Math.max(y0, y1) + r
    );
  }
}

function rocketPod(ctx, p, x, y, len = 9, fat = 1.7) {
  capsule(ctx, x - len * 0.45, y, x + len * 0.45, y, fat, p.weapon);
  if (!detail()) return;
  fillBox(ctx, x - len * 0.2, y - fat * 0.45, len * 0.45, fat * 0.4, p.weaponHi);
  fillDot(ctx, x + len * 0.48, y, fat * 0.45, '#141410');
}

function hellfireRack(ctx, p, x, y, scale = 1) {
  const w = 8.8 * scale;
  const h = 6.0 * scale;
  fillBox(ctx, x - w / 2, y - h / 2, w, h, p.steelDark);
  if (!detail()) return;
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      fillBox(
        ctx,
        x - w / 2 + 0.8 * scale + c * 3.8 * scale,
        y - h / 2 + 0.6 * scale + r * 2.6 * scale,
        3.2 * scale,
        1.9 * scale,
        p.weapon
      );
    }
  }
}

/** Under-wing Hellfires — draw before the wing so the plank covers them. */
function comancheMissiles(ctx, p, sign) {
  const s = sign;
  const pairs = [
    [s * 6.05, s * 7.05],
    [s * 9.25, s * 10.25],
  ];
  for (const [y0, y1] of pairs) {
    for (const y of [y0, y1]) {
      // Short tubes fully under the plank; only a whisper of tip past the LE.
      capsule(ctx, -1.65, y, 3.05, y, 0.34, p.weapon);
    }
  }
}

/** Elegant EFAMS plank — wide root, tapering tip, rounded LE. Draw after hull. */
function comancheWing(ctx, p, sign) {
  const s = sign;
  const wing = shade(p.body, -0.02);
  fillPoly(
    ctx,
    [
      [3.2, s * 4.55],
      [1.85, s * 10.85],
      [-1.35, s * 10.55],
      [-0.15, s * 4.75],
    ],
    wing
  );
  fillOval(ctx, 2.9, s * 7.7, 0.9, 3.15, 0, wing);
  if (detail()) {
    fillPoly(
      ctx,
      [
        [2.45, s * 5.2],
        [1.35, s * 10.05],
        [-0.55, s * 9.85],
        [0.35, s * 5.3],
      ],
      p.bodyHi
    );
  }
}

function towTubes(ctx, p, x, y) {
  capsule(ctx, x - 4.8, y - 1.15, x + 4.8, y - 1.15, 0.85, p.steelDark);
  capsule(ctx, x - 4.8, y + 1.15, x + 4.8, y + 1.15, 0.85, p.steelDark);
}

function skids(ctx, p, x0, x1, spread) {
  if (_halo) {
    capsule(ctx, x0, -spread, x1, -spread, 0.85, HALO);
    capsule(ctx, x0, spread, x1, spread, 0.85, HALO);
    return;
  }
  ctx.strokeStyle = p.skid;
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.45 * INNER;
  ctx.beginPath();
  ctx.moveTo(x0, -spread);
  ctx.lineTo(x1, -spread);
  ctx.moveTo(x0, spread);
  ctx.lineTo(x1, spread);
  ctx.stroke();
  ctx.lineWidth = 0.9 * INNER;
  ctx.beginPath();
  ctx.moveTo(x0 + 3, -2.2);
  ctx.lineTo(x0 + 3, -spread);
  ctx.moveTo(x1 - 3, -2.2);
  ctx.lineTo(x1 - 3, -spread);
  ctx.moveTo(x0 + 3, 2.2);
  ctx.lineTo(x0 + 3, spread);
  ctx.moveTo(x1 - 3, 2.2);
  ctx.lineTo(x1 - 3, spread);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function cobraGlass(ctx, p, x0, x1, hw) {
  fillGlass(
    ctx,
    [
      [x1, 0],
      [x1 - 1.6, -hw],
      [x0 + 1.8, -hw],
      [x0, 0],
      [x0 + 1.8, hw],
      [x1 - 1.6, hw],
    ],
    p.cockpit,
    p.cockpitHi,
    withAlpha(p.outline, 0.6),
    0.7
  );
  if (!detail()) return;
  ctx.fillStyle = p.cockpitHi;
  ctx.beginPath();
  ctx.ellipse(x0 + (x1 - x0) * 0.62, -hw * 0.3, (x1 - x0) * 0.16, hw * 0.24, -0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = withAlpha(p.outline, 0.55);
  ctx.lineWidth = 0.7 * INNER;
  for (const t of [0.28, 0.5, 0.72]) {
    const x = x0 + (x1 - x0) * t;
    ctx.beginPath();
    ctx.moveTo(x, -hw);
    ctx.lineTo(x, hw);
    ctx.stroke();
  }
  ctx.strokeStyle = p.steelDark;
  ctx.lineWidth = 0.8 * INNER;
  ctx.beginPath();
  ctx.moveTo(x1 + 0.2, 0);
  ctx.lineTo(x1 + 3.4, 0);
  ctx.stroke();
}

function apacheGlass(ctx, p) {
  if (!detail()) return;
  // Two flat-pane "tubs": gunner forward, pilot aft and wider.
  fillGlass(
    ctx,
    [
      [15.8, 0],
      [14.2, -2.35],
      [8.8, -2.55],
      [7.8, 0],
      [8.8, 2.55],
      [14.2, 2.35],
    ],
    p.cockpit,
    p.cockpitHi,
    withAlpha(p.outline, 0.4),
    0.7
  );
  fillGlass(
    ctx,
    [
      [7.6, 0],
      [6.4, -3.15],
      [1.4, -3.35],
      [0.2, 0],
      [1.4, 3.35],
      [6.4, 3.15],
    ],
    p.cockpit,
    p.cockpitHi,
    withAlpha(p.outline, 0.4),
    0.7
  );
  if (!detail()) return;
  ctx.fillStyle = p.cockpitHi;
  ctx.beginPath();
  ctx.moveTo(13.4, -1.4);
  ctx.lineTo(10.2, -1.5);
  ctx.lineTo(10.4, -0.4);
  ctx.lineTo(13.6, -0.35);
  ctx.fill();
  ctx.strokeStyle = withAlpha(p.outline, 0.4);
  ctx.lineWidth = 0.6 * INNER;
  ctx.beginPath();
  ctx.moveTo(11.6, -2.45);
  ctx.lineTo(11.6, 2.45);
  ctx.moveTo(3.8, -3.25);
  ctx.lineTo(3.8, 3.25);
  ctx.stroke();
}

function fillLitePane(ctx, pts, p) {
  fillPoly(ctx, pts, p.cockpit, withAlpha(p.outline, 0.42), 0.65);
}

function comancheGlass(ctx, p) {
  // Plate canopy: crisp framed panes, front V, long split mains, aft roof.
  const outer = [
    [19.6, 0],
    [18.85, -1.45],
    [17.35, -2.7],
    [14.8, -3.5],
    [11.4, -3.55],
    [7.8, -2.7],
    [5.5, -1.15],
    [5.05, 0],
    [5.5, 1.15],
    [7.8, 2.7],
    [11.4, 3.55],
    [14.8, 3.5],
    [17.35, 2.7],
    [18.85, 1.45],
  ];
  if (_halo) {
    fillPoly(ctx, outer, HALO);
    return;
  }
  fillLitePane(
    ctx,
    [
      [19.35, 0],
      [18.55, -1.25],
      [17.5, -1.4],
      [17.5, 0],
    ],
    p
  );
  fillLitePane(
    ctx,
    [
      [19.35, 0],
      [18.55, 1.25],
      [17.5, 1.4],
      [17.5, 0],
    ],
    p
  );
  fillLitePane(
    ctx,
    [
      [17.4, -0.28],
      [17.25, -1.55],
      [14.85, -2.75],
      [11.5, -2.85],
      [11.5, -0.28],
    ],
    p
  );
  fillLitePane(
    ctx,
    [
      [17.4, 0.28],
      [17.25, 1.55],
      [14.85, 2.75],
      [11.5, 2.85],
      [11.5, 0.28],
    ],
    p
  );
  fillLitePane(
    ctx,
    [
      [17.2, -1.65],
      [16.0, -2.9],
      [14.7, -3.4],
      [14.7, -2.8],
      [17.05, -1.65],
    ],
    p
  );
  fillLitePane(
    ctx,
    [
      [17.2, 1.65],
      [16.0, 2.9],
      [14.7, 3.4],
      [14.7, 2.8],
      [17.05, 1.65],
    ],
    p
  );
  fillLitePane(
    ctx,
    [
      [11.35, -0.28],
      [11.35, -2.7],
      [7.9, -2.5],
      [6.2, -1.0],
      [5.75, -0.28],
    ],
    p
  );
  fillLitePane(
    ctx,
    [
      [11.35, 0.28],
      [11.35, 2.7],
      [7.9, 2.5],
      [6.2, 1.0],
      [5.75, 0.28],
    ],
    p
  );
  ctx.strokeStyle = withAlpha(p.outline, 0.55);
  ctx.lineWidth = 0.9 * INNER;
  ctx.beginPath();
  ctx.moveTo(19.0, 0);
  ctx.lineTo(5.5, 0);
  ctx.moveTo(11.45, -2.8);
  ctx.lineTo(11.45, 2.8);
  ctx.stroke();
}

function dapGlass(ctx, p) {
  // All glass sits behind the round metal nose. 3 front, 1 per side, 2 on top.
  if (_halo) {
    fillPoly(
      ctx,
      [
        [16.9, 0],
        [16.45, -2.3],
        [15.7, -4.15],
        [13.4, -5.45],
        [9.5, -5.3],
        [8.8, -3.55],
        [8.8, 3.55],
        [9.5, 5.3],
        [13.4, 5.45],
        [15.7, 4.15],
        [16.45, 2.3],
      ],
      HALO
    );
    return;
  }
  const ink = withAlpha(p.outline, 0.42);
  fillGlass(
    ctx,
    [
      [16.85, -2.25],
      [13.85, -2.3],
      [13.85, 2.3],
      [16.85, 2.25],
    ],
    p.cockpit,
    p.cockpitHi,
    ink,
    0.6
  );
  fillGlass(
    ctx,
    [
      [16.7, -2.4],
      [15.85, -4.15],
      [13.7, -4.25],
      [13.7, -2.4],
    ],
    p.cockpit,
    p.cockpitHi,
    ink,
    0.55
  );
  fillGlass(
    ctx,
    [
      [16.7, 2.4],
      [15.85, 4.15],
      [13.7, 4.25],
      [13.7, 2.4],
    ],
    p.cockpit,
    p.cockpitHi,
    ink,
    0.55
  );
  fillLitePane(
    ctx,
    [
      [13.65, -0.4],
      [13.65, -2.15],
      [10.8, -2.2],
      [10.8, -0.4],
    ],
    p
  );
  fillLitePane(
    ctx,
    [
      [13.65, 0.4],
      [13.65, 2.15],
      [10.8, 2.2],
      [10.8, 0.4],
    ],
    p
  );
  fillGlass(
    ctx,
    [
      [13.6, -4.35],
      [12.3, -5.45],
      [9.45, -5.3],
      [8.85, -3.6],
      [13.6, -3.8],
    ],
    p.cockpit,
    p.cockpitHi,
    ink,
    0.55
  );
  fillGlass(
    ctx,
    [
      [13.6, 4.35],
      [12.3, 5.45],
      [9.45, 5.3],
      [8.85, 3.6],
      [13.6, 3.8],
    ],
    p.cockpit,
    p.cockpitHi,
    ink,
    0.55
  );
  ctx.strokeStyle = withAlpha(p.outline, 0.5);
  ctx.lineWidth = 0.8 * INNER;
  ctx.beginPath();
  ctx.moveTo(16.7, 0);
  ctx.lineTo(10.8, 0);
  ctx.moveTo(13.8, -4.1);
  ctx.lineTo(13.8, 4.1);
  ctx.stroke();
}

function tailRotor(ctx, p, x, y, h, span = 4.6, blades = 2) {
  if (!detail()) return;
  const a = (h.bladeAngle * 2.6) % (Math.PI * 2);
  const diams = blades === 4 ? 2 : 1;
  ctx.strokeStyle = withAlpha(p.rotor, 0.78);
  ctx.lineWidth = 1.15;
  for (let i = 0; i < diams; i++) {
    const b = a + i * (Math.PI / diams);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(b) * span, y + Math.sin(b) * span * 0.42);
    ctx.lineTo(x - Math.cos(b) * span, y - Math.sin(b) * span * 0.42);
    ctx.stroke();
  }
}

function boom(ctx, p, x0, x1, hw, opts = {}) {
  fillBox(ctx, x1, -hw, x0 - x1, hw * 2, p.bodyDark);
  if (detail()) fillBox(ctx, x1, -hw * 0.75, x0 - x1, hw * 1.35, p.body);
  if (detail() && p.stripe) {
    fillBox(ctx, x1 + (x0 - x1) * 0.45, -hw, 2.2, hw * 2, p.stripe);
  }
  const stabW = opts.stabW || 4.6;
  const stabH = opts.stabH || 10.4;
  fillBox(ctx, x1 + (opts.stabX || 3.2), -stabH / 2, stabW, stabH, p.bodyHi);
  if (!opts.noFin) {
    fillPoly(
      ctx,
      [
        [x1 + 2, -hw],
        [x1 - 6.4, -hw - 1.6],
        [x1 - 5.4, hw + 0.7],
        [x1 + 2, hw],
      ],
      p.bodyDark
    );
    if (detail()) {
      fillOval(ctx, x1 - 2.6, (opts.finSide || -1) * (hw + 2.3), 1.8, 1.3, 0, p.steelDark);
    }
  }
}

function drawMainRotor(ctx, h, spec) {
  if (h.hideRotor) return;
  const scale = hullScale(h);
  const p = spec.paint;
  const blades = spec.blades || h.rotorBlades || 2;
  const len = (spec.len || 34) * scale;
  const chord = (spec.chord || 2.6) * scale;
  const rot = h.bladeAngle || 0;
  const ry = len * VIEW25.deckRatio;
  const alpha = spec.alpha ?? 0.42;

  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.rotate(h.angle || 0);
  applyBankDeform(ctx, h.bank || 0);
  ctx.rotate(-(h.angle || 0));
  ctx.translate(-h.x, -h.y);
  ctx.lineCap = spec.swept ? 'butt' : 'square';
  for (let i = 0; i < blades; i++) {
    const a = rot + (i * Math.PI * 2) / blades;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x0 = h.x + c * 3.2 * scale;
    const y0 = h.y + s * 3.2 * scale * VIEW25.deckRatio;
    const x1 = h.x + c * len;
    const y1 = h.y + s * ry;
    ctx.strokeStyle = withAlpha(p.rotor, alpha);
    ctx.lineWidth = chord;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    if (spec.swept) {
      const tip = len * 0.12;
      const tx = Math.cos(a + 0.28) * tip;
      const ty = Math.sin(a + 0.28) * tip * VIEW25.deckRatio;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 + tx, y1 + ty);
      ctx.stroke();
    }
    ctx.strokeStyle = withAlpha(p.rotorTip, Math.min(1, alpha + 0.28));
    ctx.lineWidth = chord * 1.05;
    ctx.beginPath();
    ctx.moveTo(h.x + c * len * 0.8, h.y + s * ry * 0.8);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.fillStyle = p.steel;
  ctx.beginPath();
  ctx.arc(h.x, h.y, (spec.hub || 2.4) * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** AH-1G — needle, single T53, one 7-tube per stub, M28, yellow boom band. */
function drawCobra(ctx, h) {
  const p = PAINT.cobra;
  beginHull(ctx, h);
  ctx.fillStyle = P.gunship.shadow;
  ctx.beginPath();
  ctx.ellipse(-2, 4.2, 22, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
  paintHaloThen(() => {
    skids(ctx, p, -9, 13, 5.2);
    boom(ctx, p, -16, -34.2, 0.95, { stabW: 3.6, stabH: 8.6 });
    tailRotor(ctx, p, -32.6, -3.4, h, 4.5, 2);

    fillPoly(
      ctx,
      [
        [-1.2, -2.8],
        [-6.8, -10.0],
        [-3.6, -10.0],
        [2.0, -2.6],
      ],
      p.bodyDark
    );
    fillPoly(
      ctx,
      [
        [-1.2, 2.8],
        [-6.8, 10.0],
        [-3.6, 10.0],
        [2.0, 2.6],
      ],
      p.bodyDark
    );
    rocketPod(ctx, p, -5.0, -10.2, 9.6, 1.7);
    rocketPod(ctx, p, -5.0, 10.2, 9.6, 1.7);

    const snake = [
      [20.6, 0],
      [18.8, -1.15],
      [16.4, -1.85],
      [4, -1.95],
      [-5, -2.05],
      [-10.2, -2.85],
      [-15.4, -1.7],
      [-16.4, -0.95],
      [-16.4, 0.95],
      [-15.4, 1.7],
      [-10.2, 2.85],
      [-5, 2.05],
      [4, 1.95],
      [16.4, 1.85],
      [18.8, 1.15],
    ];
    fillHull(ctx, snake, p.body);
    contactShade(ctx, 0.1, -2.55, 2.6, 1.05);
    contactShade(ctx, 0.1, 2.55, 2.6, 1.05);
    if (detail()) {
      fillPoly(
        ctx,
        [
          [-12, -0.45],
          [15.2, -0.42],
          [16.6, 0],
          [15.2, 0.42],
          [-12, 0.45],
        ],
        p.bodyHi
      );
      fillOval(ctx, -8.6, 0, 3.6, 2.55, 0, p.body);
      fillBox(ctx, -10.4, -3.35, 5.6, 1.15, p.bodyDark);
      fillBox(ctx, -10.4, 2.2, 5.6, 1.15, p.bodyDark);
      fillBox(ctx, -10.0, -3.15, 2.2, 0.75, '#1a1a16');
      fillBox(ctx, -10.0, 2.4, 2.2, 0.75, '#1a1a16');
      fillOval(ctx, -11.4, -2.85, 1.15, 0.7, 0, '#141410');
    }
    cobraGlass(ctx, p, 1.8, 16.2, 2.25);

    ctx.save();
    ctx.translate(18.2, 0);
    ctx.rotate(turretLocal(h));
    fillDot(ctx, 0, 0, 1.85, p.steelDark);
    fillBox(ctx, 0.6, -0.35, 2.5, 0.7, p.steelDark);
    ctx.restore();
  });
  ctx.restore();
  drawMainRotor(ctx, h, { paint: p, blades: h.rotorBlades || 2, len: 33, chord: 3.0 });
}

/** AH-1W — twin T700 saddlebags, four stations, TSU + M197. */
function drawSuperCobra(ctx, h) {
  const p = PAINT.supercobra;
  beginHull(ctx, h);
  ctx.fillStyle = P.gunship.shadow;
  ctx.beginPath();
  ctx.ellipse(-2, 4.5, 24, 3.8, 0, 0, Math.PI * 2);
  ctx.fill();
  paintHaloThen(() => {
    skids(ctx, p, -9, 13, 6.2);
    boom(ctx, p, -17, -36.7, 1.2, { stabW: 5.2, stabH: 11.2 });
    tailRotor(ctx, p, -34.8, -3.9, h, 5.1, 2);

    fillPoly(
      ctx,
      [
        [0, -4.4],
        [-9.4, -14.0],
        [-2.0, -14.0],
        [3.8, -4.2],
      ],
      p.bodyDark
    );
    fillPoly(
      ctx,
      [
        [0, 4.4],
        [-9.4, 14.0],
        [-2.0, 14.0],
        [3.8, 4.2],
      ],
      p.bodyDark
    );
    rocketPod(ctx, p, -4.2, -10.2, 11.4, 2.15);
    rocketPod(ctx, p, -4.2, 10.2, 11.4, 2.15);
    towTubes(ctx, p, -5.4, -14.0);
    towTubes(ctx, p, -5.4, 14.0);

    const snake = [
      [23.2, 0],
      [18.2, -1.65],
      [12, -2.3],
      [4, -2.45],
      [-2, -2.7],
      [-7, -5.8],
      [-16.4, -3.4],
      [-17.4, -1.25],
      [-17.4, 1.25],
      [-16.4, 3.4],
      [-7, 5.8],
      [-2, 2.7],
      [4, 2.45],
      [12, 2.3],
      [18.2, 1.65],
    ];
    fillHull(ctx, snake, p.body);
    contactShade(ctx, 1.2, -4.1, 2.8, 1.2);
    contactShade(ctx, 1.2, 4.1, 2.8, 1.2);

    fillOval(ctx, -7.2, -6.2, 5.8, 2.85, 0.08, p.bodyDark);
    fillOval(ctx, -7.2, 6.2, 5.8, 2.85, -0.08, p.bodyDark);
    if (detail()) {
      fillPoly(
        ctx,
        [
          [-12.4, -0.5],
          [16.4, -0.48],
          [17.8, 0],
          [16.4, 0.48],
          [-12.4, 0.5],
        ],
        p.bodyHi
      );
      fillOval(ctx, -7.2, -6.2, 4.8, 2.2, 0.08, p.body);
      fillOval(ctx, -7.2, 6.2, 4.8, 2.2, -0.08, p.body);
      fillOval(ctx, -12.6, -6.2, 1.8, 1.05, 0, '#121210');
      fillOval(ctx, -12.6, 6.2, 1.8, 1.05, 0, '#121210');
      fillBox(ctx, -15.2, -6.9, 4.6, 1.5, p.steelDark);
      fillBox(ctx, -15.2, 5.4, 4.6, 1.5, p.steelDark);
    }

    cobraGlass(ctx, p, 2.6, 16.4, 2.15);
    fillBox(ctx, 16.8, -1.35, 4.0, 2.7, p.steelDark);
    if (detail()) fillBox(ctx, 17.2, -0.85, 3.2, 1.1, p.steel);

    ctx.save();
    ctx.translate(21.0, 0);
    ctx.rotate(turretLocal(h));
    fillDot(ctx, 0, 0, 2.3, p.steelDark);
    fillBox(ctx, 1.4, -0.85, 5.0, 0.5, p.steelDark);
    fillBox(ctx, 1.4, -0.15, 5.0, 0.5, p.steelDark);
    fillBox(ctx, 1.4, 0.55, 5.0, 0.5, p.steelDark);
    ctx.restore();
  });
  ctx.restore();
  drawMainRotor(ctx, h, { paint: p, blades: h.rotorBlades || 2, len: 34, chord: 2.85 });
}

function apacheAirframe(ctx, h, longbow) {
  const p = longbow ? PAINT.longbow : PAINT.apache;
  beginHull(ctx, h);
  ctx.fillStyle = P.gunship.shadow;
  ctx.beginPath();
  ctx.ellipse(-1, 5.2, 24, 4.8, 0, 0, Math.PI * 2);
  ctx.fill();
  paintHaloThen(() => {
    if (_halo) {
      capsule(ctx, 3.2, -3.4, 5.0, -7.6, 0.7, HALO);
      capsule(ctx, 3.2, 3.4, 5.0, 7.6, 0.7, HALO);
      capsule(ctx, -28.6, 0, -31.4, 0, 0.55, HALO);
    } else {
      ctx.strokeStyle = p.skid;
      ctx.lineWidth = 1.1 * INNER;
      ctx.beginPath();
      ctx.moveTo(3.2, -3.4);
      ctx.lineTo(5.0, -7.6);
      ctx.moveTo(3.2, 3.4);
      ctx.lineTo(5.0, 7.6);
      ctx.moveTo(-28.6, 0);
      ctx.lineTo(-31.4, 0);
      ctx.stroke();
    }
    fillDot(ctx, 5.1, -7.8, 1.7, p.skid);
    fillDot(ctx, 5.1, 7.8, 1.7, p.skid);
    fillDot(ctx, -31.6, 0, 1.2, p.skid);

    boom(ctx, p, -15, -33.7, 1.55, { stabW: 7.2, stabH: 15.6, stabX: 0.8 });
    tailRotor(ctx, p, -32.0, -4.6, h, 5.6, 4);

    fillPoly(
      ctx,
      [
        [2.6, -5.4],
        [-6.8, -15.6],
        [0.2, -15.6],
        [7.0, -5.2],
      ],
      p.bodyDark
    );
    fillPoly(
      ctx,
      [
        [2.6, 5.4],
        [-6.8, 15.6],
        [0.2, 15.6],
        [7.0, 5.2],
      ],
      p.bodyDark
    );
    if (longbow) {
      fillBox(ctx, -1.2, -16.6, 3.6, 1.7, p.steelDark);
      fillBox(ctx, -1.2, 14.9, 3.6, 1.7, p.steelDark);
    }
    rocketPod(ctx, p, -2.2, -11.2, 10.8, 2.15);
    rocketPod(ctx, p, -2.2, 11.2, 10.8, 2.15);
    hellfireRack(ctx, p, -3.0, -15.6);
    hellfireRack(ctx, p, -3.0, 15.6);

    const hull = [
      [17.6, 0],
      [16.2, -3.2],
      [8.2, -3.8],
      [1.0, -4.2],
      [-7.2, -5.4],
      [-14.0, -3.0],
      [-15.4, -1.45],
      [-15.4, 1.45],
      [-14.0, 3.0],
      [-7.2, 5.4],
      [1.0, 4.2],
      [8.2, 3.8],
      [16.2, 3.2],
    ];
    fillHull(ctx, hull, p.body);
    contactShade(ctx, 3.2, -5.0, 3.0, 1.25);
    contactShade(ctx, 3.2, 5.0, 3.0, 1.25);
    if (detail()) {
      fillPoly(
        ctx,
        [
          [-10, -0.85],
          [11, -0.8],
          [12.6, 0],
          [11, 0.8],
          [-10, 0.85],
        ],
        p.bodyHi
      );
      ctx.strokeStyle = withAlpha(p.outline, 0.28);
      ctx.lineWidth = 0.55 * INNER;
      ctx.beginPath();
      ctx.moveTo(15.4, -3.0);
      ctx.lineTo(-6.4, -4.6);
      ctx.moveTo(15.4, 3.0);
      ctx.lineTo(-6.4, 4.6);
      ctx.stroke();
    }

    for (const side of [-1, 1]) {
      const y = side * 7.6;
      fillOval(ctx, -1.2, y, 6.8, 3.05, 0, p.bodyDark);
      if (detail()) {
        fillOval(ctx, -1.2, y, 5.7, 2.35, 0, p.body);
        fillOval(ctx, 3.6, y, 1.85, 1.25, 0, '#121210');
        fillBox(ctx, -6.8, y - 0.7, 3.4, 1.4, p.steelDark);
      }
    }

    apacheGlass(ctx, p);
    fillDot(ctx, 18.6, -1.35, 1.85, p.steelDark);
    fillDot(ctx, 18.6, 1.4, 1.55, p.steelDark);
    if (detail()) {
      fillDot(ctx, 18.6, -1.35, 0.75, p.steel);
      fillDot(ctx, 18.6, 1.4, 0.6, p.steel);
    }

    ctx.save();
    ctx.translate(9.6, 0.4);
    ctx.rotate(turretLocal(h));
    fillBox(ctx, 0, -0.65, 9.0, 1.3, p.steelDark);
    if (detail()) fillBox(ctx, 7.2, -0.35, 2.2, 0.7, p.steel);
    ctx.restore();
  });
  ctx.restore();
  drawMainRotor(ctx, h, {
    paint: p,
    blades: h.rotorBlades || 4,
    len: 34,
    chord: 2.15,
    hub: longbow ? 2.8 : 2.4,
    swept: true,
  });
  if (longbow) {
    const s = hullScale(h);
    ctx.fillStyle = p.steelDark;
    ctx.beginPath();
    ctx.arc(h.x, h.y, 1.4 * s, 0, Math.PI * 2);
    ctx.fill();
    const fcr = ctx.createRadialGradient(h.x - 1.4 * s, h.y - 1.8 * s, 0.4 * s, h.x, h.y, 5.8 * s);
    fcr.addColorStop(0, shade(p.steel, 0.12));
    fcr.addColorStop(0.5, p.steel);
    fcr.addColorStop(1, shade(p.steel, -0.12));
    ctx.fillStyle = fcr;
    ctx.beginPath();
    ctx.ellipse(h.x, h.y, 5.6 * s, 5.6 * s * VIEW25.deckRatio, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade(p.steel, -0.18);
    ctx.beginPath();
    ctx.ellipse(h.x, h.y, 3.8 * s, 3.8 * s * VIEW25.deckRatio, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = withAlpha(p.outline, 0.65);
    ctx.lineWidth = 1.2 * s;
    ctx.beginPath();
    ctx.ellipse(h.x, h.y, 5.6 * s, 5.6 * s * VIEW25.deckRatio, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawApache(ctx, h) {
  apacheAirframe(ctx, h, false);
}

function drawLongbow(ctx, h) {
  apacheAirframe(ctx, h, true);
}

/** MH-60L DAP — egg Black Hawk, round metal nose, ESSS, 4-blade. */
function drawDap(ctx, h) {
  const p = PAINT.dap;
  beginHull(ctx, h);
  ctx.fillStyle = P.gunship.shadow;
  ctx.beginPath();
  ctx.ellipse(-2, 4.6, 27, 4.2, 0, 0, Math.PI * 2);
  ctx.fill();
  paintHaloThen(() => {
    if (_halo) {
      capsule(ctx, 3.4, -3.4, 4.6, -6.2, 0.65, HALO);
      capsule(ctx, 3.4, 3.4, 4.6, 6.2, 0.65, HALO);
      capsule(ctx, -29.0, 0, -31.6, 0, 0.55, HALO);
    } else {
      ctx.strokeStyle = p.skid;
      ctx.lineWidth = 1.1 * INNER;
      ctx.beginPath();
      ctx.moveTo(3.4, -3.4);
      ctx.lineTo(4.6, -6.2);
      ctx.moveTo(3.4, 3.4);
      ctx.lineTo(4.6, 6.2);
      ctx.moveTo(-29.0, 0);
      ctx.lineTo(-31.6, 0);
      ctx.stroke();
    }
    fillDot(ctx, 4.7, -6.35, 1.55, p.skid);
    fillDot(ctx, 4.7, 6.35, 1.55, p.skid);
    fillDot(ctx, -31.8, 0, 1.15, p.skid);

    boom(ctx, p, -16.2, -34.6, 1.55, { stabW: 5.6, stabH: 12.2, stabX: 2.8, noFin: true });
    fillPoly(
      ctx,
      [
        [-30.2, -1.7],
        [-35.4, -1.15],
        [-36.2, 0],
        [-35.4, 1.15],
        [-30.2, 1.7],
        [-29.2, 0],
      ],
      p.bodyDark
    );
    tailRotor(ctx, p, -33.2, 3.4, h, 5.0, 4);

    fillPoly(
      ctx,
      [
        [1.8, -5.5],
        [-8.4, -14.8],
        [-4.6, -15.3],
        [4.2, -5.5],
      ],
      p.bodyDark
    );
    fillPoly(
      ctx,
      [
        [1.8, 5.5],
        [-8.4, 14.8],
        [-4.6, 15.3],
        [4.2, 5.5],
      ],
      p.bodyDark
    );
    rocketPod(ctx, p, -2.4, -10.0, 10.4, 1.9);
    rocketPod(ctx, p, -2.4, 10.0, 10.4, 1.9);
    hellfireRack(ctx, p, -3.4, -14.6, 0.88);
    hellfireRack(ctx, p, -3.4, 14.6, 0.88);
    capsule(ctx, -5.4, -7.2, 1.6, -7.2, 1.15, p.steelDark);
    capsule(ctx, -5.4, 7.2, 1.6, 7.2, 1.15, p.steelDark);

    const hull = [
      [19.88, 0],
      [19.8, -1.4],
      [19.55, -2.7],
      [19.1, -3.85],
      [18.25, -4.85],
      [16.7, -5.4],
      [14.4, -5.68],
      [11.0, -5.86],
      [7.2, -5.96],
      [3.2, -6.1],
      [-0.6, -6.32],
      [-4.6, -6.16],
      [-7.4, -5.9],
      [-9.15, -5.0],
      [-10.55, -3.45],
      [-12.0, -2.18],
      [-13.8, -1.68],
      [-16.2, -1.55],
      [-16.2, 1.55],
      [-13.8, 1.68],
      [-12.0, 2.18],
      [-10.55, 3.45],
      [-9.15, 5.0],
      [-7.4, 5.9],
      [-4.6, 6.16],
      [-0.6, 6.32],
      [3.2, 6.1],
      [7.2, 5.96],
      [11.0, 5.86],
      [14.4, 5.68],
      [16.7, 5.4],
      [18.25, 4.85],
      [19.1, 3.85],
      [19.55, 2.7],
      [19.8, 1.4],
    ];
    fillHull(ctx, hull, p.body);
    if (detail()) fillDot(ctx, 19.55, 0, 0.4, p.steelDark);
    contactShade(ctx, 1.6, -5.7, 2.8, 1.05);
    contactShade(ctx, 1.6, 5.7, 2.8, 1.05);
    if (detail()) {
      fillPoly(
        ctx,
        [
          [-10.4, -0.75],
          [8.6, -0.7],
          [9.4, 0],
          [8.6, 0.7],
          [-10.4, 0.75],
        ],
        p.bodyHi
      );
      fillBox(ctx, -9.6, -3.55, 7.4, 2.55, p.bodyDark);
      fillBox(ctx, -9.6, 1.0, 7.4, 2.55, p.bodyDark);
      fillBox(ctx, -9.2, -3.15, 6.6, 1.85, p.body);
      fillBox(ctx, -9.2, 1.3, 6.6, 1.85, p.body);
      fillBox(ctx, -9.6, -2.55, 1.15, 1.15, '#121210');
      fillBox(ctx, -9.6, 1.4, 1.15, 1.15, '#121210');
    }

    dapGlass(ctx, p);
  });
  ctx.restore();
  drawMainRotor(ctx, h, {
    paint: p,
    blades: h.rotorBlades || 4,
    len: 38,
    chord: 2.45,
    hub: 2.5,
    alpha: 0.4,
  });
}

/** RAH-66 — stealth kite from the plate: long canopy, short EFAMS, wheels, T-tail fantail. */
function drawComanche(ctx, h) {
  const p = PAINT.comanche;
  beginHull(ctx, h);
  ctx.fillStyle = P.gunship.shadow;
  ctx.beginPath();
  ctx.ellipse(-2, 3.8, 22, 3.4, 0, 0, Math.PI * 2);
  ctx.fill();
  paintHaloThen(() => {
    comancheMissiles(ctx, p, -1);
    comancheMissiles(ctx, p, 1);

    const kite = [
      [21.8, 0],
      [21.2, -0.55],
      [20.2, -1.15],
      [18.6, -1.95],
      [16.4, -2.85],
      [13.2, -3.55],
      [8.6, -4.35],
      [3.4, -5.15],
      [-1.2, -5.55],
      [-6.4, -5.15],
      [-12.2, -3.85],
      [-18.4, -2.45],
      [-24.8, -1.55],
      [-30.6, -1.2],
      [-35.2, -1.65],
      [-35.2, 1.65],
      [-30.6, 1.2],
      [-24.8, 1.55],
      [-18.4, 2.45],
      [-12.2, 3.85],
      [-6.4, 5.15],
      [-1.2, 5.55],
      [3.4, 5.15],
      [8.6, 4.35],
      [13.2, 3.55],
      [16.4, 2.85],
      [18.6, 1.95],
      [20.2, 1.15],
      [21.2, 0.55],
    ];
    fillHull(ctx, kite, p.body);
    contactShade(ctx, 1.6, -4.7, 2.2, 0.95);
    contactShade(ctx, 1.6, 4.7, 2.2, 0.95);

    comancheWing(ctx, p, -1);
    comancheWing(ctx, p, 1);

    if (detail()) {
      fillPoly(
        ctx,
        [
          [-26.0, -0.5],
          [4.0, -0.5],
          [4.6, 0],
          [4.0, 0.5],
          [-26.0, 0.5],
        ],
        p.bodyHi
      );
      fillBox(ctx, -14.2, -2.35, 5.6, 1.35, p.bodyDark);
      fillBox(ctx, -14.2, 1.0, 5.6, 1.35, p.bodyDark);
      fillBox(ctx, -8.0, -1.85, 3.2, 0.95, p.bodyDark);
      fillBox(ctx, -8.0, 0.9, 3.2, 0.95, p.bodyDark);
    }

    // Main wheels just aft of the EFAMS stubs (not on the wing top).
    for (const s of [-1, 1]) {
      if (_halo) fillDot(ctx, -2.4, s * 6.55, 1.45, HALO);
      else {
        fillDot(ctx, -2.4, s * 6.55, 1.25, p.skid);
        if (detail()) fillDot(ctx, -2.4, s * 6.55, 0.5, p.steel);
      }
    }

    fillBox(ctx, -36.8, -7.6, 6.2, 15.2, p.bodyHi);
    fillBox(ctx, -36.2, -0.65, 4.4, 1.3, p.body);
    fillBox(ctx, -37.0, -8.15, 1.35, 2.4, p.bodyDark);
    fillBox(ctx, -37.0, 5.75, 1.35, 2.4, p.bodyDark);

    if (detail()) {
      fillDot(ctx, -32.8, 0, 2.85, '#070907');
      ctx.strokeStyle = p.bodyHi;
      ctx.lineWidth = 1.0 * INNER;
      ctx.beginPath();
      ctx.arc(-32.8, 0, 2.85, 0, Math.PI * 2);
      ctx.stroke();
      const fanA = (h.bladeAngle * 3.1) % (Math.PI * 2);
      ctx.strokeStyle = withAlpha(p.rotor, 0.72);
      ctx.lineWidth = 0.65 * INNER;
      for (let i = 0; i < 4; i++) {
        const a = fanA + (i * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(-32.8 + Math.cos(a) * 2.45, Math.sin(a) * 1.05);
        ctx.lineTo(-32.8 - Math.cos(a) * 2.45, -Math.sin(a) * 1.05);
        ctx.stroke();
      }
    }

    comancheGlass(ctx, p);

    if (detail()) {
      fillOval(ctx, 20.35, 0, 1.45, 1.15, 0, p.steelDark);
      fillDot(ctx, 20.55, 0, 0.45, p.steel);
      fillPoly(
        ctx,
        [
          [20.7, -0.55],
          [23.1, -0.72],
          [23.1, -0.4],
          [20.9, -0.2],
        ],
        p.steelDark
      );
      fillPoly(
        ctx,
        [
          [20.7, 0.1],
          [23.1, -0.05],
          [23.1, 0.28],
          [20.9, 0.4],
        ],
        p.steelDark
      );
    }
  });
  ctx.restore();
  drawMainRotor(ctx, h, {
    paint: p,
    blades: h.rotorBlades || 5,
    len: 30,
    chord: 1.55,
    alpha: 0.34,
    hub: 2.1,
    swept: true,
  });
}

const DRAW = {
  cobra: drawCobra,
  supercobra: drawSuperCobra,
  apache: drawApache,
  longbow: drawLongbow,
  dap: drawDap,
  comanche: drawComanche,
};

export function drawHeliShadow(ctx, h) {
  const scale = (h.drawScale || 1) * (h.airframeScale || 1);
  const sun = currentSun();
  const bank = h.bank || 0;
  const px = -Math.sin(h.angle || 0);
  const py = Math.cos(h.angle || 0);
  const alpha = 0.18 + 0.2 * sun.strength;
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.beginPath();
  ctx.ellipse(
    h.x + sun.shadowDx * scale * 0.55 + px * bank * 8 * scale,
    h.y + sun.shadowDy * scale * 0.55 + py * bank * 8 * scale,
    26 * scale,
    5.0 * scale,
    h.angle || 0,
    0,
    Math.PI * 2
  );
  ctx.fill();
}

export function drawGunship(ctx, h) {
  if (Number.isFinite(h.hour)) setSun(h.hour);
  const fn = DRAW[h.gunshipId] || DRAW.cobra;
  fn(ctx, h);
}

export const GUNSHIP_DRAW_IDS = Object.keys(DRAW);
