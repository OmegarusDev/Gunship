/**
 * 2.5D drawing primitives — cylinder, box, frustum, diamond, ring.
 * Ported from Tower Defence project. Light is upper-left.
 */

import { VIEW25, deckRy } from './view25.js';
import { shade, withAlpha, facePoly } from './drawUtil.js';

/** Pitch-linked vertical measure. */
export function vz(s, k) {
  return s * k * VIEW25.vExag;
}

/** Draw a 2.5D cylinder. */
export function cyl25(ctx, cx, topY, rx, rise, topCol, sideCol, bottomCol) {
  const ry = deckRy(rx);
  // Side rect
  ctx.fillStyle = sideCol;
  ctx.fillRect(cx - rx, topY, rx * 2, Math.max(1, rise));
  // Bottom ellipse (partial arc)
  ctx.fillStyle = bottomCol || shade(sideCol, -0.15);
  ctx.beginPath();
  ctx.ellipse(cx, topY + rise, rx, ry, 0, 0.15, Math.PI - 0.15);
  ctx.fill();
  // Bottom fill
  ctx.fillStyle = bottomCol || shade(sideCol, -0.15);
  ctx.beginPath();
  ctx.ellipse(cx, topY + rise, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  // Top ellipse
  ctx.fillStyle = topCol;
  ctx.beginPath();
  ctx.ellipse(cx, topY, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  // Specular highlight
  ctx.strokeStyle = withAlpha('#fff8e0', 0.18);
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.12, topY - ry * 0.08, rx * 0.72, ry * 0.55, -0.35, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();
}

/** Draw a 2.5D box with 3 visible faces. */
export function box25(ctx, cx, topY, w, d, h, m) {
  const hw = w / 2;
  const hd = d / 2;
  const skew = d * VIEW25.boxSkew;
  const tl = { x: cx - hw + skew * 0.2, y: topY - hd * 0.35 };
  const tr = { x: cx + hw + skew * 0.2, y: topY - hd * 0.35 };
  const br = { x: cx + hw - skew * 0.15, y: topY + hd * 0.55 };
  const bl = { x: cx - hw - skew * 0.15, y: topY + hd * 0.55 };

  // Right face
  ctx.fillStyle = m.sideDark;
  ctx.beginPath();
  ctx.moveTo(tr.x, tr.y);
  ctx.lineTo(br.x, br.y);
  ctx.lineTo(br.x, br.y + h);
  ctx.lineTo(tr.x, tr.y + h);
  ctx.closePath();
  ctx.fill();
  // Front face
  ctx.fillStyle = m.side;
  ctx.beginPath();
  ctx.moveTo(bl.x, bl.y);
  ctx.lineTo(br.x, br.y);
  ctx.lineTo(br.x, br.y + h);
  ctx.lineTo(bl.x, bl.y + h);
  ctx.closePath();
  ctx.fill();
  // Top face
  ctx.fillStyle = m.top;
  ctx.beginPath();
  ctx.moveTo(tl.x, tl.y);
  ctx.lineTo(tr.x, tr.y);
  ctx.lineTo(br.x, br.y);
  ctx.lineTo(bl.x, bl.y);
  ctx.closePath();
  ctx.fill();
  // Top edge light
  ctx.strokeStyle = withAlpha('#ffffff', 0.16);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(tl.x, tl.y);
  ctx.lineTo(tr.x, tr.y);
  ctx.stroke();
}

/** Draw a tapered cylinder (frustum). */
export function frustum25(ctx, cx, topY, rxBot, rxTop, rise, m) {
  const ryBot = deckRy(rxBot);
  const ryTop = deckRy(rxTop);
  ctx.fillStyle = m.side;
  ctx.beginPath();
  ctx.moveTo(cx - rxTop, topY);
  ctx.lineTo(cx - rxBot, topY + rise);
  ctx.lineTo(cx + rxBot, topY + rise);
  ctx.lineTo(cx + rxTop, topY);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = m.sideDark;
  ctx.beginPath();
  ctx.ellipse(cx, topY + rise, rxBot, ryBot, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = m.top;
  ctx.beginPath();
  ctx.ellipse(cx, topY, rxTop, ryTop, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Draw a diamond prism. */
export function diamondPrism25(ctx, cx, topY, rx, rise, m) {
  const ry = deckRy(rx);
  const top = [
    { x: cx, y: topY - ry },
    { x: cx + rx, y: topY },
    { x: cx, y: topY + ry },
    { x: cx - rx, y: topY },
  ];
  const bot = top.map((p) => ({ x: p.x, y: p.y + rise }));
  ctx.fillStyle = m.sideDark;
  facePoly(ctx, [top[1], top[2], bot[2], bot[1]]);
  ctx.fillStyle = m.side;
  facePoly(ctx, [top[2], top[3], bot[3], bot[2]]);
  ctx.fillStyle = m.top;
  facePoly(ctx, top);
}

/** Draw an elliptical ring on the ground plane. */
export function ring25(ctx, cx, y, rx, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.ellipse(cx, y, rx, deckRy(rx), 0, 0, Math.PI * 2);
  ctx.stroke();
}

/** Draw a ring of rivets. */
export function rivetRing(ctx, cx, y, rx, count, color) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const px = cx + Math.cos(a) * rx;
    const py = y + Math.sin(a) * deckRy(rx);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(0.9, rx * 0.08), 0, Math.PI * 2);
    ctx.fill();
  }
}
