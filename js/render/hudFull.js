/**
 * Full sortie HUD. Chrome hugs the edges; the playfield stays open.
 */
import { P } from '../palette.js';
import { TIMER } from '../config.js';
import { CAMPAIGN_RULES } from '../contracts.js';
import { clamp } from '../rng.js';
import { layoutSortieHud } from '../ui/hudLayout.js';
import { hudFascia, hudHairline, hudMeter, ellipsize, drawOffscreenMarker } from './hud.js';

function wrapPx(ctx, text, maxW, maxLines) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxW) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = ellipsize(ctx, lines[maxLines - 1], maxW);
  }
  return lines.length ? lines : [''];
}

function drawDamageVignette(ctx, layout, heli) {
  const hpPct = heli.hp / heli.maxHp;
  if (hpPct >= 0.35) return;
  const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 160);
  const a = heli.noFlinch
    ? 0
    : (1 - hpPct / 0.35) * 0.38 * pulse * (1 - (heli.redScreenRed || 0));
  const vg = ctx.createRadialGradient(
    layout.W / 2,
    layout.H / 2,
    Math.min(layout.W, layout.H) * 0.32,
    layout.W / 2,
    layout.H / 2,
    Math.max(layout.W, layout.H) * 0.72
  );
  vg.addColorStop(0, 'rgba(180,20,20,0)');
  vg.addColorStop(1, `rgba(180,20,20,${a.toFixed(3)})`);
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, layout.W, layout.H);
}

