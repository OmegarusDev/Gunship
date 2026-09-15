/**
 * screens_meta.js — HANGAR + PILOT RECORD screens.
 * Canvas screens registered by app.js. Reads career via metaState.
 */

import { P } from './palette.js';
import {
  applyMenuHitTransform,
  drawMenuButton,
  paintScreenBackdrop,
  menuHit,
  menuPointerPos,
  drawCornerBrackets,
  drawHeaderDollars,
  drawCursorTooltip,
  footerNavRects,
} from './appBridge.js';
import { drawGunship } from './render/gunships.js';
import { drawEnemy } from './render/entities.js';
import { HANGAR_HOUR } from './sun.js';
import { ENEMY_CLASSES } from './data/enemyClasses.js';
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

const ENEMY_CLASS_ORDER = [
  'rifleman',
  'assault',
  'mg',
  'rpg',
  'manpads',
  'unarmed',
  'lightAA',
  'shilka',
  'sam',
  'technical',
  'apc',
  'tank',
];

const ENEMY_CLASS_LABELS = {
  unarmed: 'CIVILIAN',
  rifleman: 'RIFLEMAN',
  assault: 'ASSAULT',
  mg: 'GUNNER',
  rpg: 'RPG',
  manpads: 'MANPADS',
  lightAA: 'LIGHT AA',
  shilka: 'SHILKA',
  tank: 'TANK',
  apc: 'APC',
  sam: 'SAM',
  technical: 'TECHNICAL',
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

let hangarTime = 0;
let hangarPinnedTip = null;

function finePointerHover() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

function fillHangarFrame(ctx, r) {
  ctx.fillStyle = 'rgba(8,16,10,0.92)';
  ctx.fillRect(r.x, r.y, r.w, r.h);
}

function strokeHangarFrame(ctx, r) {
  ctx.strokeStyle = P.ui.border;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  drawCornerBrackets(ctx, r.x, r.y, r.w, r.h, P.ui.borderHi, 14, 1.6);
}

function drawSectionCaption(ctx, x, y, w, text) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 10px "Courier New", monospace';
  ctx.fillStyle = P.ui.textDim;
  ctx.fillText(text, x, y);
  const tw = ctx.measureText(text).width;
  ctx.strokeStyle = 'rgba(90,140,80,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + tw + 10, y + 6);
  ctx.lineTo(x + w, y + 6);
  ctx.stroke();
}

function drawHangarBay(ctx, bay, career) {
  fillHangarFrame(ctx, bay);
  const plateH = 40;
  const def = gunshipDef(career.gunship);
  ctx.save();
  ctx.beginPath();
  ctx.rect(bay.x + 2, bay.y + 2, bay.w - 4, bay.h - plateH - 1);
  ctx.clip();
  drawGunship(ctx, {
    x: bay.x + bay.w * 0.5 + 38,
    y: bay.y + (bay.h - plateH) * 0.5 - 10,
    angle: 0,
    bank: 0,
    bladeAngle: hangarTime * 9,
    gunshipId: career.gunship,
    rotorBlades: def.rotorBlades,
    airframeScale: def.size,
    drawScale: Math.min(4.2, Math.max(2.1, Math.min(bay.w, bay.h) / 52)),
    hideRotor: false,
    hour: HANGAR_HOUR,
  });
  ctx.restore();

  ctx.fillStyle = 'rgba(6,12,6,0.94)';
  ctx.fillRect(bay.x + 1, bay.y + bay.h - plateH, bay.w - 2, plateH - 1);
  ctx.strokeStyle = 'rgba(90,140,80,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bay.x + 12, bay.y + bay.h - plateH + 0.5);
  ctx.lineTo(bay.x + bay.w - 12, bay.y + bay.h - plateH + 0.5);
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = P.ui.textDim;
  ctx.font = 'bold 10px "Courier New", monospace';
  ctx.fillText('BAY  ·  STAND-IN PROFILE', bay.x + 14, bay.y + bay.h - plateH + 8);
  ctx.fillStyle = P.ui.textBright;
  ctx.font = 'bold 13px "Courier New", monospace';
  ctx.fillText(def.name.toUpperCase(), bay.x + 14, bay.y + bay.h - 20);

  strokeHangarFrame(ctx, bay);
}

