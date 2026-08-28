/**
 * sim/state.js — SimState container and factories.
 * DOM-free, canvas-free. Importable in node for headless tests.
 * Holds the per-sortie mutable state that was previously top-level lets in app.js.
 */

import { TIMER } from '../config.js';
import { getDifficulty as getDifficultyProfile, getStyle } from '../contracts.js';

export const FEAR_THRESHOLDS = [10, 25, 50, 85, 130, 190, 270, 370, 500, 660];
export const HEAT_LABELS = ['QUIET', 'SUSPICIOUS', 'CONTACT', 'COORDINATED', 'CRITICAL'];

export const EQUIPMENT = {
  repair: { name: 'REPAIR PATCH', desc: 'E: +40 hull instantly' },
  rocket: { name: 'ROCKET SALVO', desc: 'E: 6 rockets on target' },
  overboost: { name: 'OVERBOOST', desc: 'E: +50% spd & fire 6s' },
  flares: { name: 'FLARES', desc: 'E: dissolve nearby fire 3s' },
};

export function createHeli() {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    bladeAngle: 0,
    hp: 100,
    maxHp: 100,
    fireCooldown: 0,
    fireRate: 0.15,
    bulletSpeed: 500,
    bulletDamage: 8,
    weaponRange: 350,
    accel: 1400,
    maxSpeed: 400,
    heatDecayMultiplier: 1,
    targetAssist: 0,
    target: null,
    manualTarget: null,
    targetMode: 'closest',
    targetCycleIndex: 0,
    score: 0,
    fear: 0,
    // career-wired fields (filled by applyCareerToHeli)
    turnMult: 1,
    spreadMult: 1,
    lockMult: 1,
    autoLead: false,
    radarRange: 1,
    detectionMult: 1,
    fullSpectrum: false,
    reconPulse: false,
    markedDmg: 0,
    dmgResist: 0,
    redScreenRed: 0,
    boostDurMult: 1,
    boostPotency: 1,
    doubleTap: 0,
    critChance: 0,
    sniperBonus: 0,
    lastStand: false,
    missileWarning: false,
    lastStandUsed: false,
    // per-sortie equipment
    equipmentType: null,
    equipmentUsed: false,
    salvoShots: 0,
    salvoTimer: 0,
    adrenalineT: 0,
    flareT: 0,
  };
}

export function createBoss() {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    hp: 0,
    maxHp: 0,
    speed: 0,
    damage: 0,
    range: 0,
    fireRate: 0,
    fireCooldown: 0,
    state: 'approach',
    flashTimer: 0,
    deathTimer: 0,
    spawnAngle: 0,
    phaseTimer: 0,
    size: 22,
    turretAngle: 0,
    spawned: false,
  };
}

export function createBossState() {
  return {
    timeRemaining: TIMER.baseTime,
    active: false,
    warning: false,
    warningTimer: 0,
    spawned: false,
    defeated: false,
    clearedSettlements: 0,
  };
}

export function createSortieState() {
  return {
    status: 'idle',
    objectiveComplete: false,
    fearLevel: 0,
    levelUpOpen: false,
    upgradeChoices: [],
    pendingLevelUps: 0,
    appliedUpgrades: [],
    heat: { value: 0, tier: 0, lastContact: 0, lastEvent: '', eventTimer: 0, decayMultiplier: 1 },
    rewards: { objective: 0, supplies: 0, hunter: 0, secured: 0 },
    stats: { kills: 0, crates: 0, sites: 0 },
    endTimer: 0,
  };
}

export function resetSortieState(sortieState, activeContract) {
  sortieState.status = 'active';
  sortieState.objectiveComplete = false;
  sortieState.fearLevel = 0;
  sortieState.levelUpOpen = false;
  sortieState.upgradeChoices = [];
  sortieState.pendingLevelUps = 0;
  sortieState.appliedUpgrades = [];
  sortieState.heat.value = 0;
  sortieState.heat.tier = 0;
  sortieState.heat.lastContact = 0;
  sortieState.heat.lastEvent = '';
  sortieState.heat.eventTimer = 0;
  sortieState.heat.decayMultiplier = 1;
  sortieState.rewards.objective = 0;
  sortieState.rewards.supplies = 0;
  sortieState.rewards.hunter = 0;
  sortieState.rewards.secured = 0;
  sortieState.stats.kills = 0;
  sortieState.stats.crates = 0;
  sortieState.stats.sites = 0;
  sortieState.endTimer = 0;
}

export function resetBossState(bossState, activeContract) {
  const difficulty = getDifficultyProfile(activeContract?.difficultyId);
  bossState.timeRemaining = TIMER.baseTime * (difficulty.hunterEtaMultiplier ?? 1);
  bossState.active = true;
  bossState.warning = false;
  bossState.warningTimer = 0;
  bossState.spawned = false;
  bossState.defeated = false;
  bossState.clearedSettlements = 0;
}

export function getHeatTier(value) {
  if (value >= 80) return 4;
  if (value >= 60) return 3;
  if (value >= 35) return 2;
  if (value >= 15) return 1;
  return 0;
}

export function getFearThreshold(fearLevel) {
  return FEAR_THRESHOLDS[Math.min(fearLevel || 0, FEAR_THRESHOLDS.length - 1)] || 660;
}

export function hunterClockRate(sortieState, activeContract) {
  const difficulty = getDifficultyProfile(activeContract?.difficultyId);
  const style = getStyle(activeContract?.styleId);
  const heatFactor = 0.72 + (sortieState.heat.value / 100) * 1.18;
  return heatFactor * (difficulty.hunterEtaMultiplier ?? 1) * (style.hunterRateMultiplier || 1);
}