function drawTopBand(ctx, layout, bag) {
  const { heli, sortieState, hudAnim, dt, practice, intel, objectiveText, heatLabels } = bag;
  const { band, mission, hull, status } = layout;

  hudFascia(ctx, band);
  hudHairline(ctx, hull.x, band.y + 8, hull.x, band.y + band.h - 8);
  hudHairline(ctx, status.x, band.y + 8, status.x, band.y + band.h - 8);

  // ── Mission ──
  {
    const padX = 10;
    const maxW = mission.w - padX * 2;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 8px "Courier New", monospace';
    ctx.fillStyle = P.ui.textDim;
    const kicker = practice ? 'RANGE' : 'OBJECTIVE';
    ctx.fillText(kicker, mission.x + padX, mission.y + 6);
    if (practice) {
      const kw = ctx.measureText(kicker).width;
      ctx.fillStyle = '#ffcc44';
      ctx.fillText(' · NO PAY', mission.x + padX + kw, mission.y + 6);
    }

    ctx.font = layout.compact ? 'bold 11px "Courier New", monospace' : 'bold 12px "Courier New", monospace';
    const done = sortieState.objectiveComplete;
    ctx.fillStyle = done ? '#44ddff' : '#ffcc44';
    const showIntel = intel && !intel.complete;
    const lines = wrapPx(ctx, objectiveText, maxW, showIntel ? 1 : 2);
    let ty = mission.y + 18;
    for (const line of lines) {
      ctx.fillText(ellipsize(ctx, line, maxW), mission.x + padX, ty);
      ty += 14;
    }
    if (showIntel && !/INTEL/.test(objectiveText)) {
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.fillStyle = '#88eeff';
      ctx.fillText(`INTEL ${intel.secured}/${intel.required}`, mission.x + padX, ty);
    } else if (
      bag.world?.objective &&
      !done &&
      bag.world.objective.type === 'suppression' &&
      !showIntel
    ) {
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.fillStyle = P.ui.textDim;
      ctx.fillText(
        `${bag.world.objective.progress}/${bag.world.objective.requiredCount}`,
        mission.x + padX,
        ty
      );
    }
  }

  // ── Hull + hunter clock ──
  {
    const hpPct = heli.hp / heli.maxHp;
    hudAnim.hp += (heli.hp - hudAnim.hp) * Math.min(1, 10 * (dt || 0.016));
    hudAnim.hpFlash = Math.max(0, (hudAnim.hpFlash || 0) - (dt || 0.016));

    let label = 'HULL';
    let labelCol = P.ui.text;
    if (hpPct <= 0.25) {
      label = 'CRIT';
      labelCol = '#ff4444';
    } else if (hpPct <= 0.5) {
      label = 'DMGD';
      labelCol = P.ui.hpMed;
    }
    const lowPulse = hpPct <= 0.25 ? 0.55 + 0.45 * Math.sin(performance.now() / 120) : 1;
    const num = `${Math.round(Math.max(0, heli.hp))}/${Math.round(heli.maxHp)}`;
    const padX = 12;
    const inner = hull.w - padX * 2;
    const barH = layout.compact ? 8 : 9;
    const eta = hunterEta(bag);
    const barY = hull.y + (eta ? 16 : hull.h / 2 - barH / 2);

    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.globalAlpha = lowPulse;
    ctx.fillStyle = labelCol;
    ctx.fillText(label, hull.x + padX, hull.y + 6);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'right';
    ctx.fillStyle = P.ui.text;
    ctx.fillText(num, hull.x + hull.w - padX, hull.y + 6);

    const hpCol = hpPct > 0.5 ? P.ui.hp : hpPct > 0.25 ? P.ui.hpMed : P.ui.hpLow;
    hudMeter(ctx, hull.x + padX, barY, inner, barH, hpPct, hpCol, {
      shown: hudAnim.hp / heli.maxHp,
      flash: hudAnim.hpFlash,
      border: P.ui.hpBorder,
    });

    if (eta) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.fillStyle = eta.flash ? '#ff4444' : P.ui.textBright;
      ctx.fillText(eta.label, hull.x + hull.w / 2, barY + barH + 3);
      ctx.fillStyle = eta.urgent ? 'rgba(255,68,68,0.85)' : 'rgba(120,180,100,0.55)';
      ctx.fillRect(hull.x + padX, hull.y + hull.h - 4, inner * eta.frac, 2);
    }
  }

  // ── Status ──
  {
    const fearThreshold = bag.fearThreshold || 10;
    hudAnim.fear +=
      (clamp(heli.fear / fearThreshold, 0, 1) - hudAnim.fear) * Math.min(1, 8 * (dt || 0.016));
    hudAnim.heat +=
      (sortieState.heat.value / 100 - hudAnim.heat) * Math.min(1, 8 * (dt || 0.016));
    const padX = 10;
    const meterW = status.w - padX * 2;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 8px "Courier New", monospace';
    ctx.fillStyle = P.ui.textDim;
    ctx.fillText('SCORE', status.x + padX, status.y + 5);
    ctx.textAlign = 'right';
    ctx.font = 'bold 13px "Courier New", monospace';
    ctx.fillStyle = P.ui.infamy;
    ctx.fillText(`${heli.score}`, status.x + status.w - padX, status.y + 4);

    const heatCols = [P.ui.hp, P.ui.hpMed, '#ff8844', '#ff5533', '#ff2222'];
    const heatName = (heatLabels || [])[sortieState.heat.tier] || 'HEAT';
    const labelW = 36;
    ctx.textAlign = 'left';
    ctx.font = 'bold 8px "Courier New", monospace';
    ctx.fillStyle = '#ff8844';
    ctx.fillText('FEAR', status.x + padX, status.y + 20);
    hudMeter(
      ctx,
      status.x + padX + labelW,
      status.y + 21,
      Math.max(16, meterW - labelW),
      4,
      heli.fear / fearThreshold,
      '#cc8833',
      { shown: hudAnim.fear }
    );
    ctx.fillStyle = heatCols[Math.min(sortieState.heat.tier, heatCols.length - 1)];
    ctx.fillText(ellipsize(ctx, heatName, labelW), status.x + padX, status.y + status.h - 12);
    hudMeter(
      ctx,
      status.x + padX + labelW,
      status.y + status.h - 11,
      Math.max(16, meterW - labelW),
      4,
      sortieState.heat.value / 100,
      sortieState.heat.tier >= 3 ? '#ff4444' : '#cc6633',
      { shown: hudAnim.heat }
    );
  }
}

function hunterEta(bag) {
  const { bossState, sortieState, contract } = bag;
  const strongholdClock = contract?.stronghold && sortieState.strongholdTimeRemaining > 0;
  if (!(bossState.active && !bossState.defeated) && !strongholdClock) return null;
  const remaining = strongholdClock ? sortieState.strongholdTimeRemaining : bossState.timeRemaining;
  const secs = Math.max(0, Math.ceil(remaining));
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  const urgent = remaining < 30;
  const flash = urgent && Math.sin(performance.now() / 200) > 0;
  const baseT = Math.max(1, strongholdClock ? CAMPAIGN_RULES.strongholdTime : TIMER.baseTime);
  return {
    label: `${strongholdClock ? 'HOLD ' : 'ETA '}${mins}:${rem.toString().padStart(2, '0')}`,
    urgent,
    flash,
    frac: clamp(remaining / baseT, 0, 1),
  };
}

