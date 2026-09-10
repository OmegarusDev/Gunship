/**
 * screens_meta.js — HANGAR + PILOT RECORD screens.
 * Canvas screens registered by app.js. Reads career via metaState.
 */

import { P } from './palette.js';
import {
  applyMenuHitTransform,
  drawBackButton,
  drawMenuButton,
  paintScreenBackdrop,
  menuHit,
} from './appBridge.js';
import { drawGunship } from './render/gunships.js';
import {
  metaState,
  GUNSHIPS,
  GUNSHIP_ORDER,
  HANGAR_SLOTS,
  gunshipDef,
  selectGunship,
  syncGunshipUnlocks,
  SKILL_GRID,
  gridNeighbors,
  canAllocate,
  buyHangarLevel,
  allocateSkill,
  respecSkills,
  saveCareer,
  xpToNext,
  clamp,
} from './meta.js';

// Click zones published each draw; app.js consults these in its handler.
export let hangarBuyBoxes = [];
export let pilotNodeBoxes = [];
export let pilotRespecBox = null;

const BRANCH_NAMES = ['MARKSMAN', 'PILOT', 'RECON', 'THRUST', 'FORTITUDE'];
const AIRFRAME_LABELS = {
  cobra: 'COBRA',
  supercobra: 'SUPERCOBRA',
  apache: 'APACHE',
  longbow: 'LONGBOW',
  dap: 'DAP',
  comanche: 'COMANCHE',
};
const AIRFRAME_UNLOCK_LABELS = {
  start: 'READY',
  act_2: 'ACT 2',
  act_3: 'ACT 3',
  act_4: 'ACT 4',
  campaign: 'CAMPAIGN',
  prestige: 'PRESTIGE',
};

function careerOrEmpty() {
  if (metaState.career) return syncGunshipUnlocks(metaState.career);
  return {
    pilot: {
      name: '—',
      level: 1,
      xp: 0,
      skillPoints: 0,
      allocated: [],
      stats: { accuracy: 1, control: 1, awareness: 1, speed: 1, grit: 1 },
    },
    dollars: 0,
    hangar: { cobra: {} },
    unlocked: ['cobra'],
    gunship: 'cobra',
  };
}

// ═════════════════════════════════════════════════════════════
//  HANGAR
// ═════════════════════════════════════════════════════════════

