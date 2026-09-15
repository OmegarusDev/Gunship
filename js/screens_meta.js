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
import { drawEnemy, drawBossSilhouette } from './render/entities.js';
import { HANGAR_HOUR } from './sun.js';
import {
  ENEMY_CLASSES,
  ENEMY_CLASS_ORDER,
  ENEMY_CLASS_LABELS,
} from './data/enemyClasses.js';
import { BOSS_DOSSIERS, BOSS_DOSSIER_ORDER } from './data/bosses.js';
import {
  metaState,
  GUNSHIPS,
  GUNSHIP_ORDER,
  HANGAR_SLOTS,
  HANGAR_MAX,
  HANGAR_SLOT_ORDER,
  gunshipHasMissiles,
  gunshipDef,
  selectGunship,
  syncGunshipUnlocks,
  PILOT_SKILLS,
  SKILL_MAX,
  SKILL_PERK_RANKS,
  skillRank,
  spentSkillPoints,
  levelSkill,
  respecSkills,
  buyHangarLevel,
  saveCareer,
  xpToNext,
  clamp,
  isSandboxCareer,
  ACHIEVEMENTS,
  achievementCount,
} from './meta.js';
import { isDevUnlock } from './config.js';

// Click zones published each draw; app.js consults these in its handler.
export let hangarBuyBoxes = [];
export let pilotNodeBoxes = [];
export let pilotRespecBox = null;

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
      skills: { gunnery: 0, flying: 0, vision: 0, nerve: 0, tracking: 0, luck: 0 },
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

