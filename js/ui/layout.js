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
  const btnH = phone ? 52 : 56;
  const btnGap = phone ? 12 : 16;
  const headerH = (portrait ? 86 : 74) + inset.t;
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
    btnFont: phone ? 14 : 15,
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
export function menuHit(rect, { disabled = false } = {}) {
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
  if (pressed) scale = 0.96;
  else if (pulse > 0) scale = 0.96 + (1 - pulse) * 0.1;
  else if (hover) scale = 1.03;
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

export function drawPanel(ctx, x, y, w, h, { stroke = P.ui.border, fill = '#0d210f' } = {}) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(x, y, w, h);
  drawCornerBrackets(ctx, x, y, w, h, P.ui.borderHi, 14, 2);
}

export function drawMenuButton(
  ctx,
  rect,
  { label, sub, kind = 'menu', blink = false, disabled = false } = {}
) {
  const { x, y, w, h } = rect;
  const primary = kind === 'primary';
  const accent = kind === 'accent';
  ctx.save();
  if (disabled) ctx.globalAlpha *= 0.4;
  const hit = applyMenuHitTransform(ctx, rect, { disabled });
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
  ctx.lineWidth = primary || blink || hit.hover ? 1.7 : 1.2;
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
    8,
    1.5
  );
  paintMenuGlow(ctx, rect, hit, glow);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (sub) {
    ctx.fillStyle = primary || kind === 'menu' ? P.ui.textBright : '#88eeee';
    ctx.font = `bold ${h >= 54 ? 15 : 13}px "Courier New", monospace`;
    ctx.fillText(label, x + w / 2, y + h * 0.38);
    ctx.fillStyle = P.ui.textDim;
    ctx.font = `${h >= 54 ? 11 : 10}px "Courier New", monospace`;
    ctx.fillText(sub, x + w / 2, y + h * 0.7);
  } else {
    ctx.fillStyle = accent ? '#88eeee' : P.ui.textBright;
    ctx.font = `bold ${h >= 52 ? 15 : 13}px "Courier New", monospace`;
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
  const titleSize = layout.compact ? 17 : 20;
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
    ctx.font = `${layout.compact ? 10 : 11}px "Courier New", monospace`;
    ctx.fillText(subtitle, w / 2, titleY + titleSize + 12);
  }
  layout.headerMetaY = titleY;
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