export const hangarScreen = {
  draw(ctx, cam) {
    const w = cam.screenW,
      h = cam.screenH;
    const career = careerOrEmpty();
    ctx.save();
    ctx.scale(cam.dpr, cam.dpr);
    const L = paintScreenBackdrop(
      ctx,
      w,
      h,
      'HANGAR',
      `${gunshipDef(career.gunship).name.toUpperCase()} — PERMANENT UPGRADES`
    );

    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 16px "Courier New", monospace';
    ctx.fillStyle = '#ffcc44';
    ctx.fillText(`$ ${career.dollars}`, L.content.x + L.content.w, (L.headerMetaY || 20) + 2);

    hangarBuyBoxes = [];
    const selectorGap = L.btnGap;
    const selectorCols = L.content.w >= 720 ? 6 : L.content.w >= 280 ? 3 : 2;
    const selectorRows = Math.ceil(GUNSHIP_ORDER.length / selectorCols);
    const selectorCardH = selectorCols === 6 ? 76 : 64;
    const selectorH = selectorRows * selectorCardH + selectorGap * (selectorRows - 1);
    const selectorW = (L.content.w - selectorGap * (selectorCols - 1)) / selectorCols;

    for (let i = 0; i < GUNSHIP_ORDER.length; i++) {
      const id = GUNSHIP_ORDER[i];
      const def = GUNSHIPS[id];
      const unlocked = career.unlocked.includes(id);
      const selected = career.gunship === id;
      const col = i % selectorCols;
      const row = Math.floor(i / selectorCols);
      const rect = {
        x: L.content.x + col * (selectorW + selectorGap),
        y: L.content.y + row * (selectorCardH + selectorGap),
        w: selectorW,
        h: selectorCardH,
      };
      ctx.save();
      const hit = applyMenuHitTransform(ctx, rect, { disabled: !unlocked });
      ctx.fillStyle = selected
        ? 'rgba(70,110,48,0.96)'
        : unlocked
          ? hit.hover
            ? 'rgba(36,68,28,0.94)'
            : 'rgba(20,40,16,0.88)'
          : 'rgba(10,16,10,0.72)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = selected
        ? P.ui.textBright
        : unlocked
          ? hit.hover
            ? P.ui.borderHi
            : P.ui.border
          : 'rgba(70,90,70,0.4)';
      ctx.lineWidth = selected || hit.hover ? 1.7 : 1.1;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

      if (unlocked) {
        drawGunship(ctx, {
          x: rect.x + rect.w / 2,
          y: rect.y + rect.h * 0.42,
          angle: 0,
          bladeAngle: 0.45,
          gunshipId: id,
          rotorBlades: def.rotorBlades,
          airframeScale: def.size,
          drawScale: Math.min(1.35, Math.max(0.85, selectorW / 62)),
          hideRotor: true,
        });
      } else {
        ctx.fillStyle = 'rgba(120,140,110,0.48)';
        ctx.font = 'bold 12px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('LOCKED', rect.x + rect.w / 2, rect.y + rect.h * 0.42);
      }

      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = selected ? P.ui.textBright : unlocked ? P.ui.text : P.ui.textDim;
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.fillText(AIRFRAME_LABELS[id], rect.x + rect.w / 2, rect.y + rect.h - 17);
      ctx.font = '9px "Courier New", monospace';
      ctx.fillStyle = selected ? '#ffcc44' : unlocked ? P.ui.textDim : 'rgba(120,140,110,0.55)';
      ctx.fillText(
        selected
          ? 'ACTIVE'
          : unlocked
            ? `${def.year}`
            : AIRFRAME_UNLOCK_LABELS[def.unlock] || 'LOCKED',
        rect.x + rect.w / 2,
        rect.y + rect.h - 5
      );
      ctx.restore();
      if (unlocked) hangarBuyBoxes.push({ ...rect, airframe: id });
    }

    const slotIds = Object.keys(HANGAR_SLOTS);
    const cols = L.landscape && L.content.w >= 640 ? 2 : 1;
    const rows = Math.ceil(slotIds.length / cols);
    const gap = L.btnGap;
    const upgradeTop = L.content.y + selectorH + gap;
    const upgradeH = Math.max(80, L.content.h - selectorH - gap);
    const rowH = Math.min(88, Math.max(60, (upgradeH - gap * (rows - 1)) / rows));
    const colW = (L.content.w - gap * (cols - 1)) / cols;
    for (let i = 0; i < slotIds.length; i++) {
      const slot = slotIds[i];
      const def = HANGAR_SLOTS[slot];
      const lvl = career.hangar[career.gunship]?.[slot] || 0;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const bx = L.content.x + col * (colW + gap);
      const by = upgradeTop + row * (rowH + gap);
      const bw = colW;
      const maxed = lvl >= 2;
      const cost = maxed ? 0 : def.levels[lvl].cost;
      const affordable = !maxed && career.dollars >= cost;

      ctx.fillStyle = 'rgba(13,33,15,0.9)';
      ctx.fillRect(bx, by, bw, rowH);
      ctx.strokeStyle = maxed ? 'rgba(63,127,63,0.7)' : affordable ? P.ui.borderHi : P.ui.border;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(bx, by, bw, rowH);

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = 'bold 14px "Courier New", monospace';
      ctx.fillStyle = P.ui.textBright;
      ctx.fillText(def.name, bx + 14, by + 10);
      for (let p = 0; p < 2; p++) {
        ctx.fillStyle = p < lvl ? '#aaff88' : 'rgba(90,140,80,0.35)';
        ctx.fillRect(bx + 14 + p * 16, by + 32, 12, 6);
      }
      ctx.font = '11px "Courier New", monospace';
      ctx.fillStyle = P.ui.textDim;
      ctx.fillText(maxed ? def.levels[1].desc : def.levels[lvl].desc, bx + 48, by + 30);
      if (!maxed) {
        const bwid = Math.min(132, Math.max(110, bw * 0.28));
        const bh = Math.min(44, rowH - 16);
        const bxz = bx + bw - bwid - 12;
        const byz = by + (rowH - bh) / 2;
        const buyRect = { x: bxz, y: byz, w: bwid, h: bh };
        drawMenuButton(ctx, buyRect, {
          label: affordable ? `BUY  $${cost}` : `$${cost}`,
          kind: affordable ? 'accent' : 'menu',
          disabled: !affordable,
        });
        hangarBuyBoxes.push({ ...buyRect, slot });
        ctx.textAlign = 'left';
      } else {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#3f7f3f';
        ctx.font = 'bold 12px "Courier New", monospace';
        ctx.fillText('MAXED', bx + bw - 56, by + rowH / 2 - 6);
        ctx.textAlign = 'left';
      }
    }

    const backRect = drawBackButton(ctx, w, h);
    hangarBuyBoxes.push({
      x: backRect.x,
      y: backRect.y,
      w: backRect.w,
      h: backRect.h,
      slot: '__back',
    });
    ctx.restore();
  },
};