function drawHangarSelector(ctx, area, career, gap) {
  fillHangarFrame(ctx, area);
  const pad = 12;
  drawSectionCaption(ctx, area.x + pad, area.y + 10, area.w - pad * 2, 'AIRFRAMES');
  const gridY = area.y + 28;
  const gridH = area.h - 28 - pad;
  const cols = 3;
  const rows = 2;
  const cardW = (area.w - pad * 2 - gap * (cols - 1)) / cols;
  const cardH = (gridH - gap * (rows - 1)) / rows;
  const labelH = 26;
  for (let i = 0; i < GUNSHIP_ORDER.length; i++) {
    const id = GUNSHIP_ORDER[i];
    const def = GUNSHIPS[id];
    const unlocked = career.unlocked.includes(id);
    const selected = career.gunship === id;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const rect = {
      x: area.x + pad + col * (cardW + gap),
      y: gridY + row * (cardH + gap),
      w: cardW,
      h: cardH,
    };
    ctx.save();
    const hit = applyMenuHitTransform(ctx, rect, { disabled: !unlocked, quiet: true });
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
    ctx.lineWidth = selected || hit.hover ? 1.5 : 1;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x + 1, rect.y + 1, rect.w - 2, Math.max(8, rect.h - labelH - 1));
    ctx.clip();
    if (unlocked) {
      drawGunship(ctx, {
        x: rect.x + rect.w / 2,
        y: rect.y + (rect.h - labelH) * 0.52,
        angle: 0,
        bank: 0,
        bladeAngle: 0.45,
        gunshipId: id,
        rotorBlades: def.rotorBlades,
        airframeScale: def.size,
        drawScale: Math.min(1.25, Math.max(0.8, cardW / 68)),
        hideRotor: true,
        hour: HANGAR_HOUR,
      });
    } else {
      ctx.fillStyle = 'rgba(120,140,110,0.48)';
      ctx.font = 'bold 11px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('LOCKED', rect.x + rect.w / 2, rect.y + (rect.h - labelH) * 0.5);
    }
    ctx.restore();

    ctx.fillStyle = 'rgba(6,12,6,0.9)';
    ctx.fillRect(rect.x + 1, rect.y + rect.h - labelH, rect.w - 2, labelH - 1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = selected ? P.ui.textBright : unlocked ? P.ui.text : P.ui.textDim;
    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.fillText(AIRFRAME_LABELS[id], rect.x + rect.w / 2, rect.y + rect.h - labelH + 4);
    ctx.font = '9px "Courier New", monospace';
    ctx.fillStyle = selected ? '#ffcc44' : unlocked ? P.ui.textDim : 'rgba(120,140,110,0.55)';
    ctx.fillText(
      selected
        ? 'ACTIVE'
        : unlocked
          ? `${def.year}`
          : AIRFRAME_UNLOCK_LABELS[def.unlock] || 'LOCKED',
      rect.x + rect.w / 2,
      rect.y + rect.h - 12
    );
    ctx.restore();
    if (unlocked) hangarBuyBoxes.push({ ...rect, kind: 'airframe', airframe: id });
  }
  strokeHangarFrame(ctx, area);
}

function pointerInRect(pointer, rect) {
  return (
    pointer.inside &&
    pointer.x >= rect.x &&
    pointer.x <= rect.x + rect.w &&
    pointer.y >= rect.y &&
    pointer.y <= rect.y + rect.h
  );
}

