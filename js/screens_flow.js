/**
 * Front-end flow: splash → main menu → new/load pilot → campaign.
 * Portrait builder (Mii-style face) is intentionally later.
 */
import { P } from './palette.js';
import {
  drawMenuButton,
  drawBackButton,
  layoutOf,
  paintBackdrop,
  paintScreenBackdrop,
  applyMenuHitTransform,
  paintMenuGlow,
  footerPairRects,
} from './appBridge.js';
import {
  createCareer,
  createPilot,
  randomNameParts,
  setPilotName,
  listPilotSlots,
  activatePilotSlot,
  addCareerToRoster,
  loadCareer,
} from './meta.js';

export let flowBoxes = [];
export let splashUntil = 0;

const NAME_LIMITS = { first: 14, callsign: 10, last: 16 };

export const draftPilot = {
  first: '',
  callsign: '',
  last: '',
  culture: null,
  focus: null,
};

export function resetDraftPilot(seed) {
  const parts = randomNameParts(seed);
  draftPilot.first = parts.first;
  draftPilot.callsign = parts.callsign;
  draftPilot.last = parts.last;
  draftPilot.culture = parts.culture;
  draftPilot.focus = null;
  hideNameField();
}

function ensureNameInput() {
  if (typeof document === 'undefined') return null;
  let el = document.getElementById('pilot-name');
  if (!el) {
    el = document.createElement('input');
    el.id = 'pilot-name';
    el.maxLength = 16;
    el.autocomplete = 'off';
    el.spellcheck = false;
    el.addEventListener('click', (e) => e.stopPropagation());
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('input', () => {
      if (!draftPilot.focus) return;
      const key = draftPilot.focus;
      let value = el.value;
      if (key === 'callsign') value = value.toUpperCase();
      draftPilot[key] = value.slice(0, NAME_LIMITS[key]);
      el.value = draftPilot[key];
    });
    document.body.appendChild(el);
  }
  return el;
}

export function hideNameField() {
  const el = typeof document !== 'undefined' ? document.getElementById('pilot-name') : null;
  if (!el) return;
  el.classList.remove('visible');
  el.blur();
}

function placeNameField(rect, key) {
  const el = ensureNameInput();
  if (!el || !rect) return;
  const switched = draftPilot.focus !== key;
  draftPilot.focus = key;
  el.maxLength = NAME_LIMITS[key];
  if (switched) el.value = draftPilot[key] || '';
  el.style.left = `${rect.x}px`;
  el.style.top = `${rect.y}px`;
  el.style.width = `${rect.w}px`;
  el.style.height = `${rect.h}px`;
  el.classList.add('visible');
  if (document.activeElement !== el) el.focus();
}

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

export const splashScreen = {
  enter() {
    splashUntil = performance.now() + 2000;
    hideNameField();
  },
  tick() {
    if (performance.now() >= splashUntil) return { type: 'switch', name: 'menu' };
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
    ctx.fillText('TAP TO CONTINUE', w / 2, h - 28);
    ctx.restore();
  },
};

export const menuScreen = {
  enter() {
    hideNameField();
  },
  draw(ctx, cam) {
    const w = cam.screenW;
    const h = cam.screenH;
    const L = layoutOf(w, h);
    ctx.save();
    ctx.scale(cam.dpr, cam.dpr);
    paintBackdrop(ctx, w, h);
    const last = listPilotSlots()[0];
    const markSize = Math.min(L.desktop ? 56 : 48, Math.max(32, Math.floor(w / 14)));
    const markY = L.content.y + markSize * 0.35 + (L.phone ? 4 : 12);
    drawWordmark(ctx, w / 2, markY, markSize);

    const entries = [
      last
        ? { label: 'CONTINUE', sub: last.name.toUpperCase(), action: 'continue' }
        : { label: 'CONTINUE', sub: 'NO SAVE', action: 'disabled' },
      { label: 'NEW PILOT', sub: 'CREATE A FRESH CAREER', action: 'newPilot' },
      {
        label: 'LOAD PILOT',
        sub: last ? `${listPilotSlots().length} ON FILE` : 'NO SAVES',
        action: last ? 'loadPilot' : 'disabled',
      },
      { label: 'OPTIONS', sub: 'CONTROLS & TOGGLES', action: 'settings' },
      { label: 'QUIT', sub: 'RETURN TO TITLE CARD', action: 'quit' },
    ];
    const menuW = Math.min(L.desktop ? 420 : 380, L.content.w);
    const menuX = (w - menuW) / 2;
    const stackH = entries.length * L.btnH + (entries.length - 1) * L.btnGap;
    const afterMark = markY + markSize * 0.85 + (L.phone ? 20 : 32);
    const avail = L.content.y + L.content.h - afterMark;
    let y = afterMark + Math.max(0, (avail - stackH) * 0.28);
    flowBoxes = [];
    for (const entry of entries) {
      const rect = { x: menuX, y, w: menuW, h: L.btnH };
      const dim = entry.action === 'disabled';
      drawMenuButton(ctx, rect, { label: entry.label, sub: entry.sub, disabled: dim });
      if (!dim) flowBoxes.push({ ...rect, action: entry.action });
      y += L.btnH + L.btnGap;
    }
    ctx.restore();
  },
};

