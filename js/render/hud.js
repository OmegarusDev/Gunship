/**
 * render/hud.js — HUD primitives shared between sortie HUD and menu screens.
 * Extracted from app.js so the main HUD draw can be tested / reused.
 */
import { P } from '../palette.js';
import { withAlpha } from '../drawUtil.js';
import { drawCornerBrackets } from '../appBridge.js';
import { clamp } from '../rng.js';

export function hudPlate(ctx, x, y, w, h, accent = 'rgba(90,140,80,0.55)') {
  ctx.fillStyle = 'rgba(6,12,6,0.62)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  drawCornerBrackets(ctx, x, y, w, h, accent, 7, 1.5);
}

export function plateHeader(ctx, px, py, pw, title, accent = P.ui.textDim) {
  ctx.font = 'bold 8px "Courier New", monospace';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
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
  if (shown > 0) { ctx.fillStyle = col; ctx.fillRect(x, y, w * clamp(shown, 0, 1), h); }
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  for (let i = 1; i < 4; i++) ctx.fillRect(x + (w * i / 4) - 0.5, y, 1, h);
  ctx.strokeStyle = opts.border || 'rgba(90,110,80,0.7)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  if (opts.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(0.55, opts.flash * 3)})`;
    ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
  }
}

export function drawOffscreenMarker(ctx, cam, w, h, wx, wy, color, textColor, tag, uiScale = 1) {
  const s = cam.worldToScreen(wx, wy);
  s.x /= uiScale; s.y /= uiScale;
  const marginX = 46, marginTop = 70;
  if (s.x >= marginX && s.x <= w - marginX && s.y >= marginTop && s.y <= h - 60) return false;
  const cx = w / 2, cyy = h / 2;
  let dx = s.x - cx, dy = s.y - cyy;
  if (dx === 0 && dy === 0) dy = -1;
  const scale = Math.min((w / 2 - marginX) / Math.abs(dx || 1e-6), (h / 2 - marginTop) / Math.abs(dy || 1e-6));
  const ax = cx + dx * scale;
  const ay = cyy + dy * scale;
  const ang = Math.atan2(dy, dx);
  const pulse = 1 + Math.sin(performance.now() / 200) * 0.1;
  ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang); ctx.scale(pulse, pulse);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(-9, -10); ctx.lineTo(-4, 0); ctx.lineTo(-9, 10); ctx.closePath(); ctx.fill();
  ctx.restore();
  const distKm = (Math.hypot(cam.x - wx, cam.y - wy) / 1000).toFixed(1);
  const label = tag ? `${tag} · ${distKm} km` : `${distKm} km`;
  ctx.fillStyle = textColor;
  ctx.font = 'bold 10px "Courier New", monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, ax - Math.cos(ang) * 30, ay - Math.sin(ang) * 30);
  return true;
}

export function drawScanlines(ctx, w, h) {
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
}

export function drawTacticalGrid(ctx, w, h) {
  ctx.strokeStyle = 'rgba(90,140,80,0.07)'; ctx.lineWidth = 1;
  const step = 48;
  ctx.beginPath();
  for (let x = (w % step) / 2; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = (h % step) / 2; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
}

export function drawRadarSweep(ctx, cx, cy, radius, tSec) {
  ctx.save();
  ctx.strokeStyle = 'rgba(90,160,80,0.16)'; ctx.lineWidth = 1;
  for (const rr of [0.33, 0.66, 1]) { ctx.beginPath(); ctx.arc(cx, cy, radius * rr, 0, Math.PI * 2); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy); ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius); ctx.stroke();
  const ang = (tSec * 1.1) % (Math.PI * 2);
  for (let i = 0; i < 24; i++) {
    const a = ang - i * 0.05;
    ctx.strokeStyle = `rgba(110,220,100,${0.30 * (1 - i / 24)})`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius); ctx.stroke();
  }
  const blips = [[0.55, 0.8], [0.72, 2.6], [0.85, 4.9], [0.4, 3.7]];
  for (const [rr, ba] of blips) {
    const bAng = ba + Math.sin(tSec * 0.23) * 0.2;
    const fade = 0.25 + 0.55 * Math.max(0, Math.cos(ang - ba));
    ctx.fillStyle = `rgba(150,255,120,${fade})`;
    ctx.beginPath(); ctx.arc(cx + Math.cos(bAng) * radius * rr, cy + Math.sin(bAng) * radius * rr, 2.4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
