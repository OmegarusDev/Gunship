/**
 * Ground contact AI. Hostiles hold generated posts (rooftop, courtyard,
 * gate, interior) instead of wandering off the fabric they were placed on.
 */
import { CIVILIAN_ESCAPE_RADIUS, COMBAT } from '../config.js';
import * as GameState from './gameState.js';
import { steerAlongRoads, vehicleSpeedFactor } from './movement.js';

const HOLD_POSTS = new Set(['rooftop', 'courtyard', 'interior']);

function shortestDiff(target, current) {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function holdLeash(enemy) {
  if (HOLD_POSTS.has(enemy.post)) {
    return enemy.category === 'emplacement' ? 36 : 70;
  }
  if (enemy.post === 'gate') {
    return enemy.category === 'vehicle' ? 220 : 110;
  }
  return enemy.category === 'vehicle' ? COMBAT.leashVehicle : COMBAT.leashInfantry;
}

function returnToPost(enemy, dt, sharedTerrain) {
  if (enemy.homeX === undefined) return;
  const homeDist = Math.hypot(enemy.x - enemy.homeX, enemy.y - enemy.homeY);
  const arrive = HOLD_POSTS.has(enemy.post) ? 6 : 14;
  if (homeDist <= arrive) return;
  let homeAngle = Math.atan2(enemy.homeY - enemy.y, enemy.homeX - enemy.x);
  let homeFactor = 1;
  if (enemy.category === 'vehicle' && enemy.speed > 0) {
    const steer = steerAlongRoads(GameState.world, homeAngle, enemy.x, enemy.y);
    homeAngle = steer.angle;
    homeFactor = vehicleSpeedFactor(GameState.world, sharedTerrain, enemy.x, enemy.y);
  }
  enemy.angle += shortestDiff(homeAngle, enemy.angle) * Math.min(1, 1.6 * dt);
  if (enemy.speed > 0) {
    const pace = HOLD_POSTS.has(enemy.post) ? 0.7 : 0.55;
    enemy.x += Math.cos(enemy.angle) * enemy.speed * pace * homeFactor * dt;
    enemy.y += Math.sin(enemy.angle) * enemy.speed * pace * homeFactor * dt;
  }
}

function faceToward(enemy, x, y, dt, rate = 1) {
  const angle = Math.atan2(y - enemy.y, x - enemy.x);
  enemy.angle += shortestDiff(angle, enemy.angle) * Math.min(1, rate * dt);
}

export function updateEnemies(dt, { addHeat, spawnProjectile, lastShotX, lastShotY, lastShotT }) {
  const world = GameState.world;
  const heli = GameState.heli;
  const enemies = GameState.enemies;
  const sortieState = GameState.sortieState;
  const sharedTerrain = GameState.sharedTerrain;
  const encountersUnderAttack = new Set();
  for (const enemy of enemies) {
    if (enemy.state === 'attack' && enemy.encounterId) encountersUnderAttack.add(enemy.encounterId);
  }

  for (const enemy of enemies) {
    if (enemy.state === 'dead') {
      enemy.deathTimer -= dt;
      continue;
    }
    const dist = Math.hypot(enemy.x - heli.x, enemy.y - heli.y);

    if (enemy.className === 'unarmed') {
      const gunfireNear =
        performance.now() / 1000 - lastShotT < COMBAT.gunfireMemorySec &&
        Math.hypot(enemy.x - lastShotX, enemy.y - lastShotY) < COMBAT.gunfireRadius;
      if (
        (gunfireNear || (enemy.encounterId && encountersUnderAttack.has(enemy.encounterId))) &&
        dist < COMBAT.civilianPanicRadius
      ) {
        enemy.state = 'flee';
      }
      if (enemy.state === 'flee') {
        faceToward(enemy, enemy.x * 2 - heli.x, enemy.y * 2 - heli.y, dt, 3);
        if (enemy.speed > 0) {
          enemy.x += Math.cos(enemy.angle) * enemy.speed * dt;
          enemy.y += Math.sin(enemy.angle) * enemy.speed * dt;
        }
        if (
          enemy.homeX !== undefined &&
          Math.hypot(enemy.x - enemy.homeX, enemy.y - enemy.homeY) > CIVILIAN_ESCAPE_RADIUS
        ) {
          enemy.escaped = true;
        }
      } else {
        enemy.state = 'idle';
        if (enemy.speed > 0) {
          enemy.wanderPhase = (enemy.wanderPhase || 0) + dt;
          enemy.angle += Math.sin(enemy.wanderPhase * 1.7 + enemy.x * 0.01) * 0.5 * dt;
          enemy.x += Math.cos(enemy.angle) * enemy.speed * 0.3 * dt;
          enemy.y += Math.sin(enemy.angle) * enemy.speed * 0.3 * dt;
        }
      }
      continue;
    }

    const responseRange = COMBAT.aggroBase + sortieState.heat.tier * COMBAT.aggroPerHeatTier;
    const homeDist = enemy.homeX !== undefined ? Math.hypot(enemy.x - enemy.homeX, enemy.y - enemy.homeY) : 0;
    const leash = holdLeash(enemy);
    const wasAttacking = enemy.state === 'attack';
    const canLeavePost = !HOLD_POSTS.has(enemy.post) && enemy.post !== 'interior';
    if (dist < responseRange && homeDist < leash) enemy.state = 'attack';
    else if (
      (dist < responseRange + COMBAT.alertExtra || wasAttacking) &&
      homeDist < leash + COMBAT.leashGrace
    ) {
      enemy.state = 'alert';
    } else enemy.state = 'idle';

    if (enemy.state === 'attack' && !wasAttacking) addHeat(1.2, 'hostile contact');

    if (enemy.state === 'attack') {
      faceToward(enemy, heli.x, heli.y, dt, 2);
      const hold = HOLD_POSTS.has(enemy.post) || enemy.category === 'emplacement';
      if (hold) {
        if (homeDist > 8) returnToPost(enemy, dt, sharedTerrain);
      } else if (enemy.speed > 0 && dist > enemy.range * 0.5 && canLeavePost) {
        let moveAngle = Math.atan2(heli.y - enemy.y, heli.x - enemy.x);
        let vehFactor = 1;
        if (enemy.category === 'vehicle') {
          const steer = steerAlongRoads(world, moveAngle, enemy.x, enemy.y);
          moveAngle = steer.angle;
          vehFactor = vehicleSpeedFactor(world, sharedTerrain, enemy.x, enemy.y);
        }
        enemy.angle += shortestDiff(moveAngle, enemy.angle) * Math.min(1, 2 * dt);
        enemy.x += Math.cos(enemy.angle) * enemy.speed * vehFactor * dt;
        enemy.y += Math.sin(enemy.angle) * enemy.speed * vehFactor * dt;
      } else if (enemy.post === 'gate' && homeDist > 28) {
        returnToPost(enemy, dt, sharedTerrain);
      }
      enemy.fireCooldown -= dt;
      if (enemy.fireCooldown <= 0 && dist < enemy.range) {
        const fireAngle = Math.atan2(heli.y - enemy.y, heli.x - enemy.x) + (Math.random() - 0.5) * 0.09;
        spawnProjectile(enemy.x, enemy.y, fireAngle, 200, enemy.damage, true, enemy.bulletLife || 1.5);
        enemy.fireCooldown = enemy.fireRate;
      }
    } else if (enemy.homeX !== undefined && homeDist > (HOLD_POSTS.has(enemy.post) ? 8 : COMBAT.returnHomeDist)) {
      returnToPost(enemy, dt, sharedTerrain);
    } else if (enemy.state === 'alert') {
      faceToward(enemy, heli.x, heli.y, dt, 1);
      if (HOLD_POSTS.has(enemy.post) && homeDist > 8) returnToPost(enemy, dt, sharedTerrain);
    } else if (enemy.state === 'idle') {
      if (HOLD_POSTS.has(enemy.post) || enemy.post === 'gate' || enemy.post === 'interior') {
        if (homeDist > 8) returnToPost(enemy, dt, sharedTerrain);
        else if (enemy.post === 'gate' && enemy.category === 'vehicle' && enemy.speed > 0) {
          enemy.wanderPhase = (enemy.wanderPhase || 0) + dt;
          const orbit = enemy.wanderPhase * 0.7;
          const tx = enemy.homeX + Math.cos(orbit) * 16;
          const ty = enemy.homeY + Math.sin(orbit) * 16;
          faceToward(enemy, tx, ty, dt, 1.2);
          enemy.x += Math.cos(enemy.angle) * enemy.speed * 0.28 * dt;
          enemy.y += Math.sin(enemy.angle) * enemy.speed * 0.28 * dt;
        }
      } else if (enemy.speed > 0) {
        enemy.wanderPhase = (enemy.wanderPhase || 0) + dt;
        enemy.angle += Math.sin(enemy.wanderPhase * 1.7 + enemy.x * 0.01) * 0.5 * dt;
        enemy.x += Math.cos(enemy.angle) * enemy.speed * 0.3 * dt;
        enemy.y += Math.sin(enemy.angle) * enemy.speed * 0.3 * dt;
      }
    }
    if (enemy.flashTimer > 0) enemy.flashTimer -= dt;
  }

  for (let i = enemies.length - 1; i >= 0; i--) {
    const enemy = enemies[i];
    if ((enemy.state === 'dead' && enemy.deathTimer <= 0) || enemy.escaped) enemies.splice(i, 1);
  }
}