export const newPilotScreen = {
  enter() {
    resetDraftPilot((Math.random() * 0xffffffff) >>> 0);
  },
  exit() {
    hideNameField();
  },
  draw(ctx, cam) {
    const w = cam.screenW;
    const h = cam.screenH;
    ctx.save();
    ctx.scale(cam.dpr, cam.dpr);
    const L = paintScreenBackdrop(ctx, w, h, 'NEW PILOT', 'NAME YOUR AVIATOR');
    const fields = [
      { key: 'first', label: 'GIVEN NAME' },
      { key: 'callsign', label: 'CALLSIGN' },
      { key: 'last', label: 'FAMILY NAME' },
    ];
    const fieldH = Math.max(56, L.btnH);
    const gap = L.btnGap + 4;
    const diceW = L.phone ? 68 : 80;
    const blockH = fields.length * (fieldH + 22 + gap);
    let y = L.content.y + Math.max(12, (L.content.h - blockH - 28) / 2);
    flowBoxes = [];
    for (const field of fields) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = P.ui.textDim;
      ctx.font = 'bold 11px "Courier New", monospace';
      ctx.fillText(field.label, L.content.x, y);
      y += 18;
      const fieldW = L.content.w - diceW - 12;
      const rect = { x: L.content.x, y, w: fieldW, h: fieldH };
      const dice = { x: L.content.x + fieldW + 12, y, w: diceW, h: fieldH };
      const focused = draftPilot.focus === field.key;
      ctx.save();
      const fieldHit = applyMenuHitTransform(ctx, rect);
      ctx.fillStyle = focused || fieldHit.hover ? 'rgba(68,204,204,0.14)' : 'rgba(13,33,15,0.92)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = focused || fieldHit.hover ? '#44cccc' : P.ui.borderHi;
      ctx.lineWidth = focused || fieldHit.hover ? 1.6 : 1.2;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      paintMenuGlow(ctx, rect, fieldHit, 'rgba(68,238,238,0.75)');
      if (!focused) {
        ctx.fillStyle = P.ui.textBright;
        ctx.font = 'bold 16px "Courier New", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(draftPilot[field.key] || '—', rect.x + 14, rect.y + rect.h / 2);
      }
      ctx.restore();
      drawMenuButton(ctx, dice, { label: 'DICE' });
      flowBoxes.push({ ...rect, action: 'focus', key: field.key });
      flowBoxes.push({ ...dice, action: 'dice', key: field.key });
      y += fieldH + gap;
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = P.ui.textDim;
    ctx.font = '11px "Courier New", monospace';
    ctx.fillText('TAP A FIELD TO TYPE · DICE REROLLS THAT PART', w / 2, L.content.y + L.content.h - 6);

    const pair = footerPairRects(L, { backLabel: '◂ MENU', primaryMinW: 200 });
    drawMenuButton(ctx, pair.back, { label: '◂ MENU' });
    drawMenuButton(ctx, pair.primary, { label: 'CONFIRM', kind: 'primary' });
    flowBoxes.push({ ...pair.back, action: 'menu' });
    flowBoxes.push({ ...pair.primary, action: 'confirm' });
    if (draftPilot.focus) {
      const box = flowBoxes.find((b) => b.action === 'focus' && b.key === draftPilot.focus);
      if (box) placeNameField(box, draftPilot.focus);
    }
    ctx.restore();
  },
};

