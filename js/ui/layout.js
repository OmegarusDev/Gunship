/**
 * Responsive chrome for menu screens. Keeps the tactical look; only the
 * spacing and hit-targets change with phone / tablet / desktop and orientation.
 */
import { P } from '../palette.js';

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

function readCssPx(name) {
  if (typeof getComputedStyle === 'undefined' || typeof document === 'undefined') return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

export function safeInsets() {
  return {
    t: readCssPx('--sat'),
    r: readCssPx('--sar'),
    b: readCssPx('--sab'),
    l: readCssPx('--sal'),
  };
}

/** Viewport metrics used by every menu screen. */
export function layoutOf(w, h) {
  const inset = safeInsets();
  const portrait = h >= w;
  const shortSide = Math.min(w, h);
  const phone = shortSide < 520;
  const tablet = shortSide >= 520 && shortSide < 900;
  const desktop = !phone && !tablet;
  const pad = phone ? 20 : tablet ? 28 : 40;
  const btnH = phone ? 56 : 60;
  const btnGap = phone ? 12 : 16;
  const headerH = (portrait ? 96 : 82) + inset.t;
  const footerH = btnH + Math.max(pad, 24) + inset.b;
  const rawW = Math.max(160, w - pad * 2 - inset.l - inset.r);
  const maxContent = desktop ? 880 : tablet ? 740 : rawW;
  const contentW = Math.min(rawW, maxContent);
  const content = {
    x: (w - contentW) / 2,
    y: headerH,
    w: contentW,
    h: Math.max(80, h - headerH - footerH),
  };
  return {
    w,
    h,
    portrait,
    landscape: !portrait,
    phone,
    tablet,
    desktop,
    compact: content.h < 340 || shortSide < 400,
    pad,
    btnH,
    btnGap,
    btnFont: phone ? 16 : 17,
    headerH,
    footerH,
    content,
    inset,
    inner: phone ? 16 : 22,
  };
}

export function backButtonRect(layout, label = '◂ BACK') {
  const w = Math.max(168, Math.min(220, 28 + label.length * 10));
  return {
    x: layout.content.x,
    y: layout.h - layout.footerH + layout.pad * 0.35,
    w,
    h: layout.btnH,
  };
}

export function primaryButtonRect(layout, minW = 200) {
  const w = Math.min(layout.content.w, Math.max(minW, layout.phone ? layout.content.w * 0.48 : 240));
  return {
    x: layout.content.x + layout.content.w - w,
    y: layout.h - layout.footerH + layout.pad * 0.35,
    w,
    h: layout.btnH,
  };
}

export function footerPairRects(layout, { backLabel = '◂ BACK', primaryMinW = 200 } = {}) {
  const back = backButtonRect(layout, backLabel);
  const primary = primaryButtonRect(layout, primaryMinW);
  if (back.x + back.w + 12 > primary.x) {
    const gap = 10;
    const each = (layout.content.w - gap) / 2;
    back.w = each;
    primary.x = layout.content.x + each + gap;
    primary.w = each;
  }
  return { back, primary };
}

/** Evenly spaced footer actions (BACK + shortcuts). */
export function footerNavRects(layout, labels) {
  const n = Math.max(1, labels.length);
  const gap = 10;
  const y = layout.h - layout.footerH + layout.pad * 0.35;
  const h = layout.btnH;
  const w = (layout.content.w - gap * (n - 1)) / n;
  return labels.map((label, i) => ({
    x: layout.content.x + i * (w + gap),
    y,
    w,
    h,
    label,
  }));
}

const menuPointer = { x: -1, y: -1, down: false, inside: false };
const menuPulses = new Map();
let menuPressKey = null;
let menuHoverThisFrame = false;

function rectKey(rect) {
  return `${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.w)}:${Math.round(rect.h)}`;
}

function pointInRect(px, py, rect) {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

/** CSS-pixel pointer for menu hover / press. Call once per frame before drawing. */
export function setMenuPointer(x, y, { down = false, inside = false } = {}) {
  const wasDown = menuPointer.down;
  menuPointer.x = x;
  menuPointer.y = y;
  menuPointer.down = Boolean(down);
  menuPointer.inside = Boolean(inside);
  if (down && !wasDown) menuPressKey = 'pending';
  if (!down) menuPressKey = null;
  menuHoverThisFrame = false;
  const now = performance.now();
  for (const [key, pulse] of menuPulses) {
    if (pulse.until <= now) menuPulses.delete(key);
  }
}

export function menuCursor() {
  return menuHoverThisFrame ? 'pointer' : 'default';
}

/** Hover / press / release-bounce for any menu hit target. */
export function menuHit(rect, { disabled = false, quiet = false } = {}) {
  if (!rect || disabled) {
    return { hover: false, pressed: false, pulse: 0, scale: 1 };
  }
  const now = performance.now();
  const key = rectKey(rect);
  const hover = menuPointer.inside && pointInRect(menuPointer.x, menuPointer.y, rect);
  if (hover) menuHoverThisFrame = true;
  if (hover && menuPressKey === 'pending') {
    menuPressKey = key;
    menuPulses.set(key, { until: now + 170, dur: 170 });
  }
  const rec = menuPulses.get(key);
  const pulse = rec && rec.until > now ? (rec.until - now) / rec.dur : 0;
  const pressed = hover && menuPointer.down;
  let scale = 1;
  if (!quiet) {
    if (pressed) scale = 0.96;
    else if (pulse > 0) scale = 0.96 + (1 - pulse) * 0.1;
    else if (hover) scale = 1.03;
  }
  return { hover, pressed, pulse, scale };
}

export function applyMenuHitTransform(ctx, rect, opts) {
  const hit = menuHit(rect, opts);
  if (hit.scale !== 1) {
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    ctx.translate(cx, cy);
    ctx.scale(hit.scale, hit.scale);
    ctx.translate(-cx, -cy);
  }
  return hit;
}

export function paintMenuGlow(ctx, rect, hit, color = 'rgba(170,255,136,0.7)') {
  if (!hit || (!hit.hover && !hit.pressed && hit.pulse <= 0)) return;
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = hit.pressed ? 22 : 14 + hit.pulse * 12;
  ctx.strokeStyle = hit.pressed ? '#f2ffe6' : color;
  ctx.lineWidth = hit.pressed ? 2.3 : 1.8;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
  ctx.restore();
}

export function menuPointerPos() {
  return { x: menuPointer.x, y: menuPointer.y, inside: menuPointer.inside };
}

const HEADER_CHIP_H = 32;
let lastHeaderCog = null;

export function headerCogRect(layout) {
  return {
    x: layout.content.x,
    y: (layout.headerMetaY || 18) - 2,
    w: HEADER_CHIP_H,
    h: HEADER_CHIP_H,
  };
}

export function lastHeaderCogRect() {
  return lastHeaderCog;
}

export function clearHeaderCog() {
  lastHeaderCog = null;
}

function drawCogIcon(ctx, cx, cy, radius, color) {
  const teeth = 8;
  const tip = radius;
  const valley = radius * 0.62;
  const hole = radius * 0.32;
  const step = Math.PI / teeth;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a = i * step * 2 - step * 0.5;
    const pt = (ang, r) => [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
    const p0 = pt(a, valley);
    if (i === 0) ctx.moveTo(p0[0], p0[1]);
    else ctx.lineTo(p0[0], p0[1]);
    ctx.lineTo(...pt(a + step * 0.55, tip));
    ctx.lineTo(...pt(a + step, tip));
    ctx.lineTo(...pt(a + step * 1.45, valley));
  }
  ctx.closePath();
  ctx.moveTo(cx + hole, cy);
  ctx.arc(cx, cy, hole, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
}

/** Settings cog in the header, left-aligned opposite the cash chip. */
export function drawHeaderCog(ctx, layout) {
  const rect = headerCogRect(layout);
  ctx.save();
  const hit = applyMenuHitTransform(ctx, rect);
  ctx.fillStyle = hit.hover || hit.pressed ? 'rgba(28,48,20,0.96)' : 'rgba(10,18,8,0.92)';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = hit.hover || hit.pressed ? P.ui.borderHi : 'rgba(136,170,102,0.7)';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
  drawCogIcon(
    ctx,
    rect.x + rect.w / 2,
    rect.y + rect.h / 2,
    9,
    hit.hover || hit.pressed ? P.ui.textBright : '#c8e8a8'
  );
  ctx.restore();
  lastHeaderCog = rect;
  return rect;
}

/** Wallet chip in the header, right-aligned to the content column. */
export function drawHeaderDollars(ctx, layout, dollars) {
  const label = `$${dollars}`;
  ctx.font = 'bold 20px "Courier New", monospace';
  const tw = ctx.measureText(label).width;
  const chipW = tw + 24;
  const chipH = HEADER_CHIP_H;
  const x = layout.content.x + layout.content.w - chipW;
  const y = (layout.headerMetaY || 18) - 2;
  ctx.fillStyle = 'rgba(10,18,8,0.92)';
  ctx.fillRect(x, y, chipW, chipH);
  ctx.strokeStyle = 'rgba(204,170,68,0.7)';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(x + 0.5, y + 0.5, chipW - 1, chipH - 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffcc44';
  ctx.fillText(label, x + chipW / 2, y + chipH / 2 + 0.5);
}

/** Dedicated footer band so BACK never collides with content. */
export function drawFooterStrip(ctx, w, h) {
  const layout = layoutOf(w, h);
  const y = h - layout.footerH;
  ctx.fillStyle = 'rgba(8,14,8,0.94)';
  ctx.fillRect(0, y, w, layout.footerH);
  ctx.strokeStyle = 'rgba(90,140,80,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, y + 0.5);
  ctx.lineTo(w, y + 0.5);
  ctx.stroke();
}

/** Small cursor-following callout. `anchor` is the pointer or a card corner. */
export function drawCursorTooltip(ctx, text, anchorX, anchorY, bounds) {
  if (!text) return;
  ctx.save();
  ctx.font = '13px "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const padX = 12;
  const padY = 8;
  const lineH = 17;
  const maxLine = Math.min(320, Math.max(160, (bounds?.w ?? 400) * 0.7));
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxLine && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  let tw = 0;
  for (const row of lines) tw = Math.max(tw, ctx.measureText(row).width);
  const bw = tw + padX * 2;
  const bh = lines.length * lineH + padY * 2;
  let x = anchorX + 16;
  let y = anchorY - bh - 12;
  const minX = bounds?.x ?? 8;
  const minY = bounds?.y ?? 8;
  const maxX = (bounds?.x ?? 0) + (bounds?.w ?? 640);
  const maxY = (bounds?.y ?? 0) + (bounds?.h ?? 400);
  if (x + bw > maxX) x = maxX - bw;
  if (x < minX) x = minX;
  if (y < minY) y = anchorY + 18;
  if (y + bh > maxY) y = maxY - bh;
  ctx.fillStyle = 'rgba(8,16,10,0.96)';
  ctx.fillRect(x, y, bw, bh);
  ctx.strokeStyle = P.ui.borderHi;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(x, y, bw, bh);
  drawCornerBrackets(ctx, x, y, bw, bh, P.ui.borderHi, 6, 1.2);
  ctx.fillStyle = P.ui.textBright;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x + padX, y + padY + i * lineH);
  }
  ctx.restore();
}

export function drawPanel(ctx, x, y, w, h, { stroke = P.ui.border, fill = '#0d210f' } = {}) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(x, y, w, h);
  drawCornerBrackets(ctx, x, y, w, h, P.ui.borderHi, 14, 2);
}

export const WINDOW_TITLE_H = 30;

/**
 * Phosphor desktop window: title bar, optional close box, scanlines.
 * Caller is in CSS-pixel space.
 */
export function drawOsWindow(
  ctx,
  rect,
  { title = '', close = true, danger = false, fill = '#0c1610' } = {}
) {
  const { x, y, w, h } = rect;
  const barH = WINDOW_TITLE_H;
  const stroke = danger ? '#aa5544' : P.ui.borderHi;
  const barFill = danger ? 'rgba(72, 22, 16, 0.96)' : 'rgba(16, 40, 18, 0.96)';
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.6;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  drawCornerBrackets(ctx, x, y, w, h, danger ? '#ff8866' : 'rgba(170,255,136,0.55)', 12, 1.6);

  ctx.fillStyle = barFill;
  ctx.fillRect(x + 1, y + 1, w - 2, barH);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  for (let row = 0; row < barH; row += 2) ctx.fillRect(x + 1, y + 1 + row, w - 2, 1);
  ctx.strokeStyle = danger ? 'rgba(204,80,64,0.55)' : 'rgba(90,140,80,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 1, y + barH + 0.5);
  ctx.lineTo(x + w - 1, y + barH + 0.5);
  ctx.stroke();

  const closeW = 22;
  const closeH = 18;
  const closeRect = close
    ? {
        x: x + w - closeW - 7,
        y: y + Math.round((barH - closeH) / 2) + 1,
        w: closeW,
        h: closeH,
      }
    : null;
  const titleMax = closeRect ? closeRect.x - x - 18 : w - 20;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 10, y + 1, Math.max(8, titleMax), barH);
  ctx.clip();
  ctx.fillStyle = danger ? '#ffb0a0' : P.ui.textBright;
  ctx.font = 'bold 13px "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(title).toUpperCase(), x + 12, y + 1 + barH / 2 + 0.5);
  ctx.restore();

  if (closeRect) {
    const hit = menuHit(closeRect);
    ctx.fillStyle = hit.hover || hit.pressed ? '#6a2420' : '#2c1412';
    ctx.fillRect(closeRect.x, closeRect.y, closeRect.w, closeRect.h);
    ctx.strokeStyle = hit.hover || hit.pressed ? '#ff9990' : '#cc6660';
    ctx.lineWidth = 1.1;
    ctx.strokeRect(closeRect.x + 0.5, closeRect.y + 0.5, closeRect.w - 1, closeRect.h - 1);
    ctx.fillStyle = '#ffe8e4';
    ctx.font = 'bold 13px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('X', closeRect.x + closeRect.w / 2, closeRect.y + closeRect.h / 2 + 0.5);
  }

  return {
    close: closeRect,
    body: { x: x + 1, y: y + barH + 1, w: w - 2, h: h - barH - 2 },
    panel: rect,
  };
}