function drawHangarUpgrades(ctx, area, career, gap) {
  fillHangarFrame(ctx, area);
  const pad = 12;
  drawSectionCaption(ctx, area.x + pad, area.y + 8, area.w - pad * 2, 'UPGRADES');
  const gridY = area.y + 24;
  const gridH = Math.max(80, area.h - 24 - pad);
  const slotIds = Object.keys(HANGAR_SLOTS);
  const cols = 2;
  const rows = Math.ceil(slotIds.length / cols);
  const rowH = Math.min(64, Math.max(56, (gridH - gap * (rows - 1)) / rows));
  const colW = (area.w - pad * 2 - gap * (cols - 1)) / cols;
  let hoverTip = null;
  const pointer = menuPointerPos();
  const hoverOk = finePointerHover();

  ctx.save();
  ctx.beginPath();
  ctx.rect(area.x + 2, area.y + 2, area.w - 4, area.h - 4);
  ctx.clip();

  for (let i = 0; i < slotIds.length; i++) {
    const slot = slotIds[i];
    const def = HANGAR_SLOTS[slot];
    const lvl = career.hangar[career.gunship]?.[slot] || 0;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const bx = area.x + pad + col * (colW + gap);
    const by = gridY + row * (rowH + gap);
    const bw = colW;
    const maxed = lvl >= 2;
    const cost = maxed ? 0 : def.levels[lvl].cost;
    const affordable = !maxed && career.dollars >= cost;
    const desc = maxed ? def.levels[1].desc : def.levels[lvl].desc;
    const card = { x: bx, y: by, w: bw, h: rowH };

    let buyRect = null;
    if (!maxed) {
      const bwid = Math.min(102, Math.max(84, bw * 0.32));
      const bh = Math.min(32, rowH - 20);
      buyRect = { x: bx + bw - bwid - 10, y: by + (rowH - bh) / 2, w: bwid, h: bh };
    }
    const inspectRect = {
      x: bx,
      y: by,
      w: buyRect ? Math.max(48, buyRect.x - bx) : bw,
      h: rowH,
    };

    const overCard = pointerInRect(pointer, card);
    ctx.fillStyle = overCard ? 'rgba(20,48,18,0.94)' : 'rgba(13,33,15,0.9)';
    ctx.fillRect(bx, by, bw, rowH);
    ctx.strokeStyle = maxed ? 'rgba(90,140,80,0.7)' : affordable ? P.ui.borderHi : P.ui.border;
    ctx.lineWidth = overCard ? 1.4 : 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, rowH - 1);

    ctx.save();
    ctx.beginPath();
    ctx.rect(bx + 8, by + 4, inspectRect.w - 10, rowH - 8);
    ctx.clip();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.fillStyle = P.ui.textBright;
    ctx.fillText(def.name, bx + 12, by + rowH * 0.38);
    for (let p = 0; p < 2; p++) {
      ctx.fillStyle = p < lvl ? '#aaff88' : 'rgba(90,140,80,0.35)';
      ctx.fillRect(bx + 12 + p * 14, by + rowH * 0.62, 11, 6);
    }
    ctx.font = '9px "Courier New", monospace';
    ctx.fillStyle = P.ui.textDim;
    ctx.fillText(`${lvl}/2`, bx + 46, by + rowH * 0.62 + 3);
    ctx.restore();

    if (buyRect) {
      drawMenuButton(ctx, buyRect, {
        label: affordable ? `BUY  $${cost}` : `$${cost}`,
        kind: affordable ? 'accent' : 'menu',
        disabled: !affordable,
        compact: true,
      });
      hangarBuyBoxes.push({ ...buyRect, kind: 'buy', slot });
    } else {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#3f7f3f';
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.fillText('MAXED', bx + bw - 12, by + rowH / 2);
    }

    hangarBuyBoxes.push({ ...inspectRect, kind: 'inspect', inspect: slot, tip: desc });
    menuHit(inspectRect, { quiet: true });
    if (hoverOk && overCard) {
      hoverTip = { text: desc, x: pointer.x, y: pointer.y };
    }
  }
  ctx.restore();
  strokeHangarFrame(ctx, area);
  return hoverTip;
}

