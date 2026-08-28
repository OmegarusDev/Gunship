/**
 * appBridge.js — small shared UI helpers used by both app.js and meta
 * screens, kept here so meta screens never need to import app.js
 * (which would create a circular module).
 */

/** Military frame: corner brackets around a rect. */
export function drawCornerBrackets(ctx, x, y, w, h, color, len = 14, lw = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(x, y + len);
  ctx.lineTo(x, y);
  ctx.lineTo(x + len, y);
  ctx.moveTo(x + w - len, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + len);
  ctx.moveTo(x + w, y + h - len);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w - len, y + h);
  ctx.moveTo(x + len, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + h - len);
  ctx.stroke();
}

import { P } from './palette.js';

/** Standardised BACK button for menu screens. Returns its click rect. */
export function drawBackButton(ctx, w, h, label = '◂ BACK') {
  const bw = 130,
    bh = 30,
    bx = 12,
    by = h - bh - 14;
  ctx.fillStyle = 'rgba(20,40,16,0.65)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = P.ui.borderHi;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(bx, by, bw, bh);
  drawCornerBrackets(ctx, bx, by, bw, bh, 'rgba(120,200,120,0.5)', 6, 1.5);
  ctx.font = 'bold 11px "Courier New", monospace';
  ctx.fillStyle = P.ui.textBright;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, bx + bw / 2, by + bh / 2 + 0.5);
  return { x: bx, y: by, w: bw, h: bh };
}
