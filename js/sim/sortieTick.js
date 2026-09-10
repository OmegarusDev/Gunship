/**
 * Sortie simulation tick. Screens stay in app.js; this module owns the
 * active-operation loop: targeting, flight, contacts, Hunter, convoys.
 */
import { CAMERA, TIMER, WORLD_SIZE } from '../config.js';
import { clamp } from '../rng.js';
import { updateEnemies } from './enemyAi.js';
import * as GameState from './gameState.js';
import { pickAutoTarget, pickClickedTarget, resolveLiveTarget } from './targeting.js';

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function isGroundBoss(boss) {
  return /tank|fortified|sam|aa|column|brigade|complex|ad|combined/.test(boss.type || '');
}

function fireBossPattern(boss, spawnProjectile) {
  const aim = boss.turretAngle;
  const type = boss.type || '';
  if (type === 'supergunship') {
    const phase = boss.hp / boss.maxHp;
    const count = phase < 0.5 ? 12 : phase < 0.75 ? 10 : 8;
    for (let i = 0; i < count; i++) {
      const angle = aim + (i / count) * Math.PI * 2;
      spawnProjectile(boss.x, boss.y, angle, 180 + (i % 2) * 35, boss.damage * 0.7, true, 2.8);
    }
    spawnProjectile(boss.x, boss.y, aim, 270, boss.damage * 1.3, true, 2.1);
    return;
  }
  if (type === 'fighter') {
    for (const offset of [-0.12, 0, 0.12]) {
      spawnProjectile(boss.x, boss.y, aim + offset, 360, boss.damage * 0.75, true, 1.4);
    }
    return;
  }
  if (isGroundBoss(boss)) {
    const airDefense = /sam|aa|air_defense|ad_complex|heavy_ad/.test(type);
    const offsets = airDefense ? [-0.24, -0.12, 0, 0.12, 0.24] : [-0.08, 0.08];
    for (const offset of offsets) {
      spawnProjectile(
        boss.x,
        boss.y,
        aim + offset,
        airDefense ? 300 : 250,
        boss.damage * (airDefense ? 0.65 : 0.9),
        true,
        2.0
      );
    }
    return;
  }
  spawnProjectile(boss.x, boss.y, aim - 0.07, 280, boss.damage, true, 1.8);
  spawnProjectile(boss.x, boss.y, aim + 0.07, 280, boss.damage, true, 1.8);
  spawnProjectile(boss.x, boss.y, aim, 220, boss.damage * 1.4, true, 2.1);
}