export const hangarScreen = {
  enter() {
    hangarPinnedTip = null;
  },
  draw(ctx, cam, dt = 0) {
    hangarTime += dt || 0;
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

    drawHeaderDollars(ctx, L, career.dollars);

    hangarBuyBoxes = [];
    const gap = L.btnGap;
    const split = L.landscape && L.content.w >= 640;
    const upgradePanelH = 24 + 12 + 3 * 64 + 2 * gap + 12;
    let bay;
    let selector;
    let upgrades;
    if (split) {
      const bayW = L.content.w * 0.42;
      bay = { x: L.content.x, y: L.content.y, w: bayW, h: L.content.h };
      const rightX = L.content.x + bayW + gap;
      const rightW = L.content.w - bayW - gap;
      const selH = Math.min(220, Math.max(168, L.content.h * 0.34));
      selector = { x: rightX, y: L.content.y, w: rightW, h: selH };
      upgrades = {
        x: rightX,
        y: L.content.y + selH + gap,
        w: rightW,
        h: Math.min(L.content.h - selH - gap, upgradePanelH),
      };
    } else {
      const bayH = L.content.h * 0.38;
      bay = { x: L.content.x, y: L.content.y, w: L.content.w, h: bayH };
      const remain = L.content.h - bayH - gap;
      const selH = Math.min(176, Math.max(132, remain * 0.44));
      selector = { x: L.content.x, y: L.content.y + bayH + gap, w: L.content.w, h: selH };
      const leftover = L.content.y + L.content.h - (selector.y + selH + gap);
      upgrades = {
        x: L.content.x,
        y: selector.y + selH + gap,
        w: L.content.w,
        h: Math.max(80, Math.min(leftover, upgradePanelH)),
      };
    }

    drawHangarBay(ctx, bay, career);
    drawHangarSelector(ctx, selector, career, gap);
    const hoverTip = drawHangarUpgrades(ctx, upgrades, career, gap);

    const nav = footerNavRects(L, ['◂ BACK', 'SKILLS']);
    hangarBuyBoxes.push({ ...nav[0], kind: 'back', slot: '__back' });
    hangarBuyBoxes.push({ ...nav[1], kind: 'skills' });
    drawMenuButton(ctx, nav[0], { label: nav[0].label });
    drawMenuButton(ctx, nav[1], { label: nav[1].label });

    const pointer = menuPointerPos();
    const tip = hoverTip || hangarPinnedTip;
    if (tip) {
      const ax = hoverTip ? pointer.x : tip.x;
      const ay = hoverTip ? pointer.y : tip.y;
      drawCursorTooltip(ctx, tip.text, ax, ay, {
        x: L.content.x,
        y: L.content.y,
        w: L.content.w,
        h: L.content.h,
      });
    }
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
    drawHeaderDollars(ctx, L, career.dollars);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 13px "Courier New", monospace';
    ctx.fillStyle = P.ui.textBright;
    ctx.fillText(`LEVEL ${pilot.level}`, L.content.x, L.content.y + 4);
    ctx.fillStyle = '#44cccc';
    ctx.fillText(`SKILL POINTS: ${pilot.skillPoints}`, L.content.x + 128, L.content.y + 4);
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

    const navLabels =
      pilot.allocated.length > 0 ? ['◂ BACK', 'HANGAR', 'FREE RESPEC'] : ['◂ BACK', 'HANGAR'];
    const nav = footerNavRects(L, navLabels);
    drawMenuButton(ctx, nav[0], { label: nav[0].label });
    drawMenuButton(ctx, nav[1], { label: nav[1].label });
    pilotBackBox = nav[0];
    pilotHangarBox = nav[1];
    if (nav[2]) {
      drawMenuButton(ctx, nav[2], { label: nav[2].label, kind: 'accent' });
      pilotRespecBox = nav[2];
    } else {
      pilotRespecBox = null;
    }
    ctx.restore();
  },
};

export let pilotBackBox = null;
export let pilotHangarBox = null;

