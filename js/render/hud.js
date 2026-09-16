/**
 * render/hud.js — HUD primitives shared between sortie HUD and menu screens.
 * Extracted from app.js so the main HUD draw can be tested / reused.
 */
import { P } from '../palette.js';
import { drawCornerBrackets } from '../appBridge.js';
import { clamp } from '../rng.js';

export function hudPlate(ctx, x, y, w, h, accent = 'rgba(90,140,80,0.55)') {
  ctx.fillStyle = 'rgba(6,12,6,0.78)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  drawCornerBrackets(ctx, x, y, w, h, accent, 7, 1.5);
}

export function plateHeader(ctx, px, py, pw, title, accent = P.ui.textDim) {
  ctx.font = 'bold 13px "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = accent;
  ctx.fillText(title, px + 10, py + 5);
  ctx.strokeStyle = 'rgba(90,140,80,0.30)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px + 10 + ctx.measureText(title).width + 8, py + 9);
  ctx.lineTo(px + pw - 10, py + 9);
  ctx.stroke();
}

export function hudBar(ctx, x, y, w, h, frac, col, opts = {}) {
  const shown = opts.shown ?? frac;
  ctx.fillStyle = 'rgba(10,16,10,0.9)';
  ctx.fillRect(x, y, w, h);
  if (shown > 0) {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w * clamp(shown, 0, 1), h);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  for (let i = 1; i < 4; i++) ctx.fillRect(x + (w * i) / 4 - 0.5, y, 1, h);
  ctx.strokeStyle = opts.border || 'rgba(90,110,80,0.7)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  if (opts.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(0.55, opts.flash * 3)})`;
    ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
  }
}

export function drawOffscreenMarker(
  ctx,
  cam,
  w,
  h,
  wx,
  wy,
  color,
  textColor,
  tag,
  uiScale = 1,
  margins = null
) {
  const s = cam.worldToScreen(wx, wy);
  s.x /= uiScale;
  s.y /= uiScale;
  const m = {
    left: margins?.left ?? 46,
    right: margins?.right ?? margins?.left ?? 46,
    top: margins?.top ?? 70,
    bottom: margins?.bottom ?? 60,
  };
  if (s.x >= m.left && s.x <= w - m.right && s.y >= m.top && s.y <= h - m.bottom) return false;
  const cx = w / 2,
    cyy = h / 2;
  const dx = s.x - cx;
  let dy = s.y - cyy;
  if (dx === 0 && dy === 0) dy = -1;
  let sx = Infinity;
  let sy = Infinity;
  if (dx > 0) sx = (w - m.right - cx) / dx;
  else if (dx < 0) sx = (cx - m.left) / -dx;
  if (dy > 0) sy = (h - m.bottom - cyy) / dy;
  else if (dy < 0) sy = (cyy - m.top) / -dy;
  const scale = Math.min(sx, sy);
  const ax = cx + dx * scale;
  const ay = cyy + dy * scale;
  const ang = Math.atan2(dy, dx);
  const pulse = 1 + Math.sin(performance.now() / 200) * 0.1;
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(ang);
  ctx.scale(pulse, pulse);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(15, 0);
  ctx.lineTo(-9, -10);
  ctx.lineTo(-4, 0);
  ctx.lineTo(-9, 10);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  const distKm = (Math.hypot(cam.x - wx, cam.y - wy) / 1000).toFixed(1);
  const label = tag ? `${tag} · ${distKm} km` : `${distKm} km`;
  ctx.fillStyle = textColor;
  ctx.font = 'bold 12px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, ax - Math.cos(ang) * 30, ay - Math.sin(ang) * 30);
  return true;
}

export function drawScanlines(ctx, w, h) {
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
  const vg = ctx.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.35,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.75
  );
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

export function drawTacticalGrid(ctx, w, h) {
  ctx.strokeStyle = 'rgba(90,140,80,0.07)';
  ctx.lineWidth = 1;
  const step = 48;
  ctx.beginPath();
  for (let x = (w % step) / 2; x < w; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = (h % step) / 2; y < h; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
}

export function drawRadarSweep(ctx, cx, cy, radius, tSec) {
  ctx.save();
  ctx.strokeStyle = 'rgba(90,160,80,0.16)';
  ctx.lineWidth = 1;
  for (const rr of [0.33, 0.66, 1]) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.stroke();
  const ang = (tSec * 1.1) % (Math.PI * 2);
  for (let i = 0; i < 24; i++) {
    const a = ang - i * 0.05;
    ctx.strokeStyle = `rgba(110,220,100,${0.3 * (1 - i / 24)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    ctx.stroke();
  }
  const blips = [
    [0.55, 0.8],
    [0.72, 2.6],
    [0.85, 4.9],
    [0.4, 3.7],
  ];
  for (const [rr, ba] of blips) {
    const bAng = ba + Math.sin(tSec * 0.23) * 0.2;
    const fade = 0.25 + 0.55 * Math.max(0, Math.cos(ang - ba));
    ctx.fillStyle = `rgba(150,255,120,${fade})`;
    ctx.beginPath();
    ctx.arc(
      cx + Math.cos(bAng) * radius * rr,
      cy + Math.sin(bAng) * radius * rr,
      2.4,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  ctx.restore();
}

function roundPath(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, rad);
    return;
  }
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/** Single instrument fascia: glass fill, hairline, faint top sheen. */
export function hudFascia(ctx, rect, { accent = 'rgba(110,160,100,0.38)', radius = 5 } = {}) {
  const { x, y, w, h } = rect;
  ctx.save();
  ctx.beginPath();
  roundPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = 'rgba(4,10,6,0.8)';
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  roundPath(ctx, x + 1, y + 1, w - 2, Math.min(9, h * 0.32), Math.max(0, radius - 1));
  ctx.fillStyle = 'rgba(170,255,136,0.045)';
  ctx.fill();
  ctx.restore();
}

export function hudHairline(ctx, x1, y1, x2, y2, color = 'rgba(120,170,110,0.22)') {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
  ctx.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
  ctx.stroke();
}

export function ellipsize(ctx, text, maxW) {
  const t = String(text ?? '');
  if (maxW <= 0) return '';
  if (ctx.measureText(t).width <= maxW) return t;
  const ell = '…';
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(t.slice(0, mid) + ell).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? ell : t.slice(0, lo) + ell;
}

export function hudMeter(ctx, x, y, w, h, frac, col, opts = {}) {
  const shown = opts.shown ?? frac;
  ctx.fillStyle = 'rgba(8,14,8,0.92)';
  ctx.fillRect(x, y, w, h);
  if (shown > 0) {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w * clamp(shown, 0, 1), h);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let i = 1; i < 4; i++) ctx.fillRect(x + (w * i) / 4 - 0.5, y, 1, h);
  ctx.strokeStyle = opts.border || 'rgba(90,110,80,0.55)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (opts.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(0.5, opts.flash * 3)})`;
    ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
  }
}