function drawBossHp(ctx, layout, boss) {
  if (!layout.bossBar || !boss.spawned || boss.state === 'dead') return;
  const r = layout.bossBar;
  hudFascia(ctx, r, { accent: 'rgba(255,68,68,0.55)', radius: 4 });
  const barX = r.x + 10;
  const barW = r.w - 20;
  const barY = r.y + r.h - 8;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(barX, barY, barW, 4);
  const pct = clamp(boss.hp / boss.maxHp, 0, 1);
  ctx.fillStyle = pct > 0.5 ? '#cc4444' : pct > 0.25 ? '#ff6644' : '#ff2222';
  ctx.fillRect(barX, barY, barW * pct, 4);
  ctx.fillStyle = '#ff8888';
  ctx.font = 'bold 9px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(ellipsize(ctx, boss.name || 'HIND', barW), r.x + r.w / 2, r.y + 3);
}

function drawTargetReticle(ctx, bag) {
  const { heli, cam, uiS, boss } = bag;
  if (!heli.target) return;
  const ts = cam.worldToScreen(heli.target.x, heli.target.y);
  ts.x /= uiS;
  ts.y /= uiS;
  const retCol =
    heli.target === boss
      ? P.ui.enemy
      : heli.targetMode === 'infrastructure'
        ? '#44cccc'
        : heli.targetMode === 'strongest'
          ? '#ff8844'
          : P.ui.enemy;
  ctx.save();
  ctx.translate(ts.x, ts.y);
  ctx.rotate(performance.now() / 2400);
  ctx.strokeStyle = retCol;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 16, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(22, 0);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = retCol;
  ctx.beginPath();
  ctx.arc(ts.x, ts.y, 2, 0, Math.PI * 2);
  ctx.fill();
  if (heli.target.hp !== undefined && heli.target.maxHp) {
    const bw2 = 40;
    ctx.fillStyle = 'rgba(10,16,10,0.85)';
    ctx.fillRect(ts.x - bw2 / 2, ts.y + 14, bw2, 3);
    ctx.fillStyle = retCol;
    ctx.fillRect(
      ts.x - bw2 / 2,
      ts.y + 14,
      bw2 * clamp(heli.target.hp / heli.target.maxHp, 0, 1),
      3
    );
  }
  const tRange = Math.round(Math.hypot(heli.target.x - heli.x, heli.target.y - heli.y) / 10) * 10;
  ctx.font = '9px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = retCol;
  let label = 'TARGET';
  if (heli.target === boss) label = 'HIND PURSUIT GUNSHIP';
  else if (Array.isArray(heli.target.route)) label = 'CONVOY';
  else if (heli.target.type)
    label =
      heli.target.special === 'radar'
        ? 'RADAR'
        : heli.target.special === 'fuel'
          ? 'FUEL TANK'
          : heli.target.type.toUpperCase();
  else if (heli.target.category === 'vehicle')
    label = (heli.target.weaponName || heli.target.className || 'VEHICLE').toUpperCase();
  else if (heli.target.category === 'emplacement')
    label = (heli.target.weaponName || heli.target.className || 'EMPLACEMENT').toUpperCase();
  else if (heli.target.weaponName) label = heli.target.weaponName;
  else if (heli.target.className) label = heli.target.className.toUpperCase();
  if (heli.manualTarget === heli.target) label = 'LCK · ' + label;
  ctx.fillText(label, ts.x, ts.y - 26);
  ctx.fillStyle = '#ffaa88';
  ctx.fillText(`${tRange} m`, ts.x, ts.y + 22);
}