// ── Click resolution (called by app.js) ───────────────────────────────────
// Returns true if the click was consumed by a meta screen.
export function handleHangarClick(px, py, dpr) {
  const career = metaState.career;
  if (!career) return false;
  let hit = null;
  for (const box of hangarBuyBoxes) {
    if (
      px >= box.x * dpr &&
      px <= (box.x + box.w) * dpr &&
      py >= box.y * dpr &&
      py <= (box.y + box.h) * dpr
    ) {
      hit = box;
      break;
    }
  }
  if (!hit) {
    hangarPinnedTip = null;
    return false;
  }
  if (hit.kind === 'back' || hit.slot === '__back') return 'back';
  if (hit.kind === 'skills') return 'skills';
  if (hit.airframe) {
    hangarPinnedTip = null;
    selectGunship(career, hit.airframe);
    return true;
  }
  if (hit.kind === 'inspect') {
    if (finePointerHover()) return true;
    if (hangarPinnedTip && hangarPinnedTip.inspect === hit.inspect) {
      hangarPinnedTip = null;
      return true;
    }
    hangarPinnedTip = {
      text: hit.tip,
      inspect: hit.inspect,
      x: hit.x + hit.w * 0.5,
      y: hit.y,
    };
    return true;
  }
  if (hit.kind === 'buy' || hit.slot) {
    hangarPinnedTip = null;
    buyHangarLevel(career, hit.slot);
    return true;
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
    pilotHangarBox &&
    px >= pilotHangarBox.x * dpr &&
    px <= (pilotHangarBox.x + pilotHangarBox.w) * dpr &&
    py >= pilotHangarBox.y * dpr &&
    py <= (pilotHangarBox.y + pilotHangarBox.h) * dpr
  ) {
    return 'hangar';
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

// ═════════════════════════════════════════════════════════════
//  DOSSIERS — known contacts bestiary
// ═════════════════════════════════════════════════════════════

let dossierTileBoxes = [];
let dossierNavBoxes = [];
let dossierPopup = null;
let dossierCloseBox = null;
let dossierPanelRect = null;

function dossierKillCount(career, className) {
  const fromCareer = career?.dossierKills?.[className] || 0;
  const fromPilot = career?.pilot?.dossierKills?.[className] || 0;
  return Math.max(fromCareer, fromPilot);
}

function isDevUnlock() {
  if (typeof window !== 'undefined') {
    try {
      if (new URLSearchParams(window.location.search).has('dev')) return true;
    } catch {
      /* ignore */
    }
  }
  return true;
}

function dossierVisible(career, className) {
  return isDevUnlock() || dossierKillCount(career, className) > 0;
}

function drawDossierPreview(ctx, className, cx, cy, scale) {
  const def = ENEMY_CLASSES[className];
  if (!def) return;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  drawEnemy(ctx, {
    x: 0,
    y: 0,
    angle: -Math.PI / 2,
    size: def.size,
    color: def.color,
    className,
    category: def.category,
    flashTimer: 0,
    hp: def.hp,
    maxHp: def.hp,
  });
  ctx.restore();
}

export const dossiersScreen = {
  draw(ctx, cam) {
    const w = cam.screenW;
    const h = cam.screenH;
    const career = careerOrEmpty();
    ctx.save();
    ctx.scale(cam.dpr, cam.dpr);
    const L = paintScreenBackdrop(
      ctx,
      w,
      h,
      'DOSSIERS',
      isDevUnlock() ? 'ALL CONTACTS — LIVE KILL COUNTS' : 'KNOWN CONTACTS — KILL TO UNLOCK'
    );
    dossierTileBoxes = [];
    const cols = L.landscape ? 6 : L.phone ? 3 : 4;
    const ids = ENEMY_CLASS_ORDER.filter((id) => ENEMY_CLASSES[id]);
    const rows = Math.ceil(ids.length / cols);
    const gap = 10;
    const gridW = L.content.w;
    const gridH = L.content.h - 8;
    const tileW = (gridW - gap * (cols - 1)) / cols;
    const tileH = Math.min(118, (gridH - gap * (rows - 1)) / rows);
    const totalH = tileH * rows + gap * (rows - 1);
    const gridY = L.content.y + Math.max(0, (L.content.h - totalH) / 2);

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const rect = {
        x: L.content.x + col * (tileW + gap),
        y: gridY + row * (tileH + gap),
        w: tileW,
        h: tileH,
        className: id,
      };
      const kills = dossierKillCount(career, id);
      const unlocked = dossierVisible(career, id);
      const hit = menuHit(rect);
      ctx.save();
      if (hit.scale !== 1) {
        ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
        ctx.scale(hit.scale, hit.scale);
        ctx.translate(-(rect.x + rect.w / 2), -(rect.y + rect.h / 2));
      }
      ctx.fillStyle = unlocked ? (hit.hover ? '#1a3320' : '#102018') : '#0a100a';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = unlocked
        ? hit.hover
          ? '#aaff88'
          : 'rgba(90,140,80,0.7)'
        : 'rgba(50,70,50,0.35)';
      ctx.lineWidth = hit.hover && unlocked ? 2 : 1;
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
      if (unlocked) {
        drawDossierPreview(ctx, id, rect.x + rect.w / 2, rect.y + rect.h * 0.42, 2.2);
        ctx.fillStyle = P.ui.textBright;
        ctx.font = 'bold 11px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(ENEMY_CLASS_LABELS[id] || id.toUpperCase(), rect.x + rect.w / 2, rect.y + rect.h - 28);
        ctx.fillStyle = kills > 0 ? '#ffcc44' : P.ui.textDim;
        ctx.font = '10px "Courier New", monospace';
        ctx.fillText(`${kills} KILL${kills === 1 ? '' : 'S'}`, rect.x + rect.w / 2, rect.y + rect.h - 14);
      } else {
        ctx.fillStyle = 'rgba(90,110,90,0.35)';
        ctx.font = 'bold 22px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✕', rect.x + rect.w / 2, rect.y + rect.h * 0.42);
        ctx.fillStyle = P.ui.textDim;
        ctx.font = 'bold 10px "Courier New", monospace';
        ctx.textBaseline = 'top';
        ctx.fillText('UNKNOWN', rect.x + rect.w / 2, rect.y + rect.h - 22);
      }
      ctx.restore();
      dossierTileBoxes.push(rect);
    }

    const nav = footerNavRects(L, ['◂ CAMPAIGN', 'HANGAR', 'SKILLS']);
    dossierNavBoxes = nav;
    for (const rect of nav) drawMenuButton(ctx, rect, { label: rect.label });

    if (dossierPopup) {
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.fillRect(0, 0, w, h);
      const pw = Math.min(520, L.content.w);
      const ph = Math.min(340, L.content.h + 20);
      const px = (w - pw) / 2;
      const py = (h - L.footerH - ph) / 2 + 10;
      dossierPanelRect = { x: px, y: py, w: pw, h: ph };
      ctx.fillStyle = '#0c1610';
      ctx.fillRect(px, py, pw, ph);
      ctx.strokeStyle = '#88aa66';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
      drawCornerBrackets(ctx, px, py, pw, ph, 'rgba(204,136,51,0.7)', 14, 1.6);

      const close = { x: px + pw - 42, y: py + 10, w: 32, h: 28 };
      dossierCloseBox = close;
      const closeHit = menuHit(close);
      ctx.fillStyle = closeHit.hover ? '#5a2020' : '#2a1212';
      ctx.fillRect(close.x, close.y, close.w, close.h);
      ctx.strokeStyle = closeHit.hover ? '#ff8888' : '#cc6666';
      ctx.strokeRect(close.x + 0.5, close.y + 0.5, close.w - 1, close.h - 1);
      ctx.fillStyle = '#ffdddd';
      ctx.font = 'bold 16px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('X', close.x + close.w / 2, close.y + close.h / 2 + 1);

      const def = ENEMY_CLASSES[dossierPopup];
      const kills = dossierKillCount(career, dossierPopup);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = P.ui.textBright;
      ctx.font = 'bold 20px "Courier New", monospace';
      ctx.fillText(ENEMY_CLASS_LABELS[dossierPopup] || dossierPopup.toUpperCase(), px + 22, py + 16);
      ctx.fillStyle = '#ffcc44';
      ctx.font = 'bold 13px "Courier New", monospace';
      ctx.fillText(`CONFIRMED KILLS  ${kills}`, px + 22, py + 44);

      drawDossierPreview(ctx, dossierPopup, px + pw * 0.28, py + ph * 0.58, 5.2);

      const lines = [
        `CLASS     ${(def.category || 'unknown').toUpperCase()}`,
        `BEHAVIOR  ${(def.behavior || '—').toUpperCase()}`,
        `HULL      ${def.hp}`,
        `SPEED     ${def.speed}`,
        `VALUE     ${def.points} PTS`,
      ];
      ctx.font = '13px "Courier New", monospace';
      ctx.fillStyle = P.ui.text;
      const statsX = px + pw * 0.52;
      let sy = py + 88;
      for (const line of lines) {
        ctx.fillText(line, statsX, sy);
        sy += 28;
      }
    } else {
      dossierCloseBox = null;
      dossierPanelRect = null;
    }
    ctx.restore();
  },
};