export function tickSortie(dt, deps) {
  const {
    camera,
    input,
    switchScreen,
    hudAnim,
    spawnProjectile,
    spawnExplosion,
    spawnFloatingText,
    addHeat,
    addFear,
    reduceHeat,
    discoverEncounter,
    checkEncounterClear,
    applyClearPenalty,
    checkObjectiveProgress,
    collectSupplyCrates,
    updateHeat,
    hunterClockRate,
    spawnBoss,
    hitDestructibleWorldTarget,
    finishSortie,
    getConvoyMembers,
    pointAlongRoute,
    updateExtraction,
  } = deps;

  const world = GameState.world;
  const heli = GameState.heli;
  const enemies = GameState.enemies;
  const projectiles = GameState.projectiles;
  const explosions = GameState.explosions;
  const floatingTexts = GameState.floatingTexts;
  const sortieState = GameState.sortieState;
  const boss = GameState.boss;
  const bossState = GameState.bossState;

  if (sortieState.status !== 'active') {
    sortieState.endTimer -= dt;
    if (sortieState.endTimer <= 0) switchScreen('debrief');
    return;
  }

  if (GameState.activeContract?.stronghold && sortieState.strongholdTimeRemaining > 0) {
    sortieState.strongholdTimeRemaining -= dt;
    if (sortieState.strongholdTimeRemaining <= 0) {
      sortieState.strongholdTimeRemaining = 0;
      spawnFloatingText(heli.x, heli.y - 42, 'STRONGHOLD TIMER EXPIRED', '#ff4444');
      finishSortie('failed');
      return;
    }
  }

  const TARGET_MODES = ['closest', 'strongest', 'infrastructure'];
  if (input.cycleTarget || input.cycleMode) {
    heli.targetCycleIndex = (heli.targetCycleIndex + 1) % TARGET_MODES.length;
    heli.targetMode = TARGET_MODES[heli.targetCycleIndex];
    heli.manualTarget = null;
    GameState.setModeToastUntil(performance.now() + 2600);
  }

  if (input.clickTarget && input.clickToTarget) {
    const worldPos = camera.screenToWorld(input.clickTargetX, input.clickTargetY);
    const extra = [];
    if (world?.objective?.type === 'recovery' && world.objective.target)
      extra.push(world.objective.target);
    const clicked = pickClickedTarget(world, enemies, boss, worldPos, {
      extra,
      convoyMembers: getConvoyMembers,
    });
    if (clicked) heli.manualTarget = resolveLiveTarget(world, enemies, boss, clicked) || clicked;
  }

  const liveManual = resolveLiveTarget(world, enemies, boss, heli.manualTarget);
  heli.manualTarget = liveManual;
  heli.target = pickAutoTarget({
    world,
    enemies,
    boss,
    heli,
    mode: heli.targetMode,
    manualTarget: liveManual,
  });

  let aimAngle;
  if (heli.target) {
    aimAngle = Math.atan2(heli.target.y - heli.y, heli.target.x - heli.x);
    if (heli.autoLead && heli.target.speed > 0) {
      const t = heli.target;
      const tvx = Math.cos(t.angle || 0) * t.speed;
      const tvy = Math.sin(t.angle || 0) * t.speed;
      const dist = Math.hypot(t.x - heli.x, t.y - heli.y);
      const tof = dist / heli.bulletSpeed;
      aimAngle = Math.atan2(t.y + tvy * tof - heli.y, t.x + tvx * tof - heli.x);
    }
  } else if (input.hasAim) {
    aimAngle = Math.atan2(input.aimY, input.aimX);
  } else if (input.moveX !== 0 || input.moveY !== 0) {
    aimAngle = Math.atan2(input.moveY, input.moveX);
  } else {
    aimAngle = heli.angle;
  }

  let diff = aimAngle - heli.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  heli.angle += diff * Math.min(1, 3.0 * (heli.turnMult || 1) * dt);

  if (heli.adrenalineT > 0) heli.adrenalineT -= dt;
  if (heli.flareT > 0) heli.flareT -= dt;
  const boost = heli.adrenalineT > 0 ? 1 + 0.5 * (heli.boostPotency || 1) : 1.0;
  const accel = heli.accel * boost;
  const drag = 0.91;
  const maxSpeed = heli.maxSpeed * boost;
  const mx = input.moveX;
  const my = input.moveY;
  if (mx !== 0 || my !== 0) {
    const mag = Math.hypot(mx, my);
    heli.vx += (mx / mag) * accel * mag * dt;
    heli.vy += (my / mag) * accel * mag * dt;
  } else if (input.hasAim) {
    const cx = input.canvas.clientWidth / 2;
    const cy = input.canvas.clientHeight / 2;
    const dx = input.mouseX - cx;
    const dy = input.mouseY - cy;
    const dist = Math.hypot(dx, dy);
    const maxDist = Math.min(cx, cy);
    const speedFactor = Math.min(dist / maxDist, 1);
    const thrust = accel * (0.15 + speedFactor * 0.85);
    heli.vx += input.aimX * thrust * dt;
    heli.vy += input.aimY * thrust * dt;
  }

  heli.vx *= drag;
  heli.vy *= drag;
  const spd = Math.hypot(heli.vx, heli.vy);
  if (spd > maxSpeed) {
    heli.vx = (heli.vx / spd) * maxSpeed;
    heli.vy = (heli.vy / spd) * maxSpeed;
  }

  heli.x += heli.vx * dt;
  heli.y += heli.vy * dt;
  const boundLim = world?.extraction?.active ? WORLD_SIZE * 0.55 : WORLD_SIZE * 0.48;
  heli.x = clamp(heli.x, -boundLim, boundLim);
  heli.y = clamp(heli.y, -boundLim, boundLim);
  heli.bladeAngle += 18 * dt;

  heli.fireCooldown -= dt;
  const fireRate = heli.fireRate * (heli.adrenalineT > 0 ? 0.6 : 1.0);
  const wantsFire = input.fire || (input.autofire && heli.target);
  if (wantsFire && heli.fireCooldown <= 0) {
    let aimA = heli.target
      ? Math.atan2(heli.target.y - heli.y, heli.target.x - heli.x)
      : heli.angle;
    let dmg = heli.bulletDamage;
    if (heli.target) {
      const td = Math.hypot(heli.target.x - heli.x, heli.target.y - heli.y);
      if (heli.sniperBonus && td > 250) dmg *= 1 + heli.sniperBonus;
      if (heli.markedDmg) dmg *= 1 + heli.markedDmg;
    }
    if (Math.random() < (heli.critChance || 0)) dmg *= 2;
    aimA += (Math.random() - 0.5) * 0.035 * (heli.spreadMult || 1);
    spawnProjectile(
      heli.x + Math.cos(aimA) * 20,
      heli.y + Math.sin(aimA) * 20,
      aimA,
      heli.bulletSpeed,
      Math.round(dmg)
    );
    if (Math.random() < (heli.doubleTap || 0)) {
      spawnProjectile(
        heli.x + Math.cos(aimA + 0.05) * 20,
        heli.y + Math.sin(aimA + 0.05) * 20,
        aimA + 0.05,
        heli.bulletSpeed,
        Math.round(dmg)
      );
    }
    addHeat(0.08, 'gunfire reported');
    GameState.setLastShot(heli.x, heli.y, performance.now() / 1000);
    heli.fireCooldown = fireRate;
  }

  if (
    input.equipment &&
    heli.equipmentType &&
    !heli.equipmentUsed &&
    sortieState.status === 'active'
  ) {
    heli.equipmentUsed = true;
    if (heli.equipmentType === 'repair') {
      heli.hp = Math.min(heli.maxHp, heli.hp + 40);
      spawnFloatingText(heli.x, heli.y - 34, '+40 HULL', '#44ff44');
    } else if (heli.equipmentType === 'overboost') {
      heli.adrenalineT = 6 * (heli.boostDurMult || 1);
      spawnFloatingText(heli.x, heli.y - 34, 'OVERBOOST', '#44cccc');
    } else if (heli.equipmentType === 'rocket') {
      heli.salvoShots = 6;
      heli.salvoTimer = 0;
      spawnFloatingText(heli.x, heli.y - 34, 'ROCKETS AWAY', '#ff8844');
    } else if (heli.equipmentType === 'flares') {
      heli.flareT = 3;
      spawnFloatingText(heli.x, heli.y - 34, 'FLARES DEPLOYED', '#ffdd66');
    }
  }
  if (heli.salvoShots > 0) {
    heli.salvoTimer -= dt;
    if (heli.salvoTimer <= 0) {
      const tx = heli.target ? heli.target.x : heli.x + Math.cos(heli.angle) * 400;
      const ty = heli.target ? heli.target.y : heli.y + Math.sin(heli.angle) * 400;
      const angle = Math.atan2(ty - heli.y, tx - heli.x) + (Math.random() - 0.5) * 0.14;
      spawnProjectile(
        heli.x + Math.cos(angle) * 22,
        heli.y + Math.sin(angle) * 22,
        angle,
        340,
        15,
        false,
        1.6
      );
      heli.salvoShots--;
      heli.salvoTimer = 0.12;
    }
  }

  if (world) {
    for (const place of world.places) {
      if (place.discovered) continue;
      const width =
        (place.bounds?.maxX ?? place.bounds?.x1 ?? place.x) -
        (place.bounds?.minX ?? place.bounds?.x0 ?? place.x);
      const height =
        (place.bounds?.maxY ?? place.bounds?.y1 ?? place.y) -
        (place.bounds?.minY ?? place.bounds?.y0 ?? place.y);
      const discoveryRadius = Math.max(300, Math.hypot(width, height) * 0.55 + 220);
      if (Math.hypot(place.x - heli.x, place.y - heli.y) < discoveryRadius) {
        place.discovered = true;
        sortieState.stats.places++;
      }
    }
    for (const encounter of world.encounters) {
      if (encounter.cleared) continue;
      const dist = Math.hypot(encounter.x - heli.x, encounter.y - heli.y);
      if (!encounter.discovered && dist < encounter.radius) discoverEncounter(encounter);
    }
  }

  updateEnemies(dt, {
    addHeat,
    spawnProjectile,
    lastShotX: GameState.lastShotX,
    lastShotY: GameState.lastShotY,
    lastShotT: GameState.lastShotT,
  });

  if (world) {
    for (const encounter of world.encounters) {
      if (checkEncounterClear(encounter)) applyClearPenalty(encounter);
    }
  }

  checkObjectiveProgress();
  collectSupplyCrates();
  updateHeat(dt);

  if (bossState.active && !bossState.defeated) {
    bossState.timeRemaining -= dt * hunterClockRate();
    if (
      bossState.timeRemaining <= TIMER.bossWarningTime &&
      !bossState.warning &&
      !bossState.spawned
    ) {
      bossState.warning = true;
      bossState.warningTimer = TIMER.bossWarningTime;
    }
    if (bossState.warning && !bossState.spawned) {
      bossState.warningTimer -= dt;
      if (bossState.warningTimer <= 0) {
        spawnBoss();
        bossState.warning = false;
      }
    }
    if (bossState.timeRemaining <= 0 && !bossState.spawned) {
      spawnBoss();
      bossState.warning = false;
    }
  }

  if (boss.spawned && boss.state !== 'dead') {
    const dist = Math.hypot(boss.x - heli.x, boss.y - heli.y);
    boss.phaseTimer += dt;
    const trackAngle = Math.atan2(heli.y - boss.y, heli.x - boss.x);
    let tdiff = trackAngle - boss.turretAngle;
    while (tdiff > Math.PI) tdiff -= Math.PI * 2;
    while (tdiff < -Math.PI) tdiff += Math.PI * 2;
    boss.turretAngle += tdiff * Math.min(1, 2.4 * dt);

    if (boss.state === 'approach') {
      let adiff = trackAngle - boss.angle;
      while (adiff > Math.PI) adiff -= Math.PI * 2;
      while (adiff < -Math.PI) adiff += Math.PI * 2;
      boss.angle += adiff * Math.min(1, 2.0 * dt);
      boss.x += Math.cos(boss.angle) * boss.speed * dt;
      boss.y += Math.sin(boss.angle) * boss.speed * dt;
      if (dist < boss.range * 0.9) {
        boss.state = 'attack';
        boss.phaseTimer = 0;
      }
    } else if (boss.state === 'attack') {
      const ground = isGroundBoss(boss);
      const strafeDir = boss.phaseTimer % 8 < 4 ? 1 : -1;
      const travelAngle = ground ? trackAngle : trackAngle + (Math.PI / 2) * strafeDir;
      const travelSpeed = ground ? 0.45 : 0.85;
      boss.x += Math.cos(travelAngle) * boss.speed * travelSpeed * dt;
      boss.y += Math.sin(travelAngle) * boss.speed * travelSpeed * dt;
      if (dist > boss.range * 0.8) {
        boss.x += Math.cos(trackAngle) * boss.speed * 0.55 * dt;
        boss.y += Math.sin(trackAngle) * boss.speed * 0.55 * dt;
      } else if (dist < boss.range * 0.42) {
        boss.x -= Math.cos(trackAngle) * boss.speed * 0.7 * dt;
        boss.y -= Math.sin(trackAngle) * boss.speed * 0.7 * dt;
      }
      let hdiff = travelAngle - boss.angle;
      while (hdiff > Math.PI) hdiff -= Math.PI * 2;
      while (hdiff < -Math.PI) hdiff += Math.PI * 2;
      boss.angle += hdiff * Math.min(1, 1.5 * dt);
      boss.fireCooldown -= dt;
      if (boss.fireCooldown <= 0 && dist < boss.range) {
        fireBossPattern(boss, spawnProjectile);
        boss.fireCooldown = boss.fireRate;
      }
      if (boss.hp < boss.maxHp * 0.35) {
        boss.state = 'retreat';
        boss.phaseTimer = 0;
      }
    } else if (boss.state === 'retreat') {
      const awayAngle = Math.atan2(boss.y - heli.y, boss.x - heli.x);
      let rdiff = awayAngle - boss.angle;
      while (rdiff > Math.PI) rdiff -= Math.PI * 2;
      while (rdiff < -Math.PI) rdiff += Math.PI * 2;
      boss.angle += rdiff * Math.min(1, 2.0 * dt);
      boss.x += Math.cos(boss.angle) * boss.speed * 1.15 * dt;
      boss.y += Math.sin(boss.angle) * boss.speed * 1.15 * dt;
      boss.fireCooldown -= dt;
      if (boss.fireCooldown <= 0 && dist < boss.range * 1.3) {
        spawnProjectile(boss.x, boss.y, boss.turretAngle, 250, boss.damage, true, 1.8);
        boss.fireCooldown = boss.fireRate * 1.2;
      }
      if (boss.phaseTimer > 4 || dist > 700) {
        boss.state = 'attack';
        boss.phaseTimer = 0;
      }
    }

    boss.x = clamp(boss.x, -WORLD_SIZE * 0.48, WORLD_SIZE * 0.48);
    boss.y = clamp(boss.y, -WORLD_SIZE * 0.48, WORLD_SIZE * 0.48);
    if (boss.flashTimer > 0) boss.flashTimer -= dt;
  }

  if (boss.state === 'dead') {
    boss.deathTimer -= dt;
    if (boss.deathTimer <= 0) boss.spawned = false;
  }

  if (world) {
    for (const convoy of world.convoys) {
      if (!convoy.active) {
        const dist = Math.hypot(convoy.x - heli.x, convoy.y - heli.y);
        if (dist < 1100) convoy.active = true;
        else continue;
      }
      if (convoy.destroyed) continue;
      const total = convoy.routeCum[convoy.routeCum.length - 1];
      convoy.s += convoy.direction * convoy.speed * dt;
      if (convoy.s >= total) {
        convoy.s = total;
        convoy.direction = -1;
      } else if (convoy.s <= 0) {
        convoy.s = 0;
        convoy.direction = 1;
      }
      const lead = pointAlongRoute(convoy, convoy.s);
      const dirSign = convoy.direction >= 0 ? 1 : -1;
      convoy.x = lead.x;
      convoy.y = lead.y;
      convoy.angle = lead.ang + (dirSign < 0 ? Math.PI : 0);
      if (!sortieState.levelUpOpen && sortieState.status === 'active') {
        convoy.fireCooldown -= dt;
        const d = Math.hypot(convoy.x - heli.x, convoy.y - heli.y);
        if (d < 380 && convoy.fireCooldown <= 0) {
          const fireAngle =
            Math.atan2(heli.y - convoy.y, heli.x - convoy.x) + (Math.random() - 0.5) * 0.12;
          spawnProjectile(convoy.x, convoy.y, fireAngle, 200, 3, true, 1.2);
          convoy.fireCooldown = 1.5;
          addHeat(0.35, 'convoy escort engaging');
        }
      }
      if (convoy.flashTimer > 0) convoy.flashTimer -= dt;
    }
  }

  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const ft = floatingTexts[i];
    ft.life -= dt;
    ft.y += ft.vy * dt;
    if (ft.life <= 0) floatingTexts.splice(i, 1);
  }

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.trail.push({ x: p.x, y: p.y });
    if (p.trail.length > 5) p.trail.shift();
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) {
      projectiles.splice(i, 1);
      continue;
    }

    if (!p.isEnemy) {
      if (hitDestructibleWorldTarget(p)) {
        projectiles.splice(i, 1);
        continue;
      }
      if (boss.spawned && boss.state !== 'dead') {
        if (Math.hypot(boss.x - p.x, boss.y - p.y) < boss.size + 4) {
          boss.hp -= p.damage;
          boss.flashTimer = 0.1;
          spawnExplosion(p.x, p.y, 0.3);
          projectiles.splice(i, 1);
          if (boss.hp <= 0) {
            boss.state = 'dead';
            boss.deathTimer = 2.0;
            bossState.defeated = true;
            bossState.active = false;
            if (!GameState.isPracticeSortie()) {
              sortieState.rewards.hunter += 300;
              GameState.addSortieDollars(250);
            }
            heli.score += 500;
            addFear(12, 'Hunter destroyed');
            reduceHeat(18, 'Hunter destroyed');
            spawnExplosion(boss.x, boss.y, 3.0);
            spawnFloatingText(boss.x, boss.y - 30, 'HUNTER DESTROYED', '#ff4444');
            spawnFloatingText(boss.x, boss.y - 50, '+300 BOUNTY', '#ffcc44');
          }
          continue;
        }
      }
      for (const e of enemies) {
        if (e.state === 'dead') continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) < e.size + 4) {
          e.hp -= p.damage;
          e.flashTimer = 0.1;
          spawnExplosion(p.x, p.y, 0.3);
          projectiles.splice(i, 1);
          if (e.hp <= 0) {
            e.state = 'dead';
            e.deathTimer = 0.5;
            heli.score += e.points;
            GameState.addSortieXp(e.points);
            sortieState.stats.kills++;
            let fearGain = 1;
            if (e.category === 'vehicle') fearGain = 4;
            else if (e.category === 'emplacement') fearGain = 3;
            else if (
              e.weaponName === 'RPG' ||
              e.weaponName === 'ATGM' ||
              e.weaponName === 'MANPADS'
            ) {
              fearGain = 2;
            }
            addFear(fearGain, e.className);
            addHeat(Math.max(0.4, fearGain * 0.65), `${e.className} kill reported`);
            spawnExplosion(e.x, e.y, 1.0);
            spawnFloatingText(e.x, e.y - 10, `+${e.points}`, '#ffcc44');
            if (fearGain > 1) spawnFloatingText(e.x, e.y - 25, `+${fearGain} FEAR`, '#ff8844');
          }
          break;
        }
      }
    } else {
      if (heli.flareT > 0 && Math.hypot(p.x - heli.x, p.y - heli.y) < 170) {
        spawnExplosion(p.x, p.y, 0.15);
        projectiles.splice(i, 1);
        continue;
      }
      if (Math.hypot(heli.x - p.x, heli.y - p.y) < 20) {
        heli.hp -= Math.max(1, Math.round(p.damage * (1 - (heli.dmgResist || 0))));
        hudAnim.hpFlash = 0.15;
        camera.shake(4, 0.15);
        spawnExplosion(p.x, p.y, 0.2);
        projectiles.splice(i, 1);
        if (heli.hp <= 0) {
          if (heli.lastStand && !heli.lastStandUsed) {
            heli.lastStandUsed = true;
            heli.hp = Math.round(heli.maxHp * 0.25);
            spawnExplosion(heli.x, heli.y, 1.2);
            spawnFloatingText(heli.x, heli.y - 30, 'LAST STAND', '#ffcc44');
          } else {
            heli.hp = 0;
            spawnExplosion(heli.x, heli.y, 3.0);
            finishSortie('failed');
          }
        }
      }
    }
  }

  checkObjectiveProgress();
  if (bossState.defeated && sortieState.objectiveComplete && sortieState.status === 'active') {
    finishSortie('complete');
  }
  updateExtraction(dt);

  for (let i = explosions.length - 1; i >= 0; i--) {
    explosions[i].life -= dt;
    if (explosions[i].life <= 0) explosions.splice(i, 1);
  }

  const panFactor = clamp(spd / maxSpeed, 0, 0.35);
  camera.followAhead(heli.x, heli.y, heli.vx, heli.vy, panFactor);
  const speedZoom = lerp(CAMERA.zoomSpeedNear, CAMERA.zoomSpeedFar, spd / maxSpeed);
  camera.setZoom(heli.target ? Math.max(speedZoom, CAMERA.zoomCombatFloor) : speedZoom);
}
