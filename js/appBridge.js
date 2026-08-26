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
  ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
  ctx.moveTo(x + w - len, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + len);
  ctx.moveTo(x + w, y + h - len); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - len, y + h);
  ctx.moveTo(x + len, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - len);
  ctx.stroke();
}