export function drawMenuButton(
  ctx,
  rect,
  { label, sub, kind = 'menu', blink = false, disabled = false, compact = false, prominent = false } = {}
) {
  const { x, y, w, h } = rect;
  const primary = kind === 'primary';
  const accent = kind === 'accent';
  const small = compact || h < 42;
  ctx.save();
  if (disabled) ctx.globalAlpha *= 0.4;
  const hit = applyMenuHitTransform(ctx, rect, { disabled, quiet: small });
  const glow = accent ? 'rgba(68,238,238,0.85)' : 'rgba(170,255,136,0.8)';
  ctx.fillStyle = hit.pressed
    ? primary
      ? 'rgba(70,110,48,0.96)'
      : accent
        ? 'rgba(68,204,204,0.28)'
        : 'rgba(48,84,36,0.94)'
    : hit.hover
      ? primary
        ? 'rgba(46,82,36,0.94)'
        : accent
          ? 'rgba(68,204,204,0.2)'
          : 'rgba(36,68,28,0.9)'
      : primary
        ? 'rgba(28,52,22,0.85)'
        : accent
          ? 'rgba(68,204,204,0.12)'
          : 'rgba(20,40,16,0.72)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = blink || hit.pressed
    ? P.ui.textBright
    : accent
      ? '#44cccc'
      : P.ui.borderHi;
  ctx.lineWidth = !small && (primary || blink || hit.hover) ? 1.7 : 1.15;
  ctx.strokeRect(x, y, w, h);
  drawCornerBrackets(
    ctx,
    x,
    y,
    w,
    h,
    hit.hover || hit.pressed
      ? glow
      : primary
        ? 'rgba(170,255,136,0.55)'
        : accent
          ? '#44cccc'
          : 'rgba(120,200,120,0.45)',
    small ? 5 : 8,
    small ? 1.15 : 1.5
  );
  if (!small) paintMenuGlow(ctx, rect, hit, glow);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (sub) {
    ctx.fillStyle = primary || kind === 'menu' ? P.ui.textBright : '#88eeee';
    const labelPx = prominent ? (h >= 52 ? 20 : 18) : h >= 54 ? 16 : 14;
    ctx.font = `bold ${labelPx}px "Courier New", monospace`;
    ctx.fillText(label, x + w / 2, y + h * 0.38);
    ctx.fillStyle = P.ui.textDim;
    const subPx = prominent ? (h >= 52 ? 13 : 12) : h >= 54 ? 12 : 11;
    ctx.font = `${subPx}px "Courier New", monospace`;
    ctx.fillText(sub, x + w / 2, y + h * 0.7);
  } else {
    ctx.fillStyle = accent ? '#88eeee' : P.ui.textBright;
    const labelPx = prominent ? (small ? 16 : 20) : small ? 14 : h >= 52 ? 16 : 15;
    ctx.font = `bold ${labelPx}px "Courier New", monospace`;
    ctx.fillText(label, x + w / 2, y + h / 2 + 0.5);
  }
  ctx.restore();
}

