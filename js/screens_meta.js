/**
 * screens_meta.js — HANGAR + PILOT RECORD screens.
 * Canvas screens registered by app.js. Reads career via metaState.
 */

import { P } from './palette.js';
import { withAlpha } from './drawUtil.js';
import { drawCornerBrackets } from './appBridge.js';
import {
  metaState, HANGAR_SLOTS, SKILL_GRID, gridNeighbors, canAllocate,
  buyHangarLevel, allocateSkill, respecSkills, saveCareer, xpToNext, clamp,
} from './meta.js';

// Click zones published each draw; app.js consults these in its handler.
export let hangarBuyBoxes = [];
export let pilotNodeBoxes = [];
export let pilotRespecBox = null;

const ACCENTS = ['rgba(255,136,68,0.6)', 'rgba(120,200,255,0.6)', 'rgba(170,255,136,0.6)', 'rgba(204,136,51,0.6)', 'rgba(255,102,102,0.6)'];
const BRANCH_NAMES = ['MARKSMAN', 'PILOT', 'RECON', 'THRUST', 'FORTITUDE'];

function careerOrEmpty() {
  return metaState.career || { pilot: { name: '—', level: 1, xp: 0, skillPoints: 0, allocated: [], stats: { accuracy: 1, control: 1, awareness: 1, speed: 1, grit: 1 } }, dollars: 0, hangar: { cobra: {} }, gunship: 'cobra' };
}

// ═════════════════════════════════════════════════════════════
//  HANGAR
// ═════════════════════════════════════════════════════════════

export const hangarScreen = {
  draw(ctx, cam) {
    const w = cam.screenW, h = cam.screenH;
    const career = careerOrEmpty();
    drawScreenBackgroundShim(ctx, cam, 'HANGAR', `${career.gunship.toUpperCase()} — PERMANENT UPGRADES`);
    ctx.save(); ctx.scale(cam.dpr, cam.dpr);

    // Balance header
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.font = 'bold 16px "Courier New", monospace';
    ctx.fillStyle = '#ffcc44';
    ctx.fillText(`$ ${career.dollars}`, w - 24, 84);

    hangarBuyBoxes = [];
    const slotIds = Object.keys(HANGAR_SLOTS);
    const rowH = 64, top = 130;
    for (let i = 0; i < slotIds.length; i++) {
      const slot = slotIds[i];
      const def = HANGAR_SLOTS[slot];
      const lvl = (career.hangar[career.gunship]?.[slot]) || 0;
      const bx = 24, by = top + i * rowH;
      const bw = w - 48;
      const maxed = lvl >= 2;
      const cost = maxed ? 0 : def.levels[lvl].cost;
      const affordable = !maxed && career.dollars >= cost;

      ctx.fillStyle = 'rgba(13,33,15,0.9)';
      ctx.fillRect(bx, by, bw, rowH - 8);
      ctx.strokeStyle = maxed ? 'rgba(63,127,63,0.7)' : affordable ? P.ui.borderHi : P.ui.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, bw, rowH - 8);

      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.font = 'bold 12px "Courier New", monospace';
      ctx.fillStyle = P.ui.textBright;
      ctx.fillText(def.name, bx + 12, by + 8);
      // Level pips
      for (let p = 0; p < 2; p++) {
        ctx.fillStyle = p < lvl ? '#aaff88' : 'rgba(90,140,80,0.35)';
        ctx.fillRect(bx + 12 + p * 14, by + 24, 10, 5);
      }
      // Effect text
      ctx.font = '9px "Courier New", monospace';
      ctx.fillStyle = P.ui.textDim;
      ctx.fillText(maxed ? def.levels[1].desc : def.levels[lvl].desc, bx + 46, by + 24);
      // Buy zone (right)
      if (!maxed) {
        const bwid = 110;
        const bxz = bx + bw - bwid - 10, byz = by + 10;
        ctx.fillStyle = affordable ? 'rgba(68,204,68,0.12)' : 'rgba(0,0,0,0.3)';
        ctx.fillRect(bxz, byz, bwid, rowH - 28);
        ctx.strokeStyle = affordable ? '#66ff66' : '#4a5a4a';
        ctx.strokeRect(bxz, byz, bwid, rowH - 28);
        ctx.fillStyle = affordable ? '#aaffaa' : P.ui.textDim;
        ctx.font = 'bold 11px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(affordable ? `BUY  $${cost}` : `$${cost}`, bxz + bwid / 2, byz + 12);
        hangarBuyBoxes.push({ x: bxz, y: byz, w: bwid, h: rowH - 28, slot });
        ctx.textAlign = 'left';
      } else {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#3f7f3f';
        ctx.font = 'bold 11px "Courier New", monospace';
        ctx.fillText('MAXED', bx + bw - 65, by + 12);
        ctx.textAlign = 'left';
      }
    }

    // Footer hint
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = P.ui.textDim;
    ctx.fillText('UPGRADES PERSIST ACROSS PILOTS · CLICK ENTRY ZONE TO BUY', w / 2, h - 30);
    ctx.fillStyle = P.ui.textDim;
    ctx.fillText('◂ BACK', 40, h - 30);
    hangarBuyBoxes.push({ x: 12, y: h - 52, w: 80, h: 30, slot: '__back' });

    drawCornerBrackets(ctx, 8, 8, w - 16, h - 16, 'rgba(90,140,80,0.5)', 22, 2);
    ctx.restore();
  },
};