function drawSectionCaption(ctx, x, y, w, text, color = P.ui.textDim) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 13px "Courier New", monospace';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  const tw = ctx.measureText(text).width;
  ctx.strokeStyle = color === '#cc6666' ? 'rgba(200,70,70,0.4)' : 'rgba(90,140,80,0.35)';
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
  const tree = career.hangar?.[career.gunship] || {};
  const blades = def.rotorBlades === 5 ? 5 : (tree.rotor || 0) >= 5 ? 4 : def.rotorBlades;
  const innerW = Math.max(40, bay.w - 12);
  const innerH = Math.max(40, bay.h - plateH - 8);
  const rotorR = 36 * 0.58 * 2 * (def.size || 1);
  const fit = Math.min(innerW, innerH) / (rotorR * 1.52);
  ctx.save();
  ctx.beginPath();
  ctx.rect(bay.x + 2, bay.y + 2, bay.w - 4, bay.h - plateH - 1);
  ctx.clip();
  drawGunship(ctx, {
    x: bay.x + bay.w * 0.5,
    y: bay.y + (bay.h - plateH) * 0.52,
    angle: 0,
    bank: 0,
    bladeAngle: hangarTime * 9,
    gunshipId: career.gunship,
    rotorBlades: blades,
    airframeScale: def.size,
    drawScale: Math.max(1.6, Math.min(6.4, fit)),
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
  ctx.font = 'bold 13px "Courier New", monospace';
  ctx.fillText('BAY  ·  STAND-IN PROFILE', bay.x + 14, bay.y + bay.h - plateH + 8);
  ctx.fillStyle = P.ui.textBright;
  ctx.font = 'bold 15px "Courier New", monospace';
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
      const bodyH = Math.max(10, rect.h - labelH - 4);
      const fit = Math.min(rect.w - 4, bodyH) / 42;
      drawGunship(ctx, {
        x: rect.x + rect.w / 2,
        y: rect.y + bodyH * 0.52,
        angle: 0,
        bank: 0,
        bladeAngle: 0.45,
        gunshipId: id,
        rotorBlades: def.rotorBlades,
        airframeScale: def.size,
        drawScale: Math.max(0.7, Math.min(2.15, fit)),
        hideRotor: false,
        hour: HANGAR_HOUR,
      });
    } else {
      ctx.fillStyle = 'rgba(120,140,110,0.48)';
      ctx.font = 'bold 13px "Courier New", monospace';
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
    ctx.font = 'bold 13px "Courier New", monospace';
    ctx.fillText(AIRFRAME_LABELS[id], rect.x + rect.w / 2, rect.y + rect.h - labelH + 4);
    ctx.font = '12px "Courier New", monospace';
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
  drawSectionCaption(ctx, area.x + pad, area.y + 8, area.w - pad * 2, 'PARTS');
  const gridY = area.y + 28;
  const gridH = Math.max(80, area.h - 28 - pad);
  const slotIds = HANGAR_SLOT_ORDER.filter((id) => HANGAR_SLOTS[id]);
  const cols = area.w >= 600 ? 3 : 2;
  const rows = Math.ceil(slotIds.length / cols);
  const rowH = Math.min(100, (gridH - gap * (rows - 1)) / Math.max(1, rows));
  const colW = (area.w - pad * 2 - gap * (cols - 1)) / cols;
  let hoverTip = null;
  const pointer = menuPointerPos();
  const hoverOk = finePointerHover();
  const gunId = career.gunship;
  const noRacks = !gunshipHasMissiles(gunId);

  ctx.save();
  ctx.beginPath();
  ctx.rect(area.x + 2, area.y + 2, area.w - 4, area.h - 4);
  ctx.clip();

  for (let i = 0; i < slotIds.length; i++) {
    const slot = slotIds[i];
    const def = HANGAR_SLOTS[slot];
    const lvl = career.hangar[gunId]?.[slot] || 0;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const bx = area.x + pad + col * (colW + gap);
    const by = gridY + row * (rowH + gap);
    const bw = colW;
    const blocked = slot === 'ordnance' && noRacks;
    const maxed = !blocked && lvl >= HANGAR_MAX;
    const cost = blocked || maxed ? 0 : def.levels[lvl].cost;
    const affordable = !blocked && !maxed && career.dollars >= cost;
    const desc = blocked
      ? 'AH-1G has no missile racks. SuperCobra onward mounts slow autofire missiles.'
      : maxed
        ? def.levels[HANGAR_MAX - 1].desc
        : def.levels[lvl].desc;
    const card = { x: bx, y: by, w: bw, h: rowH };

    const stacked = bw < 240;
    const bh = stacked
      ? Math.min(40, Math.max(34, rowH * 0.34))
      : Math.min(46, Math.max(36, rowH - 30));
    const bwid = stacked ? bw - 16 : Math.min(108, Math.max(78, bw * 0.3));
    const buyRect =
      blocked || maxed
        ? null
        : stacked
          ? { x: bx + 8, y: by + rowH - bh - 7, w: bwid, h: bh }
          : { x: bx + bw - bwid - 8, y: by + 8, w: bwid, h: bh };
    const inspectRect = {
      x: bx,
      y: by,
      w: stacked || !buyRect ? bw : Math.max(64, buyRect.x - bx),
      h: stacked && buyRect ? Math.max(28, buyRect.y - by) : rowH,
    };

    const overCard = pointerInRect(pointer, card);
    ctx.fillStyle = overCard ? 'rgba(20,48,18,0.94)' : 'rgba(13,33,15,0.9)';
    ctx.fillRect(bx, by, bw, rowH);
    ctx.strokeStyle = blocked
      ? 'rgba(70,90,70,0.35)'
      : maxed
        ? 'rgba(90,140,80,0.7)'
        : affordable
          ? P.ui.borderHi
          : P.ui.border;
    ctx.lineWidth = overCard ? 1.4 : 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, rowH - 1);

    ctx.save();
    ctx.beginPath();
    ctx.rect(bx + 6, by + 4, bw - 12, rowH - 8);
    ctx.clip();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font =
      def.name.length > 9 ? 'bold 13px "Courier New", monospace' : 'bold 14px "Courier New", monospace';
    ctx.fillStyle = blocked ? P.ui.textDim : P.ui.textBright;
    ctx.fillText(def.name, bx + 12, by + 8);
    const pipAreaW = (stacked || !buyRect ? bw : inspectRect.w) - 24;
    const pipW = Math.min(10, (pipAreaW - 9 * 3) / 10);
    const pipY = by + 30;
    for (let p = 0; p < HANGAR_MAX; p++) {
      const perk = p + 1 === 5 || p + 1 === 10;
      ctx.fillStyle = p < lvl ? '#aaff88' : 'rgba(90,140,80,0.28)';
      ctx.fillRect(bx + 12 + p * (pipW + 3), pipY, pipW, perk ? 8 : 6);
    }
    ctx.font = '12px "Courier New", monospace';
    ctx.fillStyle = P.ui.textDim;
    const statusY = stacked && buyRect ? buyRect.y - 16 : by + rowH - 18;
    ctx.fillText(blocked ? 'NO RACKS' : `${lvl}/${HANGAR_MAX}`, bx + 12, statusY);
    ctx.restore();

    if (buyRect) {
      drawMenuButton(ctx, buyRect, {
        label: stacked ? `$${cost}` : affordable ? `BUY  $${cost}` : `$${cost}`,
        kind: affordable ? 'accent' : 'menu',
        disabled: !affordable,
        compact: true,
      });
      hangarBuyBoxes.push({ ...buyRect, kind: 'buy', slot });
    } else {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillStyle = blocked ? P.ui.textDim : '#3f7f3f';
      ctx.font = 'bold 13px "Courier New", monospace';
      ctx.fillText(blocked ? 'COBRA' : 'MAXED', bx + bw - 12, by + 8);
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
      isSandboxCareer(career) ? 'SANDBOX BAY' : 'HANGAR',
      isSandboxCareer(career)
        ? `${gunshipDef(career.gunship).name.toUpperCase()} — ALL AIRFRAMES UNLOCKED`
        : `${gunshipDef(career.gunship).name.toUpperCase()} — PERMANENT UPGRADES`
    );

    drawHeaderDollars(ctx, L, career.dollars);

    hangarBuyBoxes = [];
    const gap = L.btnGap;
    const split = L.landscape && L.content.w >= 640;
    let bay;
    let selector;
    let upgrades;
    if (split) {
      const bayW = L.content.w * 0.48;
      bay = { x: L.content.x, y: L.content.y, w: bayW, h: L.content.h };
      const rightX = L.content.x + bayW + gap;
      const rightW = L.content.w - bayW - gap;
      const selH = Math.min(248, Math.max(176, L.content.h * 0.36));
      selector = { x: rightX, y: L.content.y, w: rightW, h: selH };
      upgrades = {
        x: rightX,
        y: L.content.y + selH + gap,
        w: rightW,
        h: L.content.h - selH - gap,
      };
    } else {
      const selH = Math.min(248, Math.max(176, L.content.h * 0.32));
      const minUpgrades = 168;
      const bayH = Math.max(
        140,
        Math.min(L.content.h * 0.42, L.content.h - selH - minUpgrades - gap * 2)
      );
      bay = { x: L.content.x, y: L.content.y, w: L.content.w, h: bayH };
      selector = { x: L.content.x, y: bay.y + bay.h + gap, w: L.content.w, h: selH };
      upgrades = {
        x: L.content.x,
        y: selector.y + selH + gap,
        w: L.content.w,
        h: Math.max(80, L.content.y + L.content.h - (selector.y + selH + gap)),
      };
    }

    drawHangarBay(ctx, bay, career);
    drawHangarSelector(ctx, selector, career, gap);
    const hoverTip = drawHangarUpgrades(ctx, upgrades, career, gap);

    const nav = isSandboxCareer(career)
      ? footerNavRects(L, ['◂ CAMPAIGN', 'OPERATIONS', 'SKILLS'])
      : footerNavRects(L, ['◂ BACK', 'SKILLS']);
    hangarBuyBoxes.push({ ...nav[0], kind: 'back', slot: '__back' });
    for (let i = 1; i < nav.length; i++) {
      const label = nav[i].label;
      hangarBuyBoxes.push({
        ...nav[i],
        kind: label === 'OPERATIONS' ? 'ops' : 'skills',
      });
    }
    for (const rect of nav) drawMenuButton(ctx, rect, { label: rect.label });

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
  if (hit.kind === 'ops') return 'ops';
  if (hit.kind === 'skills') return 'skills';
  if (hit.kind === 'airframe' || hit.airframe) {
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

// ═════════════════════════════════════════════════════════════
//  PILOT SKILLS — 6 talent panels, hangar-dark cards
// ═════════════════════════════════════════════════════════════

let skillHintId = null;
let skillFlash = null;
let skillToast = '';
let skillToastUntil = 0;

function skillPanelRects(L, count) {
  const gap = L.btnGap;
  const top = L.content.y + 58;
  const availH = L.content.h - 66;
  const cols = L.content.w >= 620 ? 3 : 2;
  const rows = Math.ceil(count / cols);
  const w = (L.content.w - gap * (cols - 1)) / cols;
  const h = Math.min(L.landscape ? 188 : 156, (availH - gap * (rows - 1)) / rows);
  const totalH = h * rows + gap * (rows - 1);
  const y0 = top + Math.max(0, (availH - totalH) / 2);
  return Array.from({ length: count }, (_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const rowCount = row === rows - 1 && count % cols ? count % cols : cols;
    const rowWidth = rowCount * w + (rowCount - 1) * gap;
    const x0 = L.content.x + (L.content.w - rowWidth) / 2;
    return { x: x0 + col * (w + gap), y: y0 + row * (h + gap), w, h };
  });
}

function wrapHint(ctx, text, maxW) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxW) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export const pilotScreen = {
  draw(ctx, cam) {
    const w = cam.screenW,
      h = cam.screenH;
    const career = careerOrEmpty();
    const pilot = career.pilot;
    const sandbox = isSandboxCareer(career);
    ctx.save();
    ctx.scale(cam.dpr, cam.dpr);
    const L = paintScreenBackdrop(
      ctx,
      w,
      h,
      'SKILLS',
      sandbox ? 'RANGE PILOT — FULLY RATED' : pilot.name
    );
    drawHeaderDollars(ctx, L, career.dollars);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `bold ${L.compact ? 14 : 15}px "Courier New", monospace`;
    ctx.fillStyle = P.ui.textBright;
    ctx.fillText(`LEVEL ${pilot.level}`, L.content.x, L.content.y + 4);
    ctx.fillStyle = sandbox ? P.ui.textDim : '#44cccc';
    ctx.fillText(
      sandbox ? 'ALL TALENTS MAXED' : `SKILL POINTS: ${pilot.skillPoints}`,
      L.content.x + 130,
      L.content.y + 4
    );

    const need = xpToNext(pilot.level + 1);
    const frac = sandbox || need === Infinity ? 1 : clamp(pilot.xp / need, 0, 1);
    ctx.fillStyle = 'rgba(10,16,10,0.9)';
    ctx.fillRect(L.content.x, L.content.y + 24, L.content.w, 12);
    ctx.fillStyle = '#cc8833';
    ctx.fillRect(L.content.x, L.content.y + 24, L.content.w * frac, 12);
    ctx.strokeStyle = 'rgba(90,140,80,0.7)';
    ctx.strokeRect(L.content.x - 0.5, L.content.y + 23.5, L.content.w + 1, 13);
    ctx.font = '12px "Courier New", monospace';
    ctx.fillStyle = P.ui.textDim;
    ctx.fillText(
      sandbox
        ? 'SANDBOX — SPENDING DISABLED'
        : need === Infinity
          ? 'MAX LEVEL'
          : `XP ${pilot.xp} / ${need} TO LV ${pilot.level + 1}`,
      L.content.x,
      L.content.y + 40
    );

    pilotNodeBoxes = [];
    const panels = skillPanelRects(L, PILOT_SKILLS.length);
    const now = performance.now();
    for (let i = 0; i < PILOT_SKILLS.length; i++) {
      const skill = PILOT_SKILLS[i];
      const rect = panels[i];
      const rank = skillRank(pilot, skill.id);
      const canUp = !sandbox && pilot.skillPoints > 0 && rank < SKILL_MAX;
      const flashing = skillFlash && skillFlash.id === skill.id && skillFlash.until > now;
      fillHangarFrame(ctx, rect);
      const hit = applyMenuHitTransform(ctx, rect, { quiet: true });
      ctx.fillStyle = flashing
        ? 'rgba(70,110,48,0.55)'
        : hit.hover
          ? 'rgba(20,48,18,0.35)'
          : 'rgba(0,0,0,0)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      strokeHangarFrame(ctx, rect);

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = P.ui.textBright;
      ctx.font = 'bold 16px "Courier New", monospace';
      ctx.fillText(skill.name, rect.x + 14, rect.y + 12);
      const nameW = ctx.measureText(skill.name).width;
      const hint = {
        x: Math.min(rect.x + 20 + nameW, rect.x + rect.w - 44),
        y: rect.y + 8,
        w: 32,
        h: 32,
        id: skill.id,
        kind: 'hint',
      };
      const hintHit = menuHit(hint);
      ctx.fillStyle = hintHit.hover ? 'rgba(68,204,204,0.28)' : 'rgba(68,204,204,0.12)';
      ctx.fillRect(hint.x, hint.y, hint.w, hint.h);
      ctx.strokeStyle = hintHit.hover ? '#88eeee' : '#44cccc';
      ctx.strokeRect(hint.x + 0.5, hint.y + 0.5, hint.w - 1, hint.h - 1);
      ctx.fillStyle = '#88eeee';
      ctx.font = 'bold 16px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', hint.x + hint.w / 2, hint.y + hint.h / 2 + 1);

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = P.ui.textDim;
      ctx.font = '13px "Courier New", monospace';
      const perk = skill.perks && rank >= 3
        ? SKILL_PERK_RANKS.filter((n) => rank >= n).map((n) => skill.perks[n]?.name).filter(Boolean).pop()
        : null;
      ctx.fillText(perk ? `LV ${rank} / ${SKILL_MAX}  ·  ${perk}` : `LV ${rank} / ${SKILL_MAX}`, rect.x + 14, rect.y + 42);

      const btnH = Math.min(48, Math.max(44, rect.h * 0.26));
      const btn = {
        x: rect.x + 12,
        y: rect.y + rect.h - btnH - 10,
        w: rect.w - 24,
        h: btnH,
        id: skill.id,
        kind: 'up',
      };
      const pipY = Math.max(rect.y + 62, btn.y - 18);
      const pipGap = 4;
      const pipW = Math.min(12, (rect.w - 28 - pipGap * (SKILL_MAX - 1)) / SKILL_MAX);
      for (let p = 0; p < SKILL_MAX; p++) {
        const isPerk = SKILL_PERK_RANKS.includes(p + 1);
        ctx.fillStyle = p < rank ? '#aaff88' : 'rgba(40,60,40,0.9)';
        ctx.fillRect(rect.x + 14 + p * (pipW + pipGap), pipY, pipW, isPerk ? 10 : 7);
        if (isPerk) {
          ctx.strokeStyle = p < rank ? '#ffcc66' : 'rgba(204,170,68,0.45)';
          ctx.lineWidth = 1;
          ctx.strokeRect(rect.x + 14 + p * (pipW + pipGap) + 0.5, pipY + 0.5, pipW - 1, (isPerk ? 10 : 7) - 1);
        }
      }

      const label = sandbox
        ? 'RATED'
        : rank >= SKILL_MAX
          ? 'MAXED'
          : canUp
            ? 'LEVEL UP'
            : 'NEED SP';
      drawMenuButton(ctx, btn, {
        label,
        kind: canUp ? 'primary' : 'menu',
        disabled: !canUp,
        compact: false,
        blink: canUp,
      });
      pilotNodeBoxes.push(hint, btn);
    }

    if (skillToast && now < skillToastUntil) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.font = 'bold 13px "Courier New", monospace';
      ctx.fillStyle = '#aaff88';
      ctx.fillText(skillToast, w / 2, h - L.footerH - 8);
    }

    const spent = spentSkillPoints(pilot);
    const navLabels = sandbox
      ? ['◂ BACK', 'HANGAR']
      : spent > 0
        ? ['◂ BACK', 'HANGAR', 'FREE RESPEC']
        : ['◂ BACK', 'HANGAR'];
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

    if (skillHintId) {
      const def = PILOT_SKILLS.find((s) => s.id === skillHintId);
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.fillRect(0, 0, w, h);
      const pw = Math.min(500, L.content.w);
      const ph = Math.min(320, L.content.h);
      const px = (w - pw) / 2;
      const py = (h - L.footerH - ph) / 2;
      ctx.fillStyle = '#0c1610';
      ctx.fillRect(px, py, pw, ph);
      ctx.strokeStyle = '#88aa66';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
      drawCornerBrackets(ctx, px, py, pw, ph, 'rgba(204,136,51,0.7)', 14, 1.6);
      const close = { x: px + pw - 44, y: py + 10, w: 34, h: 32, kind: 'hint-close' };
      const closeHit = menuHit(close);
      ctx.fillStyle = closeHit.hover ? '#5a2020' : '#2a1212';
      ctx.fillRect(close.x, close.y, close.w, close.h);
      ctx.strokeStyle = closeHit.hover ? '#ff8888' : '#cc6666';
      ctx.strokeRect(close.x + 0.5, close.y + 0.5, close.w - 1, close.h - 1);
      ctx.fillStyle = '#ffdddd';
      ctx.font = 'bold 18px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('X', close.x + close.w / 2, close.y + close.h / 2 + 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = P.ui.textBright;
      ctx.font = 'bold 20px "Courier New", monospace';
      ctx.fillText(def?.name || 'SKILL', px + 22, py + 16);
      ctx.fillStyle = P.ui.text;
      ctx.font = '14px "Courier New", monospace';
      const lines = wrapHint(ctx, def?.hint || '', pw - 44);
      let ly = py + 50;
      for (const line of lines) {
        ctx.fillText(line, px + 22, ly);
        ly += 20;
      }
      ly += 8;
      ctx.font = 'bold 13px "Courier New", monospace';
      ctx.fillStyle = '#ffcc66';
      ctx.fillText('PERKS', px + 22, ly);
      ly += 20;
      ctx.font = '13px "Courier New", monospace';
      for (const n of SKILL_PERK_RANKS) {
        const perk = def?.perks?.[n];
        if (!perk) continue;
        ctx.fillStyle = P.ui.textBright;
        ctx.fillText(`LV ${n}  ${perk.name}`, px + 22, ly);
        ly += 18;
        ctx.fillStyle = P.ui.textDim;
        ctx.fillText(perk.desc, px + 22, ly);
        ly += 20;
      }
    }
    ctx.restore();
  },
};