export function drawBackButton(ctx, w, h, label = '◂ BACK') {
  const layout = layoutOf(w, h);
  const rect = backButtonRect(layout, label);
  drawMenuButton(ctx, rect, { label, kind: 'back' });
  return rect;
}

/** Tactical backdrop only. Caller must already be in CSS-pixel space. */
export function paintBackdrop(ctx, w, h) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#0a120a');
  grad.addColorStop(1, '#16240f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

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
  drawCornerBrackets(ctx, 8, 8, w - 16, h - 16, 'rgba(90,140,80,0.5)', 22, 2);
}

/** Shared header + tactical backdrop. Caller must already be in CSS-pixel space. */
export function paintScreenBackdrop(ctx, w, h, title, subtitle = '') {
  const layout = layoutOf(w, h);
  paintBackdrop(ctx, w, h);
  const titleSize = layout.compact ? 20 : 24;
  const titleBlock = subtitle ? titleSize + 26 : titleSize + 8;
  const titleY =
    layout.inset.t + Math.max(12, (layout.headerH - layout.inset.t - titleBlock) * 0.45);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = P.ui.textBright;
  ctx.font = `bold ${titleSize}px "Courier New", monospace`;
  ctx.fillText(title, w / 2, titleY);
  const tw = ctx.measureText(title).width;
  ctx.strokeStyle = P.ui.borderHi;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w / 2 - tw / 2 - 22, titleY + titleSize + 6);
  ctx.lineTo(w / 2 + tw / 2 + 22, titleY + titleSize + 6);
  ctx.stroke();
  if (subtitle) {
    ctx.fillStyle = P.ui.textDim;
    ctx.font = `${layout.compact ? 12 : 13}px "Courier New", monospace`;
    ctx.fillText(subtitle, w / 2, titleY + titleSize + 12);
  }
  layout.headerMetaY = titleY;
  drawFooterStrip(ctx, w, h);
  drawHeaderCog(ctx, layout);
  return layout;
}

export function fearUpgradeRects(w, h) {
  const layout = layoutOf(w, h);
  const n = 3;
  const gap = layout.btnGap;
  if (layout.portrait && w < 640) {
    const cardW = Math.min(360, layout.content.w);
    const cardH = Math.min(120, (layout.content.h - gap * (n - 1)) / n);
    const left = (w - cardW) / 2;
    return Array.from({ length: n }, (_, i) => ({
      x: left,
      y: layout.content.y + i * (cardH + gap),
      w: cardW,
      h: cardH,
    }));
  }
  const cardW = Math.min(220, (layout.content.w - gap * (n - 1)) / n);
  const cardH = Math.min(200, layout.content.h);
  const left = (w - (cardW * n + gap * (n - 1))) / 2;
  return Array.from({ length: n }, (_, i) => ({
    x: left + i * (cardW + gap),
    y: layout.content.y,
    w: cardW,
    h: cardH,
  }));
}
