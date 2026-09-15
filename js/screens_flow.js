/**
 * Front-end flow: splash → campaign hub.
 * One career, one living pilot; KIA assigns a replacement on the same save.
 */
import { P } from './palette.js';
import { paintBackdrop } from './appBridge.js';
import { createCareer, addCareerToRoster, loadCareer } from './meta.js';

export let splashUntil = 0;

function drawWordmark(ctx, cx, cy, size) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${size}px "Courier New", monospace`;
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillText('GUNSHIP', cx + 3, cy + 3);
  ctx.fillStyle = P.ui.borderHi;
  ctx.fillText('GUNSHIP', cx + 1.5, cy + 1.5);
  ctx.fillStyle = P.ui.textBright;
  ctx.fillText('GUNSHIP', cx, cy);
  ctx.font = `bold ${size >= 44 ? 14 : 12}px "Courier New", monospace`;
  ctx.fillStyle = P.ui.infamy;
  ctx.fillText('FREEDOM PROTOCOL', cx, cy + size * 0.58);
}

/** Load the active career, or create the only slot if this is a first launch. */
export function bootCareer() {
  const existing = loadCareer();
  if (existing?.pilot) return existing;
  const career = createCareer((Math.random() * 0xffffffff) >>> 0);
  addCareerToRoster(career);
  return career;
}

export const splashScreen = {
  enter() {
    splashUntil = performance.now() + 2000;
  },
  tick() {
    if (performance.now() >= splashUntil) return { type: 'switch', name: 'title' };
    return null;
  },
  draw(ctx, cam) {
    const w = cam.screenW;
    const h = cam.screenH;
    ctx.save();
    ctx.scale(cam.dpr, cam.dpr);
    paintBackdrop(ctx, w, h);
    drawWordmark(ctx, w / 2, h * 0.44, Math.min(64, Math.max(36, Math.floor(Math.min(w, h) / 9))));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = P.ui.textDim;
    ctx.font = '12px "Courier New", monospace';
    ctx.fillText('TAP TO BEGIN', w / 2, h - 28);
    ctx.restore();
  },
};