// ═════════════════════════════════════════════════════════════
//  PILOT RECORD
// ═════════════════════════════════════════════════════════════

let pilotInfoSelection = null; // last-touched node for the info bar

export const pilotScreen = {
  draw(ctx, cam) {
    const w = cam.screenW,
      h = cam.screenH;
    const career = careerOrEmpty();
    const pilot = career.pilot;
    ctx.save();
    ctx.scale(cam.dpr, cam.dpr);
    const L = paintScreenBackdrop(ctx, w, h, 'SKILLS', pilot.name);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 13px "Courier New", monospace';
    ctx.fillStyle = P.ui.textBright;
    ctx.fillText(`LEVEL ${pilot.level}`, L.content.x, L.content.y + 4);
    ctx.fillStyle = '#44cccc';
    ctx.fillText(`SKILL POINTS: ${pilot.skillPoints}`, L.content.x + 128, L.content.y + 4);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffcc44';
    ctx.fillText(`$ ${career.dollars}`, L.content.x + L.content.w, (L.headerMetaY || 20) + 2);
    ctx.textAlign = 'left';

    const need = xpToNext(pilot.level + 1);
    const frac = need === Infinity ? 1 : clamp(pilot.xp / need, 0, 1);
    ctx.fillStyle = 'rgba(10,16,10,0.9)';
    ctx.fillRect(L.content.x, L.content.y + 22, L.content.w, 10);
    ctx.fillStyle = '#cc8833';
    ctx.fillRect(L.content.x, L.content.y + 22, L.content.w * frac, 10);
    ctx.strokeStyle = 'rgba(90,140,80,0.7)';
    ctx.strokeRect(L.content.x - 0.5, L.content.y + 21.5, L.content.w + 1, 11);
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = P.ui.textDim;
    ctx.fillText(
      need === Infinity ? 'MAX LEVEL' : `XP ${pilot.xp} / ${need} TO LV ${pilot.level + 1}`,
      L.content.x,
      L.content.y + 36
    );

    const infoH = 56;
    const gridTop = L.content.y + 64;
    const gridBottom = L.content.y + L.content.h - infoH - 8;
    pilotNodeBoxes = [];
    const colW = Math.min(150, L.content.w / 5);
    const gridW = colW * 5;
    const gridX = L.content.x + (L.content.w - gridW) / 2;
    const nodeR = Math.max(14, Math.min(18, colW * 0.16));
    const gridH = Math.min(gridBottom - gridTop, 380);
    const rowH = Math.min(36, Math.max(24, gridH / 12));

    // Column titles
    for (let b = 0; b < 5; b++) {
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.fillStyle = P.ui.textDim;
      ctx.textAlign = 'center';
      ctx.fillText(BRANCH_NAMES[b], gridX + colW * b + colW / 2, gridTop - 10);
    }

    for (const node of SKILL_GRID) {
      const cx = gridX + colW * node.branch + colW / 2;
      const cy = gridTop + node.tier * rowH * 2 + rowH; // 2-row ladder per branch
      const owned = pilot.allocated.includes(node.id);
      const available = !owned && canAllocate(pilot.allocated, node.id);
      const nodeBox = {
        x: cx - nodeR - 6,
        y: cy - nodeR - 6,
        w: nodeR * 2 + 12,
        h: nodeR * 2 + 12,
      };
      const nodeHit = menuHit(nodeBox);
      ctx.save();
      ctx.translate(cx, cy);
      if (nodeHit.scale !== 1) ctx.scale(nodeHit.scale, nodeHit.scale);
      ctx.beginPath();
      ctx.arc(0, 0, nodeR, 0, Math.PI * 2);
      ctx.fillStyle = owned
        ? 'rgba(170,255,136,0.9)'
        : available
          ? 'rgba(20,50,20,0.9)'
          : 'rgba(10,14,10,0.9)';
      ctx.fill();
      ctx.strokeStyle = nodeHit.hover
        ? '#d8ffb0'
        : owned
          ? '#aaff88'
          : available
            ? '#66aa66'
            : 'rgba(70,90,70,0.4)';
      ctx.lineWidth = owned || nodeHit.hover ? 2 : 1;
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
          const other = SKILL_GRID.find((x) => x.id === n);
          if (!other || other.branch !== node.branch) continue;
          const linkDown =
            other.tier === node.tier + 3 ||
            (other.tier % 3 === node.tier % 3 && other.tier > node.tier);
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
      pilotNodeBoxes.push({
        x: cx - nodeR - 4,
        y: cy - nodeR - 4,
        w: nodeR * 2 + 8,
        h: nodeR * 2 + 8,
        id: node.id,
        cx,
        cy,
        r: nodeR,
      });
    }

    const hit = Math.max(44, nodeR * 2 + 12);
    for (const box of pilotNodeBoxes) {
      box.x = box.cx - hit / 2;
      box.y = box.cy - hit / 2;
      box.w = hit;
      box.h = hit;
    }

    const info = pilotInfoSelection ? SKILL_GRID.find((n) => n.id === pilotInfoSelection) : null;
    const infoY = gridBottom;
    ctx.fillStyle = 'rgba(6,12,6,0.75)';
    ctx.fillRect(L.content.x, infoY, L.content.w, infoH);
    ctx.strokeStyle = 'rgba(90,140,80,0.5)';
    ctx.strokeRect(L.content.x + 0.5, infoY + 0.5, L.content.w - 1, infoH - 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.fillStyle = P.ui.textBright;
    if (info) {
      const owned = pilot.allocated.includes(info.id);
      ctx.fillText(`${info.name}${owned ? ' — OWNED' : ''}`, L.content.x + 12, infoY + 8);
      ctx.font = '11px "Courier New", monospace';
      ctx.fillStyle = P.ui.text;
      ctx.fillText(info.desc, L.content.x + 12, infoY + 28);
    } else {
      ctx.fillStyle = P.ui.textDim;
      ctx.fillText(
        'TAP A NODE: filled = owned · bright ring = available',
        L.content.x + 12,
        infoY + 16
      );
    }

    if (pilot.allocated.length > 0 && pilot.skillPoints >= 0) {
      const pair = {
        back: {
          x: L.content.x,
          y: L.h - L.footerH + L.pad * 0.35,
          w: Math.min(168, L.content.w * 0.42),
          h: L.btnH,
        },
        respec: {
          x: L.content.x + L.content.w - Math.min(180, L.content.w * 0.42),
          y: L.h - L.footerH + L.pad * 0.35,
          w: Math.min(180, L.content.w * 0.42),
          h: L.btnH,
        },
      };
      drawMenuButton(ctx, pair.back, { label: '◂ BACK' });
      drawMenuButton(ctx, pair.respec, { label: 'FREE RESPEC', kind: 'accent' });
      pilotBackBox = pair.back;
      pilotRespecBox = pair.respec;
    } else {
      pilotRespecBox = null;
      pilotBackBox = drawBackButton(ctx, w, h);
    }
    ctx.restore();
  },
};

export let pilotBackBox = null;

// ── Click resolution (called by app.js) ───────────────────────────────────
// Returns true if the click was consumed by a meta screen.
export function handleHangarClick(px, py, dpr) {
  const career = metaState.career;
  if (!career) return false;
  for (const box of hangarBuyBoxes) {
    if (
      px >= box.x * dpr &&
      px <= (box.x + box.w) * dpr &&
      py >= box.y * dpr &&
      py <= (box.y + box.h) * dpr
    ) {
      if (box.slot === '__back') return 'back';
      if (box.airframe) {
        selectGunship(career, box.airframe);
        return true;
      }
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
  if (
    pilotRespecBox &&
    px >= pilotRespecBox.x * dpr &&
    px <= (pilotRespecBox.x + pilotRespecBox.w) * dpr &&
    py >= pilotRespecBox.y * dpr &&
    py <= (pilotRespecBox.y + pilotRespecBox.h) * dpr
  ) {
    respecSkills(career);
    return true;
  }
  if (
    pilotBackBox &&
    px >= pilotBackBox.x * dpr &&
    px <= (pilotBackBox.x + pilotBackBox.w) * dpr &&
    py >= pilotBackBox.y * dpr &&
    py <= (pilotBackBox.y + pilotBackBox.h) * dpr
  ) {
    return 'back';
  }
  for (const box of pilotNodeBoxes) {
    if (
      px >= box.x * dpr &&
      px <= (box.x + box.w) * dpr &&
      py >= box.y * dpr &&
      py <= (box.y + box.h) * dpr
    ) {
      pilotInfoSelection = box.id;
      allocateSkill(career, box.id);
      return true;
    }
  }
  return false;
}

export { saveCareer, clamp };