// ═════════════════════════════════════════════════════════════
//  PILOT RECORD
// ═════════════════════════════════════════════════════════════

let pilotInfoSelection = null; // last-touched node for the info bar

export const pilotScreen = {
  draw(ctx, cam) {
    const w = cam.screenW, h = cam.screenH;
    const career = careerOrEmpty();
    const pilot = career.pilot;
    drawScreenBackgroundShim(ctx, cam, 'PILOT RECORD', pilot.name);
    ctx.save(); ctx.scale(cam.dpr, cam.dpr);

    // Header stats
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.fillStyle = P.ui.textBright;
    ctx.fillText(`LEVEL ${pilot.level}`, 24, 84);
    ctx.fillStyle = '#44cccc';
    ctx.fillText(`SKILL POINTS: ${pilot.skillPoints}`, 130, 84);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffcc44';
    ctx.fillText(`$ ${career.dollars}`, w - 24, 84);
    ctx.textAlign = 'left';

    // XP bar (thresholds are cumulative: need = total for next level)
    const need = xpToNext(pilot.level + 1);
    const frac = need === Infinity ? 1 : clamp(pilot.xp / need, 0, 1);
    ctx.fillStyle = 'rgba(10,16,10,0.9)';
    ctx.fillRect(24, 104, w - 48, 8);
    ctx.fillStyle = '#cc8833';
    ctx.fillRect(24, 104, (w - 48) * frac, 8);
    ctx.strokeStyle = 'rgba(90,140,80,0.7)';
    ctx.strokeRect(23.5, 103.5, w - 47, 9);
    ctx.font = '9px "Courier New", monospace';
    ctx.fillStyle = P.ui.textDim;
    ctx.fillText(need === Infinity ? 'MAX LEVEL' : `XP ${pilot.xp} / ${need} TO LV ${pilot.level + 1}`, 24, 116);

    // ── Skill grid: 5 columns × 6 nodes ──
    pilotNodeBoxes = [];
    const gridTop = 150;
    const colW = Math.min(150, (w - 48) / 5);
    const gridW = colW * 5;
    const gridX = (w - gridW) / 2;
    const nodeR = Math.max(10, Math.min(14, colW * 0.11));
    const rowH = Math.min(52, (h - gridTop - 130) / 6);

    // Column titles
    for (let b = 0; b < 5; b++) {
      ctx.font = 'bold 8px "Courier New", monospace';
      ctx.fillStyle = P.ui.textDim;
      ctx.textAlign = 'center';
      ctx.fillText(BRANCH_NAMES[b], gridX + colW * b + colW / 2, gridTop - 10);
    }

    for (const node of SKILL_GRID) {
      const cx = gridX + colW * node.branch + colW / 2;
      const cy = gridTop + node.tier * rowH * 2 + rowH; // 2-row ladder per branch
      const owned = pilot.allocated.includes(node.id);
      const available = !owned && canAllocate(pilot.allocated, node.id);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.beginPath();
      ctx.arc(0, 0, nodeR, 0, Math.PI * 2);
      ctx.fillStyle = owned ? 'rgba(170,255,136,0.9)'
        : available ? 'rgba(20,50,20,0.9)'
        : 'rgba(10,14,10,0.9)';
      ctx.fill();
      ctx.strokeStyle = owned ? '#aaff88' : available ? '#66aa66' : 'rgba(70,90,70,0.4)';
      ctx.lineWidth = owned ? 2 : 1;
      ctx.stroke();
      if (available && !owned) {
        ctx.strokeStyle = 'rgba(170,255,136,0.35)';
        ctx.beginPath();
        ctx.arc(0, 0, nodeR - 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      // Ladder links within branch
      if (node.tier % 3 !== 2) {
        const nextTierSameRow = node.tier % 3 < 2;
        const nb = gridNeighbors(node.id);
        for (const n of nb) {
          const other = SKILL_GRID.find(x => x.id === n);
          if (!other || other.branch !== node.branch) continue;
          const linkDown = other.tier === node.tier + 3 || (other.tier % 3 === node.tier % 3 && other.tier > node.tier);
          if (!linkDown && !(other.tier % 3 === node.tier % 3)) continue;
          if (other.tier < node.tier) continue;
          const ox = gridX + colW * other.branch + colW / 2;
          const oy = gridTop + other.tier * rowH * 2 + rowH;
          const linked = pilot.allocated.includes(node.id) && pilot.allocated.includes(other.id);
          ctx.strokeStyle = linked ? 'rgba(170,255,136,0.8)' : 'rgba(70,90,70,0.35)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(ox, oy);
          ctx.stroke();
          break; // one forward link is enough per node
        }
        void nextTierSameRow;
      }
      pilotNodeBoxes.push({ x: cx - nodeR - 4, y: cy - nodeR - 4, w: nodeR * 2 + 8, h: nodeR * 2 + 8, id: node.id, cx, cy, r: nodeR });
    }

    // Info bar (last-touched node)
    const info = pilotInfoSelection ? SKILL_GRID.find(n => n.id === pilotInfoSelection) : null;
    const infoY = h - 96;
    ctx.fillStyle = 'rgba(6,12,6,0.75)';
    ctx.fillRect(16, infoY, w - 32, 40);
    ctx.strokeStyle = 'rgba(90,140,80,0.5)';
    ctx.strokeRect(16.5, infoY + 0.5, w - 33, 39);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.fillStyle = P.ui.textBright;
    if (info) {
      const owned = pilot.allocated.includes(info.id);
      ctx.fillText(`${info.name}${owned ? ' — OWNED' : ''}`, 26, infoY + 6);
      ctx.font = '9px "Courier New", monospace';
      ctx.fillStyle = P.ui.text;
      ctx.fillText(info.desc, 26, infoY + 22);
    } else {
      ctx.fillStyle = P.ui.textDim;
      ctx.fillText('TAP A NODE: filled = owned · bright ring = available', 26, infoY + 6);
    }

    // Respec button
    if (pilot.allocated.length > 0 && pilot.skillPoints >= 0) {
      const rw = 120, rh = 26;
      const rx = w - rw - 16, ry = h - 60;
      ctx.fillStyle = 'rgba(204,136,51,0.12)';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = '#cc8833';
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.fillStyle = '#ffcc66';
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('FREE RESPEC', rx + rw / 2, ry + rh / 2);
      pilotRespecBox = { x: rx, y: ry, w: rw, h: rh };
    } else {
      pilotRespecBox = null;
    }

    // Back
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = P.ui.textDim;
    ctx.fillText('◂ BACK', 40, h - 30);
    pilotBackBox = { x: 12, y: h - 52, w: 80, h: 30 };

    drawCornerBrackets(ctx, 8, 8, w - 16, h - 16, 'rgba(90,140,80,0.5)', 22, 2);
    ctx.restore();
  },
};

export let pilotBackBox = null;

// ── Shared background shim (avoids importing app.js) ──
function drawScreenBackgroundShim(ctx, cam, title, subtitle = '') {
  const w = cam.screenW, h = cam.screenH;
  ctx.save(); ctx.scale(cam.dpr, cam.dpr);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#0a120a');
  grad.addColorStop(1, '#16240f');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(90,140,80,0.07)';
  ctx.lineWidth = 1;
  const step = 48;
  ctx.beginPath();
  for (let x = (w % step) / 2; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = (h % step) / 2; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillStyle = P.ui.textBright;
  ctx.font = 'bold 22px "Courier New", monospace';
  ctx.fillText(title, w / 2, 24);
  const tw = ctx.measureText(title).width;
  ctx.strokeStyle = P.ui.borderHi;
  ctx.beginPath();
  ctx.moveTo(w / 2 - tw / 2 - 18, 50);
  ctx.lineTo(w / 2 + tw / 2 + 18, 50);
  ctx.stroke();
  if (subtitle) {
    ctx.fillStyle = P.ui.textDim;
    ctx.font = '10px "Courier New", monospace';
    ctx.fillText(subtitle, w / 2, 56);
  }
  drawCornerBrackets(ctx, 8, 8, w - 16, h - 16, 'rgba(90,140,80,0.5)', 22, 2);
  ctx.restore();
}

// ── Click resolution (called by app.js) ───────────────────────────────────
// Returns true if the click was consumed by a meta screen.
export function handleHangarClick(px, py, dpr) {
  const career = metaState.career;
  if (!career) return false;
  for (const box of hangarBuyBoxes) {
    if (px >= box.x * dpr && px <= (box.x + box.w) * dpr &&
        py >= box.y * dpr && py <= (box.y + box.h) * dpr) {
      if (box.slot === '__back') return 'back';
      const res = buyHangarLevel(career, box.slot);
      if (!res.ok && res.reason === 'INSUFFICIENT FUNDS') {
        // Brief flash feedback is drawn by the plate itself next frame.
      }
      return true;
    }
  }
  return false;
}

export function handlePilotClick(px, py, dpr) {
  const career = metaState.career;
  if (!career) return false;
  if (pilotRespecBox &&
      px >= pilotRespecBox.x * dpr && px <= (pilotRespecBox.x + pilotRespecBox.w) * dpr &&
      py >= pilotRespecBox.y * dpr && py <= (pilotRespecBox.y + pilotRespecBox.h) * dpr) {
    respecSkills(career);
    return true;
  }
  if (pilotBackBox &&
      px >= pilotBackBox.x * dpr && px <= (pilotBackBox.x + pilotBackBox.w) * dpr &&
      py >= pilotBackBox.y * dpr && py <= (pilotBackBox.y + pilotBackBox.h) * dpr) {
    return 'back';
  }
  for (const box of pilotNodeBoxes) {
    if (px >= box.x * dpr && px <= (box.x + box.w) * dpr &&
        py >= box.y * dpr && py <= (box.y + box.h) * dpr) {
      pilotInfoSelection = box.id;
      allocateSkill(career, box.id);
      return true;
    }
  }
  return false;
}

export { saveCareer, clamp };