function drawTacticalRadar(ctx, layout, bag) {
  const { world, heli, boss, camera, intel, getMiniRoads, nearestExitPoint } = bag;
  if (!world) return;
  const { radar } = layout;
  const mmS = radar.w;
  const mmX = radar.x;
  const mmY = radar.y;
  const R = mmS / 2;
  const ccx = mmX + R;
  const ccy = mmY + R;

  ctx.fillStyle = 'rgba(5,12,6,0.82)';
  ctx.beginPath();
  ctx.arc(ccx, ccy, R + 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(110,170,100,0.5)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(ccx, ccy, R + 3, 0, Math.PI * 2);
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.arc(ccx, ccy, R, 0, Math.PI * 2);
  ctx.clip();

  const half = world.worldSize / 2;
  const k = mmS / world.worldSize;
  const mx = (wx) => mmX + (wx + half) * k;
  const my = (wy) => mmY + (wy + half) * k;

  ctx.strokeStyle = 'rgba(90,160,80,0.2)';
  ctx.lineWidth = 1;
  for (const rr of [0.33, 0.66, 1]) {
    ctx.beginPath();
    ctx.arc(ccx, ccy, R * rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(ccx - R, ccy);
  ctx.lineTo(ccx + R, ccy);
  ctx.moveTo(ccx, ccy - R);
  ctx.lineTo(ccx, ccy + R);
  ctx.stroke();

  ctx.drawImage(getMiniRoads(mmS), mmX, mmY);

  const sweepAng = performance.now() / 900;
  ctx.save();
  ctx.translate(ccx, ccy);
  ctx.rotate(sweepAng);
  ctx.strokeStyle = 'rgba(120,220,110,0.28)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(R, 0);
  ctx.stroke();
  ctx.restore();

  {
    const vb = camera.getVisibleBounds();
    ctx.strokeStyle = 'rgba(200,255,180,0.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx(vb.left), my(vb.top), (vb.right - vb.left) * k, (vb.bottom - vb.top) * k);
  }

  const nowMs = performance.now();
  if (heli.reconPulse) {
    if (!heli._nextPulse) heli._nextPulse = nowMs + 30000;
    if (nowMs > heli._nextPulse) {
      heli._reconUntil = nowMs + 10000;
      heli._nextPulse = nowMs + 30000;
    }
  }
  const reconActive = heli._reconUntil > nowMs;
  const revealR = 1900 * (heli.radarRange || 1);
  const blipAlpha = (wx, wy) => {
    if (reconActive || heli.fullSpectrum) return 1;
    const d = Math.hypot(wx - heli.x, wy - heli.y);
    return d < revealR ? 1 : 0.25;
  };

  for (const place of world.places) {
    ctx.globalAlpha = blipAlpha(place.x, place.y) * (place.discovered ? 0.9 : 0.38);
    ctx.fillStyle =
      place.category === 'military'
        ? 'rgba(190,120,70,0.42)'
        : place.category === 'industrial'
          ? 'rgba(190,165,95,0.38)'
          : 'rgba(220,195,120,0.30)';
    ctx.strokeStyle =
      place.category === 'military' ? 'rgba(255,130,90,0.75)' : 'rgba(225,205,145,0.62)';
    ctx.lineWidth = 0.8;
    const polygon = place.footprint || [];
    if (polygon.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(mx(polygon[0].x), my(polygon[0].y));
      for (let i = 1; i < polygon.length; i++) ctx.lineTo(mx(polygon[i].x), my(polygon[i].y));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(mx(place.x) - 1.5, my(place.y) - 1.5, 3, 3);
    }
  }
  ctx.globalAlpha = 1;

  for (const encounter of world.encounters) {
    if (!encounter.discovered && blipAlpha(encounter.x, encounter.y) < 1) continue;
    ctx.globalAlpha = encounter.discovered ? 1 : 0.35;
    ctx.fillStyle = encounter.cleared ? '#3f7f3f' : '#ff5544';
    ctx.beginPath();
    ctx.arc(mx(encounter.x), my(encounter.y), encounter.cleared ? 1.8 : 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const holders = world.objective?.intel?.holders || [];
  if (intel && !intel.complete) {
    for (const h of holders) {
      if (h.destroyed || h.intelTaken) continue;
      const pr = 3.2 + Math.sin(performance.now() / 180) * 1.1;
      ctx.strokeStyle = '#44ddff';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(mx(h.x), my(h.y), pr, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  const objectiveTarget = world.objective?.target;
  if (objectiveTarget && !objectiveTarget.objectiveHidden) {
    const pr = 4 + Math.sin(performance.now() / 180) * 1.5;
    ctx.strokeStyle = '#ffcc44';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(mx(objectiveTarget.x), my(objectiveTarget.y), pr, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const c of world.convoys) {
    if (c.destroyed || !c.active) continue;
    ctx.globalAlpha = blipAlpha(c.x, c.y);
    const cx2 = mx(c.x);
    const cy2 = my(c.y);
    ctx.strokeStyle = '#ff8844';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx2 - Math.cos(c.angle) * 3, cy2 - Math.sin(c.angle) * 3);
    ctx.lineTo(cx2 + Math.cos(c.angle) * 3, cy2 + Math.sin(c.angle) * 3);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  for (const d of world.fuelDepots || []) {
    if (d.destroyed) continue;
    ctx.globalAlpha = blipAlpha(d.x, d.y);
    ctx.fillStyle = '#ff8844';
    ctx.save();
    ctx.translate(mx(d.x), my(d.y));
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-2, -2, 4, 4);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  if (world.extraction?.active) {
    const ep = nearestExitPoint();
    const lim = bag.playableLimit(world);
    ctx.strokeStyle = '#44ddff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    if (ep.card === 'N') {
      ctx.moveTo(mx(-lim), my(-lim));
      ctx.lineTo(mx(lim), my(-lim));
    } else if (ep.card === 'S') {
      ctx.moveTo(mx(-lim), my(lim));
      ctx.lineTo(mx(lim), my(lim));
    } else if (ep.card === 'W') {
      ctx.moveTo(mx(-lim), my(-lim));
      ctx.lineTo(mx(-lim), my(lim));
    } else {
      ctx.moveTo(mx(lim), my(-lim));
      ctx.lineTo(mx(lim), my(lim));
    }
    ctx.stroke();
  }
  if (boss.spawned && boss.state !== 'dead') {
    ctx.fillStyle = '#ff2222';
    ctx.beginPath();
    ctx.arc(mx(boss.x), my(boss.y), 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.save();
  ctx.translate(mx(heli.x), my(heli.y));
  ctx.rotate(heli.angle);
  ctx.fillStyle = '#66ff66';
  ctx.beginPath();
  ctx.moveTo(5, 0);
  ctx.lineTo(-4, -3.5);
  ctx.lineTo(-4, 3.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.restore();

  ctx.fillStyle = 'rgba(170,255,136,0.85)';
  ctx.font = 'bold 8px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', ccx, mmY + 10);

  const clearedN = world.encounters.filter((encounter) => encounter.cleared).length;
  const totalEncounters = world.encounters.length;
  ctx.fillStyle = 'rgba(200,180,90,0.8)';
  ctx.font = 'bold 8px "Courier New", monospace';
  ctx.fillText(`${clearedN}/${totalEncounters}`, ccx, mmY + mmS - 11);
}

function drawCompass(ctx, layout, bag) {
  const { compass, dock } = layout;
  if (dock) hudFascia(ctx, dock, { radius: 6 });
  if (!compass) return;
  const { heli, world, getObjectiveFocus, nearestExitPoint } = bag;
  const { x, y, w, h } = compass;
  const tapeH = Math.min(48, Math.max(28, h - 22));
  const cx = x + w / 2;
  const tapeY = y + 4;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 4, tapeY, w - 8, tapeH);
  ctx.clip();
  const headingDeg = ((heli.angle * 180) / Math.PI + 90 + 360) % 360;
  const pxPerDeg = Math.max(1.6, Math.min(2.4, w / 160));
  ctx.font = 'bold 10px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let d = Math.floor((headingDeg - 90) / 15) * 15; d <= headingDeg + 90; d += 15) {
    const tickX = cx + (d - headingDeg) * pxPerDeg;
    const dd = ((d % 360) + 360) % 360;
    const major = dd % 90 === 0;
    ctx.strokeStyle = major ? 'rgba(170,255,136,0.85)' : 'rgba(120,160,100,0.38)';
    ctx.lineWidth = major ? 1.6 : 1;
    ctx.beginPath();
    ctx.moveTo(tickX, tapeY + 4);
    ctx.lineTo(tickX, tapeY + (major ? 16 : 10));
    ctx.stroke();
    if (major) {
      const lbl = ['N', 'E', 'S', 'W'][dd / 90];
      ctx.fillStyle = lbl === 'N' ? '#aaff88' : P.ui.textDim;
      ctx.fillText(lbl, tickX, tapeY + 26);
    }
  }
  const bearingMarker = (wx, wy, col) => {
    const b = ((Math.atan2(wy - heli.y, wx - heli.x) * 180) / Math.PI + 90 + 360) % 360;
    let off = b - headingDeg;
    while (off > 180) off -= 360;
    while (off < -180) off += 360;
    const bx = cx + clamp(off, -80, 80) * pxPerDeg;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(bx, tapeY + 2);
    ctx.lineTo(bx - 3.4, tapeY - 4);
    ctx.lineTo(bx + 3.4, tapeY - 4);
    ctx.closePath();
    ctx.fill();
  };
  const objFocusC = getObjectiveFocus();
  if (objFocusC) bearingMarker(objFocusC.x, objFocusC.y, '#ffcc44');
  if (world?.extraction?.active) {
    const ep = nearestExitPoint();
    bearingMarker(ep.x, ep.y, '#44ddff');
  }
  ctx.fillStyle = P.ui.textBright;
  ctx.beginPath();
  ctx.moveTo(cx, tapeY + 1);
  ctx.lineTo(cx - 5, tapeY - 5);
  ctx.lineTo(cx + 5, tapeY - 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const spdNow = Math.round(Math.hypot(heli.vx, heli.vy));
  const secs = Math.floor((performance.now() - bag.sortieStartedAt) / 1000);
  const tStr = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const readY = y + h - 8;
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 10px "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = P.ui.textBright;
  ctx.fillText(`${Math.round(headingDeg).toString().padStart(3, '0')}°`, x + 8, readY);
  ctx.textAlign = 'center';
  ctx.fillStyle = P.ui.textDim;
  ctx.fillText(`${spdNow} SPD`, cx, readY);
  ctx.textAlign = 'right';
  ctx.fillText(
    `${tStr}  ${bag.sortieState.stats.kills}K`,
    x + w - 8,
    readY
  );
}

function drawActionCluster(ctx, layout, bag) {
  const { heli, input, isTouch, equipment, sortieState, pushHit, modeToastUntil } = bag;
  const modeLabel =
    { closest: 'CLOSEST', strongest: 'STRONGEST', infrastructure: 'INFRA' }[heli.targetMode] ||
    'CLOSEST';
  const toastHot = performance.now() < modeToastUntil;
  hudFascia(ctx, layout.mode, {
    accent: toastHot ? 'rgba(68,220,200,0.85)' : 'rgba(110,160,100,0.5)',
    radius: 4,
  });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const modeTall = layout.mode.h >= 40;
  ctx.font = 'bold 8px "Courier New", monospace';
  ctx.fillStyle = P.ui.textDim;
  if (modeTall) {
    const hint = isTouch ? 'TGT' : 'TGT  V';
    ctx.fillText(hint, layout.mode.x + layout.mode.w / 2, layout.mode.y + 11);
  }
  ctx.font = 'bold 12px "Courier New", monospace';
  ctx.fillStyle = P.ui.textBright;
  ctx.fillText(
    modeLabel,
    layout.mode.x + layout.mode.w / 2,
    layout.mode.y + (modeTall ? layout.mode.h / 2 + 4 : layout.mode.h / 2)
  );
  if (input.autofire || input.clickToTarget) {
    ctx.font = 'bold 7px "Courier New", monospace';
    ctx.fillStyle = P.ui.rocket;
    const flags = [input.autofire ? 'AUTO' : null, input.clickToTarget ? 'CLK' : null]
      .filter(Boolean)
      .join(' · ');
    ctx.fillText(flags, layout.mode.x + layout.mode.w / 2, layout.mode.y + layout.mode.h - 8);
  }
  pushHit(layout.mode, 'mode');

  const eq = heli.equipmentType && equipment[heli.equipmentType];
  const ready = sortieState.status === 'active' && eq && !heli.equipmentUsed;
  hudFascia(ctx, layout.equip, {
    accent: ready ? 'rgba(68,220,200,0.9)' : 'rgba(90,140,80,0.4)',
    radius: 4,
  });
  ctx.font = 'bold 8px "Courier New", monospace';
  ctx.fillStyle = ready ? '#88eeee' : P.ui.textDim;
  const eqHint = !eq ? 'EQUIP' : heli.equipmentUsed ? 'USED' : isTouch ? 'EQUIP' : 'EQUIP  E';
  ctx.fillText(eqHint, layout.equip.x + layout.equip.w / 2, layout.equip.y + 11);
  ctx.font = 'bold 11px "Courier New", monospace';
  ctx.fillStyle = ready ? P.ui.textBright : P.ui.textDim;
  const kitName = ellipsize(ctx, eq ? eq.name : 'NO KIT', layout.equip.w - 12);
  ctx.fillText(kitName, layout.equip.x + layout.equip.w / 2, layout.equip.y + layout.equip.h / 2 + 4);
  if (heli.hasMissiles) {
    const mslReady = (heli.missileCooldown || 0) <= 0;
    ctx.font = 'bold 7px "Courier New", monospace';
    ctx.fillStyle = mslReady ? '#ff8844' : P.ui.textDim;
    ctx.fillText(
      mslReady ? 'MSL' : `MSL ${Math.ceil(heli.missileCooldown)}s`,
      layout.equip.x + layout.equip.w / 2,
      layout.equip.y + layout.equip.h - 9
    );
  }
  if (ready) pushHit(layout.equip, 'equipment');
}

function drawMarkers(ctx, layout, bag) {
  const focus = bag.getObjectiveFocus();
  if (focus) {
    const intel = bag.intel || { complete: true };
    drawOffscreenMarker(
      ctx,
      bag.camera,
      layout.W,
      layout.H,
      focus.x,
      focus.y,
      intel.complete ? '#ff5544' : '#44ddff',
      intel.complete ? '#ff9966' : '#88eeff',
      intel.complete ? null : 'INTEL',
      bag.uiS,
      layout.markerMargins
    );
  }
  if (bag.world?.extraction?.active) {
    const ep = bag.nearestExitPoint();
    drawOffscreenMarker(
      ctx,
      bag.camera,
      layout.W,
      layout.H,
      ep.x,
      ep.y,
      '#44ddff',
      '#88ddff',
      `EXIT ${ep.card}`,
      bag.uiS,
      layout.markerMargins
    );
  }
}

function drawHints(ctx, layout, bag) {
  const now = performance.now();
  if (now < bag.modeToastUntil) {
    const MODE_HELP = {
      closest: 'nearest hostile in weapons range',
      strongest: 'hostile with highest damage per second',
      infrastructure: 'buildings & convoys only',
    };
    const alpha = Math.min(1, (bag.modeToastUntil - now) / 600);
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#88eeee';
    ctx.fillText(MODE_HELP[bag.heli.targetMode] || '', layout.W / 2, layout.topReserve + 2);
    ctx.globalAlpha = 1;
  }

  const age = (now - bag.sortieStartedAt) / 1000;
  const alpha = clamp(1 - (age - 12) / 4, 0, 1) * 0.65;
  if (alpha > 0.01) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = P.ui.text;
    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(
      bag.isTouch ? 'JOYSTICK  ·  FIRE  ·  TGT  ·  EQUIP' : 'WASD  ·  AIM  ·  FIRE  ·  V  ·  E  ·  P',
      layout.W / 2,
      layout.hintY
    );
    ctx.globalAlpha = 1;
  }

  if (bag.bossState.warning && !bag.bossState.spawned) {
    const flash = Math.sin(now / 150) > 0;
    if (flash) {
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth = 4;
      ctx.strokeRect(6, 6, layout.W - 12, layout.H - 12);
    }
    ctx.fillStyle = '#ff4444';
    ctx.font = 'bold 16px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('! INCOMING HOSTILE !', layout.W / 2, layout.H / 2 - 24);
    ctx.font = '12px "Courier New", monospace';
    ctx.fillText(`ARRIVING IN ${Math.ceil(bag.bossState.warningTimer)}s`, layout.W / 2, layout.H / 2);
  }
}

export function drawSortieHud(ctx, bag) {
  const showBossHp = Boolean(bag.boss.spawned && bag.boss.state !== 'dead');
  const showToast = performance.now() < bag.modeToastUntil;
  const layout = layoutSortieHud(bag.W, bag.H, { showBossHp, showToast });
  drawDamageVignette(ctx, layout, bag.heli);
  drawTargetReticle(ctx, bag);
  drawTopBand(ctx, layout, bag);
  drawBossHp(ctx, layout, bag.boss);
  drawCompass(ctx, layout, bag);
  drawTacticalRadar(ctx, layout, bag);
  drawActionCluster(ctx, layout, bag);
  drawMarkers(ctx, layout, bag);
  drawHints(ctx, layout, bag);
  return layout;
}
