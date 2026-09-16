/**
 * Sortie HUD geometry in CSS-pixel logical space (after uiScale).
 * Portrait and landscape pin chrome to the edges so the playfield stays clear.
 */
import { safeInsets } from './layout.js';

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function rectsOverlap(a, b, pad = 0) {
  if (!a || !b) return false;
  return (
    a.x < b.x + b.w + pad &&
    a.x + a.w + pad > b.x &&
    a.y < b.y + b.h + pad &&
    a.y + a.h + pad > b.y
  );
}

/**
 * @param {number} W
 * @param {number} H
 * @param {{ showBossHp?: boolean, showToast?: boolean }} [flags]
 */
export function layoutSortieHud(W, H, flags = {}) {
  const inset = safeInsets();
  const portrait = H >= W;
  const shortSide = Math.min(W, H);
  const phone = shortSide < 520;
  const compact = H < 420 || W < 360;
  const pad = compact ? 8 : phone ? 10 : 14;
  const gap = compact ? 6 : 8;

  const left = pad + inset.l;
  const right = pad + inset.r;
  const top = pad + inset.t;
  const bottom = pad + Math.max(inset.b, phone ? 6 : 8);
  const innerW = Math.max(160, W - left - right);
  const innerH = Math.max(120, H - top - bottom);

  const bandH = compact ? 40 : portrait ? (phone ? 54 : 58) : 44;
  const actionW = Math.round(
    clamp(portrait ? (phone ? 118 : 128) : 132, 104, Math.max(104, innerW * 0.3))
  );
  const radarS = Math.round(
    clamp(
      portrait
        ? Math.min(108, innerW * 0.27, innerH * 0.16)
        : Math.min(92, innerH * 0.26, innerW * 0.15),
      compact ? 72 : 86,
      portrait && phone ? 108 : 116
    )
  );

  const bossH = flags.showBossHp ? (compact ? 20 : 24) : 0;
  const toastH = flags.showToast ? 22 : 0;
  const underBand = (bossH ? gap / 2 + bossH : 0) + (toastH ? 2 + toastH : 0);
  const topStack = bandH + underBand;

  const dockH = radarS;
  const dockY = H - bottom - dockH;
  const dockX = left;

  const radar = { x: dockX, y: dockY, w: radarS, h: radarS };
  const actionsX = dockX + innerW - actionW;
  const modeH = Math.max(compact ? 34 : 40, Math.round((dockH - gap) * 0.4));
  const mode = { x: actionsX, y: dockY, w: actionW, h: Math.min(modeH, dockH - gap - 36) };
  const equip = {
    x: actionsX,
    y: dockY + mode.h + gap,
    w: actionW,
    h: dockY + dockH - (dockY + mode.h + gap),
  };

  const compassGap = gap;
  const compassX = radar.x + radar.w + compassGap;
  const compassW = Math.max(0, actionsX - compassGap - compassX);
  const dock = {
    x: compassX - 6,
    y: dockY,
    w: left + innerW - (compassX - 6),
    h: dockH,
  };
  const compass = compassW >= 72
    ? {
        x: compassX,
        y: dockY + 8,
        w: compassW,
        h: dockH - 16,
      }
    : null;

  const band = { x: left, y: top, w: innerW, h: bandH };
  const missionW = Math.round(innerW * (portrait ? 0.34 : 0.3));
  const statusW = Math.round(innerW * (portrait ? 0.24 : 0.22));
  const hullW = innerW - missionW - statusW;
  const mission = { x: band.x, y: band.y, w: missionW, h: band.h };
  const hull = { x: band.x + missionW, y: band.y, w: hullW, h: band.h };
  const status = { x: band.x + missionW + hullW, y: band.y, w: statusW, h: band.h };

  const bossBar = bossH
    ? {
        x: left + innerW * 0.18,
        y: band.y + band.h + gap / 2,
        w: innerW * 0.64,
        h: bossH,
      }
    : null;

  const playfieldY = top + topStack + 4;
  const playfieldH = Math.max(80, dockY - playfieldY - 8);

  return {
    W,
    H,
    portrait,
    phone,
    compact,
    pad,
    gap,
    left,
    right,
    top,
    bottom,
    band,
    mission,
    hull,
    status,
    bossBar,
    radar,
    compass,
    dock,
    mode,
    equip,
    topReserve: playfieldY,
    bottomReserve: H - dockY,
    playfield: { x: left, y: playfieldY, w: innerW, h: playfieldH },
    hintY: playfieldY + playfieldH * 0.78,
    markerMargins: {
      left: radar.w + pad,
      right: actionW + pad,
      top: playfieldY + 4,
      bottom: dockH + bottom + 6,
    },
  };
}

/** Overlap / bounds checks used by headless layout tests. */
export function hudLayoutIssues(layout) {
  const issues = [];
  const boxes = [
    ['band', layout.band],
    ['radar', layout.radar],
    ['mode', layout.mode],
    ['equip', layout.equip],
    ['compass', layout.compass],
    ['bossBar', layout.bossBar],
  ];
  for (const [name, box] of boxes) {
    if (!box) continue;
    if (box.w < 8 || box.h < 8) issues.push(`${name} too small`);
    if (box.x < -0.5 || box.y < -0.5) issues.push(`${name} off top/left`);
    if (box.x + box.w > layout.W + 0.5 || box.y + box.h > layout.H + 0.5) {
      issues.push(`${name} off screen`);
    }
  }
  if (rectsOverlap(layout.radar, layout.mode, -1)) issues.push('radar overlaps mode');
  if (rectsOverlap(layout.radar, layout.equip, -1)) issues.push('radar overlaps equip');
  if (rectsOverlap(layout.mode, layout.equip, -1)) issues.push('mode overlaps equip');
  if (layout.compass && rectsOverlap(layout.radar, layout.compass, -1)) {
    issues.push('radar overlaps compass');
  }
  if (layout.compass && rectsOverlap(layout.mode, layout.compass, -1)) {
    issues.push('mode overlaps compass');
  }
  if (layout.compass && rectsOverlap(layout.equip, layout.compass, -1)) {
    issues.push('equip overlaps compass');
  }
  if (rectsOverlap(layout.band, layout.radar, 4)) issues.push('top band overlaps radar');
  if (layout.playfield.h < 90) issues.push('playfield too short');
  if (layout.mode.h < 32) issues.push('mode hit target too short');
  if (layout.equip.h < 36) issues.push('equip hit target too short');
  return issues;
}