export const loadPilotScreen = {
  enter() {
    hideNameField();
  },
  draw(ctx, cam) {
    const w = cam.screenW;
    const h = cam.screenH;
    ctx.save();
    ctx.scale(cam.dpr, cam.dpr);
    const L = paintScreenBackdrop(ctx, w, h, 'LOAD PILOT', 'SELECT A CAREER');
    const slots = listPilotSlots();
    flowBoxes = [];
    const rowH = Math.max(68, L.btnH + 12);
    const gap = L.btnGap;
    const listW = Math.min(640, L.content.w);
    const listX = L.content.x + (L.content.w - listW) / 2;
    slots.slice(0, 6).forEach((slot, i) => {
      const rect = {
        x: listX,
        y: L.content.y + i * (rowH + gap),
        w: listW,
        h: rowH,
      };
      if (rect.y + rect.h > L.content.y + L.content.h) return;
      ctx.save();
      const slotHit = applyMenuHitTransform(ctx, rect);
      ctx.fillStyle =
        slot.active || slotHit.hover ? 'rgba(68,204,204,0.12)' : 'rgba(13,33,15,0.92)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = slot.active || slotHit.hover ? '#44cccc' : P.ui.border;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      paintMenuGlow(ctx, rect, slotHit, 'rgba(68,238,238,0.75)');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = P.ui.textBright;
      ctx.font = 'bold 15px "Courier New", monospace';
      ctx.fillText(slot.name, rect.x + 14, rect.y + 10);
      ctx.fillStyle = P.ui.textDim;
      ctx.font = '12px "Courier New", monospace';
      ctx.fillText(
        `LV ${slot.level}  ·  ACT ${slot.act} SORTIE ${slot.sortie}  ·  $${slot.dollars}`,
        rect.x + 14,
        rect.y + 34
      );
      ctx.restore();
      flowBoxes.push({ ...rect, action: 'load', id: slot.id });
    });
    const back = drawBackButton(ctx, w, h, '◂ MENU');
    flowBoxes.push({ ...back, action: 'menu' });
    ctx.restore();
  },
};

export function confirmNewPilot() {
  if (!draftPilot.first.trim()) {
    const parts = randomNameParts(undefined, draftPilot.culture);
    draftPilot.first = draftPilot.first.trim() || parts.first;
    draftPilot.callsign = draftPilot.callsign.trim() || parts.callsign;
    draftPilot.last = draftPilot.last.trim() || parts.last;
    draftPilot.culture = draftPilot.culture || parts.culture;
  }
  const career = createCareer((Math.random() * 0xffffffff) >>> 0);
  career.pilot = createPilot((Math.random() * 0xffffffff) >>> 0);
  setPilotName(career.pilot, draftPilot);
  addCareerToRoster(career);
  hideNameField();
  return career;
}

export function continueCareer() {
  const slots = listPilotSlots();
  if (!slots.length) return null;
  return activatePilotSlot(slots[0].id) || loadCareer();
}

export function loadSlot(id) {
  return activatePilotSlot(id);
}

export function applyFlowBox(box) {
  if (box.action === 'dice') {
    const parts = randomNameParts(undefined, draftPilot.culture);
    draftPilot[box.key] = parts[box.key];
    draftPilot.culture = draftPilot.culture || parts.culture;
    if (draftPilot.focus === box.key) {
      const el = typeof document !== 'undefined' ? document.getElementById('pilot-name') : null;
      if (el) el.value = draftPilot[box.key];
    }
    return { type: 'stay' };
  }
  if (box.action === 'focus') {
    placeNameField(box, box.key);
    const el = typeof document !== 'undefined' ? document.getElementById('pilot-name') : null;
    if (el) el.select();
    return { type: 'stay' };
  }
  return { type: box.action, id: box.id };
}

export function hitFlowBox(pos, dpr) {
  for (const box of flowBoxes) {
    if (
      pos.x >= box.x * dpr &&
      pos.x <= (box.x + box.w) * dpr &&
      pos.y >= box.y * dpr &&
      pos.y <= (box.y + box.h) * dpr
    ) {
      return box;
    }
  }
  return null;
}