export let pilotBackBox = null;
export let pilotHangarBox = null;

export function handlePilotClick(px, py, dpr) {
  const career = metaState.career;
  if (!career) return false;
  if (skillHintId) {
    skillHintId = null;
    return true;
  }
  if (
    pilotRespecBox &&
    px >= pilotRespecBox.x * dpr &&
    px <= (pilotRespecBox.x + pilotRespecBox.w) * dpr &&
    py >= pilotRespecBox.y * dpr &&
    py <= (pilotRespecBox.y + pilotRespecBox.h) * dpr
  ) {
    respecSkills(career);
    skillToast = 'TALENTS RESET';
    skillToastUntil = performance.now() + 1200;
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
      if (box.kind === 'hint') {
        skillHintId = box.id;
        return true;
      }
      if (box.kind === 'up') {
        const result = levelSkill(career, box.id);
        if (result.ok) {
          const def = PILOT_SKILLS.find((s) => s.id === box.id);
          skillFlash = { id: box.id, until: performance.now() + 280 };
          skillToast = `${def?.name || 'SKILL'} → ${result.rank}`;
          skillToastUntil = performance.now() + 1400;
        } else {
          skillToast = result.reason || 'CANNOT LEVEL';
          skillToastUntil = performance.now() + 1100;
        }
        return true;
      }
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

function dossierVisible(career, className) {
  return dossierKillCount(career, className) > 0 || isDevUnlock();
}

function fitDossierLabel(ctx, text, maxW) {
  const raw = String(text || '');
  if (ctx.measureText(raw).width <= maxW) return raw;
  let t = raw;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function wrapDossierLines(ctx, text, maxW) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && ctx.measureText(next).width > maxW) {
      lines.push(cur);
      cur = word;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawDossierPreview(ctx, className, cx, cy, scale) {
  const boss = BOSS_DOSSIERS[className];
  if (boss) {
    drawBossSilhouette(ctx, boss.silhouette, cx, cy, Math.max(1.35, scale * 0.55), '#c05050');
    return;
  }
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

function paintDossierTile(ctx, rect, { id, label, kills, unlocked, boss }) {
  const hit = unlocked ? menuHit(rect) : menuHit(rect, { quiet: true });
  ctx.save();
  if (hit.scale !== 1) {
    ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.scale(hit.scale, hit.scale);
    ctx.translate(-(rect.x + rect.w / 2), -(rect.y + rect.h / 2));
  }
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  if (boss) {
    ctx.fillStyle = unlocked ? (hit.hover ? '#4a1818' : '#2a1010') : 'rgba(42, 12, 12, 0.78)';
    ctx.strokeStyle = unlocked
      ? hit.hover
        ? '#ff8888'
        : 'rgba(200, 70, 70, 0.85)'
      : 'rgba(120, 40, 40, 0.5)';
  } else {
    ctx.fillStyle = hit.hover ? '#1a3320' : '#102018';
    ctx.strokeStyle = hit.hover ? '#aaff88' : 'rgba(90,140,80,0.7)';
  }
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.lineWidth = hit.hover && unlocked ? 2 : 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
  if (unlocked) {
    drawDossierPreview(ctx, id, rect.x + rect.w / 2, rect.y + rect.h * 0.38, boss ? 1.65 : 1.9);
    ctx.fillStyle = boss ? '#ffcccc' : P.ui.textBright;
    ctx.font = 'bold 11px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(fitDossierLabel(ctx, label, rect.w - 8), rect.x + rect.w / 2, rect.y + rect.h - 28);
    ctx.fillStyle = '#ffcc44';
    ctx.font = '11px "Courier New", monospace';
    ctx.fillText(`${kills} KILL${kills === 1 ? '' : 'S'}`, rect.x + rect.w / 2, rect.y + rect.h - 14);
  } else {
    ctx.fillStyle = 'rgba(180, 80, 80, 0.55)';
    ctx.font = 'bold 16px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('????', rect.x + rect.w / 2, rect.y + rect.h * 0.42);
    ctx.font = '10px "Courier New", monospace';
    ctx.textBaseline = 'top';
    ctx.fillText('LOCKED', rect.x + rect.w / 2, rect.y + rect.h - 18);
  }
  ctx.restore();
}

export const dossiersScreen = {
  draw(ctx, cam) {
    const w = cam.screenW;
    const h = cam.screenH;
    const career = careerOrEmpty();
    ctx.save();
    ctx.scale(cam.dpr, cam.dpr);
    const L = paintScreenBackdrop(ctx, w, h, 'DOSSIERS', 'HUNTERS AND CONTACTS');
    drawHeaderDollars(ctx, L, career.dollars);
    dossierTileBoxes = [];
    const gap = 8;
    const bossCols = L.landscape || L.content.w >= 720 ? 8 : 4;
    const fieldCols = L.landscape || L.content.w >= 720 ? 8 : 4;
    const fieldIds = ENEMY_CLASS_ORDER.filter(
      (id) => ENEMY_CLASSES[id] && dossierVisible(career, id)
    );
    const captionH = 20;
    const bossRows = Math.ceil(BOSS_DOSSIER_ORDER.length / bossCols);
    const fieldRows = Math.max(1, Math.ceil(Math.max(fieldIds.length, 1) / fieldCols));
    const avail = L.content.h - captionH * 2 - gap * 3;
    const bossBand = Math.min(avail * 0.44, Math.max(108, 56 * bossRows + gap * (bossRows - 1)));
    const fieldBand = Math.max(80, avail - bossBand);
    const bossTileH = Math.max(48, (bossBand - gap * (bossRows - 1)) / bossRows);
    const bossTileW = (L.content.w - gap * (bossCols - 1)) / bossCols;
    const fieldTileH = Math.min(
      108,
      Math.max(52, (fieldBand - gap * (fieldRows - 1)) / fieldRows)
    );
    const fieldTileW = (L.content.w - gap * (fieldCols - 1)) / fieldCols;

    drawSectionCaption(ctx, L.content.x, L.content.y, L.content.w, 'HUNTERS', '#cc6666');
    const bossY = L.content.y + captionH;
    for (let i = 0; i < BOSS_DOSSIER_ORDER.length; i++) {
      const id = BOSS_DOSSIER_ORDER[i];
      const col = i % bossCols;
      const row = Math.floor(i / bossCols);
      const unlocked = dossierVisible(career, id);
      const rect = {
        x: L.content.x + col * (bossTileW + gap),
        y: bossY + row * (bossTileH + gap),
        w: bossTileW,
        h: bossTileH,
        className: id,
      };
      const def = BOSS_DOSSIERS[id];
      paintDossierTile(ctx, rect, {
        id,
        label: def?.short || def?.name || id,
        kills: dossierKillCount(career, id),
        unlocked,
        boss: true,
      });
      if (unlocked) dossierTileBoxes.push(rect);
    }

    const fieldTop = bossY + bossBand + gap;
    drawSectionCaption(ctx, L.content.x, fieldTop, L.content.w, 'CONTACTS');
    const fieldY = fieldTop + captionH;
    if (fieldIds.length === 0) {
      ctx.fillStyle = P.ui.textDim;
      ctx.font = '13px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        'NO FIELD CONTACTS CONFIRMED',
        L.content.x + L.content.w / 2,
        fieldY + Math.min(fieldBand, 90) * 0.45
      );
    } else {
      for (let i = 0; i < fieldIds.length; i++) {
        const id = fieldIds[i];
        const col = i % fieldCols;
        const row = Math.floor(i / fieldCols);
        const rect = {
          x: L.content.x + col * (fieldTileW + gap),
          y: fieldY + row * (fieldTileH + gap),
          w: fieldTileW,
          h: fieldTileH,
          className: id,
        };
        paintDossierTile(ctx, rect, {
          id,
          label: ENEMY_CLASS_LABELS[id] || id.toUpperCase(),
          kills: dossierKillCount(career, id),
          unlocked: true,
          boss: false,
        });
        dossierTileBoxes.push(rect);
      }
    }

    const nav = footerNavRects(L, ['◂ CAMPAIGN', 'HANGAR', 'SKILLS']);
    dossierNavBoxes = nav;
    for (const rect of nav) drawMenuButton(ctx, rect, { label: rect.label });

    if (dossierPopup) {
      const boss = BOSS_DOSSIERS[dossierPopup];
      const def = ENEMY_CLASSES[dossierPopup];
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.fillRect(0, 0, w, h);
      const pw = Math.min(520, L.content.w);
      const ph = Math.min(360, L.content.h + 20);
      const px = (w - pw) / 2;
      const py = (h - L.footerH - ph) / 2 + 10;
      dossierPanelRect = { x: px, y: py, w: pw, h: ph };
      ctx.fillStyle = boss ? '#160c0c' : '#0c1610';
      ctx.fillRect(px, py, pw, ph);
      ctx.strokeStyle = boss ? '#cc6666' : '#88aa66';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
      drawCornerBrackets(
        ctx,
        px,
        py,
        pw,
        ph,
        boss ? 'rgba(204,80,80,0.75)' : 'rgba(204,136,51,0.7)',
        14,
        1.6
      );

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

      const kills = dossierKillCount(career, dossierPopup);
      const title = boss
        ? boss.name
        : ENEMY_CLASS_LABELS[dossierPopup] || dossierPopup.toUpperCase();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = boss ? '#ffcccc' : P.ui.textBright;
      ctx.font = 'bold 18px "Courier New", monospace';
      ctx.fillText(fitDossierLabel(ctx, title, pw - 80), px + 22, py + 16);
      ctx.fillStyle = '#ffcc44';
      ctx.font = 'bold 13px "Courier New", monospace';
      ctx.fillText(`CONFIRMED KILLS  ${kills}`, px + 22, py + 42);

      drawDossierPreview(ctx, dossierPopup, px + pw * 0.26, py + ph * 0.58, boss ? 4.2 : 5.0);

      ctx.font = '13px "Courier New", monospace';
      ctx.fillStyle = P.ui.text;
      const statsX = px + pw * 0.5;
      let sy = py + 78;
      const lines = boss
        ? [
            `HUNTER    ACT ${boss.act}${boss.final ? '  FINAL' : ''}`,
            `HULL      ${boss.hp}`,
            `ESCORTS   ${boss.bodyguards}`,
          ]
        : [
            `CLASS     ${(def?.category || 'unknown').toUpperCase()}`,
            `BEHAVIOR  ${(def?.behavior || '—').toUpperCase()}`,
            `HULL      ${def?.hp ?? '—'}`,
            `SPEED     ${def?.speed ?? '—'}`,
            `VALUE     ${def?.points ?? 0} PTS`,
            `ARRIVES   ACT ${def?.minAct ?? 1}`,
          ];
      for (const line of lines) {
        ctx.fillText(line, statsX, sy);
        sy += 22;
      }
      const blurb = boss?.blurb || def?.blurb;
      if (blurb) {
        ctx.fillStyle = P.ui.textDim;
        ctx.font = '12px "Courier New", monospace';
        sy += 8;
        for (const line of wrapDossierLines(ctx, blurb, pw * 0.46)) {
          ctx.fillText(line, statsX, sy);
          sy += 16;
        }
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

let achievementNavBoxes = [];

export const achievementsScreen = {
  draw(ctx, cam) {
    const w = cam.screenW;
    const h = cam.screenH;
    const career = careerOrEmpty();
    ctx.save();
    ctx.scale(cam.dpr, cam.dpr);
    const unlocked = career.achievements || {};
    const got = achievementCount(career);
    const L = paintScreenBackdrop(
      ctx,
      w,
      h,
      'ACHIEVEMENTS',
      `${got} / ${ACHIEVEMENTS.length} UNLOCKED`
    );
    drawHeaderDollars(ctx, L, career.dollars);
    const gap = 10;
    const cols = L.landscape && L.content.w >= 560 ? 2 : 1;
    const rows = Math.ceil(ACHIEVEMENTS.length / cols);
    const cardW = (L.content.w - gap * (cols - 1)) / cols;
    const cardH = Math.min(72, (L.content.h - gap * (rows - 1)) / rows);
    for (let i = 0; i < ACHIEVEMENTS.length; i++) {
      const row = ACHIEVEMENTS[i];
      const col = i % cols;
      const r = Math.floor(i / cols);
      const rect = {
        x: L.content.x + col * (cardW + gap),
        y: L.content.y + r * (cardH + gap),
        w: cardW,
        h: cardH,
      };
      const on = Boolean(unlocked[row.id]);
      ctx.fillStyle = on ? 'rgba(28,52,22,0.92)' : 'rgba(8,12,8,0.72)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = on ? 'rgba(170,255,136,0.7)' : 'rgba(70,90,70,0.35)';
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = 'bold 14px "Courier New", monospace';
      ctx.fillStyle = on ? P.ui.textBright : P.ui.textDim;
      ctx.fillText(on ? row.name : '????', rect.x + 14, rect.y + 12);
      ctx.font = '12px "Courier New", monospace';
      ctx.fillStyle = on ? P.ui.text : 'rgba(90,110,90,0.7)';
      ctx.fillText(on ? row.desc : 'LOCKED', rect.x + 14, rect.y + 34);
    }
    const nav = footerNavRects(L, ['◂ CAMPAIGN']);
    achievementNavBoxes = nav;
    drawMenuButton(ctx, nav[0], { label: nav[0].label });
    ctx.restore();
  },
};

export function handleAchievementsClick(px, py, dpr) {
  for (const box of achievementNavBoxes) {
    if (
      px >= box.x * dpr &&
      px <= (box.x + box.w) * dpr &&
      py >= box.y * dpr &&
      py <= (box.y + box.h) * dpr
    ) {
      return 'back';
    }
  }
  return false;
}

export { saveCareer, clamp };
