/**
 * Per-sortie sun. Hour is seeded and does not tick during an op.
 * Screen / world: +X east, +Y south (canvas down).
 */
import { mulberry32 } from './rng.js';
import { withAlpha } from './drawUtil.js';

export const HANGAR_HOUR = 14;

export function wrapHour(hour) {
  if (!Number.isFinite(hour)) return 12;
  const h = hour % 24;
  return h < 0 ? h + 24 : h;
}

export function hourFromSeed(seed) {
  return mulberry32((seed >>> 0) ^ 0x51ed4a0)() * 24;
}

export function formatClock(hour) {
  const h = wrapHour(hour);
  const totalMin = Math.round(h * 60) % (24 * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function periodLabel(hour) {
  const h = wrapHour(hour);
  if (h >= 5 && h < 8) return 'DAWN';
  if (h >= 8 && h < 11) return 'MORNING';
  if (h >= 11 && h < 14) return 'NOON';
  if (h >= 14 && h < 17) return 'AFTERNOON';
  if (h >= 17 && h < 20) return 'DUSK';
  return 'NIGHT';
}

export function sunFromHour(hour) {
  const h = wrapHour(hour);
  const elev = Math.sin(((h - 6) / 12) * Math.PI);
  const az = ((h - 6) / 24) * Math.PI * 2;
  const isMoon = elev < -0.08;
  const lightAz = isMoon ? az + Math.PI : az;
  const el = isMoon ? Math.min(0.32, 0.12 - elev * 0.22) : Math.max(0.06, elev);
  const strength = isMoon ? 0.12 + 0.08 * Math.min(1, -elev) : Math.max(0.18, Math.min(1, elev));
  const tint = isMoon ? '#8aa4cc' : elev < 0.38 ? '#ffb080' : '#fff1d0';
  const dirX = Math.cos(lightAz);
  const dirY = Math.sin(lightAz);
  const shadowLen = 5 + 10 * (1 - Math.min(1, Math.max(0, el)));
  return {
    hour: h,
    dirX,
    dirY,
    elev: el,
    strength,
    tint,
    isMoon,
    shadowDx: -dirX * shadowLen,
    shadowDy: -dirY * shadowLen,
    shadowLen,
  };
}

let _sun = sunFromHour(12);

export function setSun(hourOrSun) {
  if (hourOrSun && typeof hourOrSun === 'object' && Number.isFinite(hourOrSun.dirX)) {
    _sun = hourOrSun;
    return _sun;
  }
  _sun = sunFromHour(hourOrSun);
  return _sun;
}

export function currentSun() {
  return _sun;
}

export function drawSunWash(ctx, cam) {
  const sun = currentSun();
  const b = cam.getVisibleBounds();
  const alpha = sun.isMoon ? 0.16 : 0.03 + (1 - sun.strength) * 0.11;
  ctx.fillStyle = withAlpha(sun.tint, alpha);
  ctx.fillRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
}