export function handleDossiersClick(px, py, dpr) {
  if (dossierPopup && dossierCloseBox) {
    if (
      px >= dossierCloseBox.x * dpr &&
      px <= (dossierCloseBox.x + dossierCloseBox.w) * dpr &&
      py >= dossierCloseBox.y * dpr &&
      py <= (dossierCloseBox.y + dossierCloseBox.h) * dpr
    ) {
      dossierPopup = null;
      return true;
    }
    if (
      dossierPanelRect &&
      px >= dossierPanelRect.x * dpr &&
      px <= (dossierPanelRect.x + dossierPanelRect.w) * dpr &&
      py >= dossierPanelRect.y * dpr &&
      py <= (dossierPanelRect.y + dossierPanelRect.h) * dpr
    ) {
      return true;
    }
    dossierPopup = null;
    return true;
  }
  for (const box of dossierNavBoxes) {
    if (
      px >= box.x * dpr &&
      px <= (box.x + box.w) * dpr &&
      py >= box.y * dpr &&
      py <= (box.y + box.h) * dpr
    ) {
      if (box.label === 'HANGAR') return 'hangar';
      if (box.label === 'SKILLS') return 'skills';
      return 'back';
    }
  }
  for (const box of dossierTileBoxes) {
    if (
      px >= box.x * dpr &&
      px <= (box.x + box.w) * dpr &&
      py >= box.y * dpr &&
      py <= (box.y + box.h) * dpr
    ) {
      const career = metaState.career;
      if (dossierVisible(career, box.className)) dossierPopup = box.className;
      return true;
    }
  }
  return false;
}

export { saveCareer, clamp };
