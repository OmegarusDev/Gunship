/**
 * Contract board and scenario definitions.
 *
 * A contract is a promise about the operation. The world generator receives
 * the selected contract and creates a battlefield that fulfils that promise.
 */

import { mulberry32, pick, shuffle } from './rng.js';

export const SCENARIOS = {
  strike: {
    id: 'strike',
    name: 'STRIKE',
    objectiveLabel: 'Destroy the command target',
    description: 'Break the local command structure before the response closes in.',
    compatibleSites: ['town', 'camp', 'base'],
    styles: ['loud_assault', 'precision_strike', 'deep_raid'],
    threatTags: ['armor', 'command', 'patrol'],
    baseReward: 220,
  },
  intercept: {
    id: 'intercept',
    name: 'INTERCEPT',
    objectiveLabel: 'Stop the supply convoy',
    description: 'Find the route, catch the convoy, and leave before the net closes.',
    compatibleSites: ['rural', 'town', 'camp', 'base'],
    styles: ['pursuit', 'loud_assault', 'deep_raid'],
    threatTags: ['convoy', 'mobility', 'armor'],
    baseReward: 250,
  },
  sabotage: {
    id: 'sabotage',
    name: 'SABOTAGE',
    objectiveLabel: 'Disable the radar relay',
    description: 'Blind the local network, then reach extraction before the reply.',
    compatibleSites: ['camp', 'base', 'town'],
    styles: ['precision_strike', 'deep_raid', 'low_profile'],
    threatTags: ['radar', 'manpads', 'low_intel'],
    baseReward: 280,
  },
  suppression: {
    id: 'suppression',
    name: 'SUPPRESSION',
    objectiveLabel: 'Destroy three air-defense units',
    description: 'Remove the guns protecting the sector. Every kill will be reported.',
    compatibleSites: ['camp', 'base', 'town'],
    styles: ['loud_assault', 'precision_strike', 'deep_raid'],
    threatTags: ['air_defense', 'coordinated', 'high_heat'],
    baseReward: 300,
  },
  recovery: {
    id: 'recovery',
    name: 'RECOVERY',
    objectiveLabel: 'Recover the supply cache',
    description: 'Take the cache and get out. The package is worth more than the firefight.',
    compatibleSites: ['rural', 'town', 'camp', 'base'],
    styles: ['precision_strike', 'deep_raid', 'low_profile'],
    threatTags: ['supply', 'exposure', 'extraction'],
    baseReward: 180,
  },
};

export const STYLES = {
  loud_assault: {
    id: 'loud_assault',
    name: 'LOUD ASSAULT',
    description: 'More resistance, better payout, faster response.',
    heatGainMultiplier: 1.25,
    hunterRateMultiplier: 1.1,
    enemyCountMultiplier: 1.15,
    extractionDistanceMultiplier: 0.9,
    supplyChance: 0.45,
  },
  precision_strike: {
    id: 'precision_strike',
    name: 'PRECISION STRIKE',
    description: 'Fewer enemies, but detection and mistakes carry a higher cost.',
    heatGainMultiplier: 0.85,
    hunterRateMultiplier: 0.9,
    enemyCountMultiplier: 0.85,
    extractionDistanceMultiplier: 1.0,
    supplyChance: 0.55,
  },
  deep_raid: {
    id: 'deep_raid',
    name: 'DEEP RAID',
    description: 'Long approach, valuable caches, and a difficult way home.',
    heatGainMultiplier: 1.0,
    hunterRateMultiplier: 1.0,
    enemyCountMultiplier: 1.0,
    extractionDistanceMultiplier: 1.25,
    supplyChance: 0.8,
  },
  pursuit: {
    id: 'pursuit',
    name: 'PURSUIT',
    description: 'The target moves. Hesitation is failure.',
    heatGainMultiplier: 1.1,
    hunterRateMultiplier: 1.05,
    enemyCountMultiplier: 0.95,
    extractionDistanceMultiplier: 1.0,
    supplyChance: 0.35,
  },
  low_profile: {
    id: 'low_profile',
    name: 'LOW PROFILE',
    description: 'Limited intelligence and less time exposed to contact.',
    heatGainMultiplier: 0.7,
    hunterRateMultiplier: 0.8,
    enemyCountMultiplier: 0.9,
    extractionDistanceMultiplier: 1.15,
    supplyChance: 0.65,
  },
};

export const DIFFICULTIES = {
  routine: {
    id: 'routine',
    name: 'ROUTINE',
    rating: 1,
    threatBudget: 16,
    radialMultiplier: 0.9,
    enemyHpMultiplier: 0.9,
    enemyDamageMultiplier: 0.85,
    targetHpMultiplier: 0.85,
    hunterHpMultiplier: 0.9,
    hunterDamageMultiplier: 0.85,
    hunterEtaMultiplier: 1.2,
    rewardMultiplier: 0.85,
  },
  standard: {
    id: 'standard',
    name: 'STANDARD',
    rating: 2,
    threatBudget: 24,
    radialMultiplier: 1.0,
    enemyHpMultiplier: 1.0,
    enemyDamageMultiplier: 1.0,
    targetHpMultiplier: 1.0,
    hunterHpMultiplier: 1.0,
    hunterDamageMultiplier: 1.0,
    hunterEtaMultiplier: 1.0,
    rewardMultiplier: 1.0,
  },
  hazardous: {
    id: 'hazardous',
    name: 'HAZARDOUS',
    rating: 3,
    threatBudget: 34,
    radialMultiplier: 1.15,
    enemyHpMultiplier: 1.1,
    enemyDamageMultiplier: 1.1,
    targetHpMultiplier: 1.2,
    hunterHpMultiplier: 1.15,
    hunterDamageMultiplier: 1.1,
    hunterEtaMultiplier: 0.9,
    rewardMultiplier: 1.35,
  },
  severe: {
    id: 'severe',
    name: 'SEVERE',
    rating: 4,
    threatBudget: 46,
    radialMultiplier: 1.3,
    enemyHpMultiplier: 1.2,
    enemyDamageMultiplier: 1.2,
    targetHpMultiplier: 1.45,
    hunterHpMultiplier: 1.3,
    hunterDamageMultiplier: 1.2,
    hunterEtaMultiplier: 0.78,
    rewardMultiplier: 1.8,
  },
};

function nextSeed(rng) {
  return Math.floor(rng() * 0xffffffff) >>> 0;
}

function chooseDifficulty(slot, rng) {
  if (slot === 0) return 'routine';
  if (slot === 1) return rng() < 0.7 ? 'standard' : 'routine';
  if (slot === 2) return rng() < 0.65 ? 'hazardous' : 'standard';
  return rng() < 0.45 ? 'severe' : 'hazardous';
}

/** Create four controlled-random contract offers. */
export function createContractBoard(boardSeed, campaign = { act: 1, sortie: 1 }) {
  const rng = mulberry32(boardSeed >>> 0);
  const scenarioIds = shuffle(Object.keys(SCENARIOS), rng).slice(0, 4);

  return scenarioIds.map((scenarioId, index) => {
    const scenario = SCENARIOS[scenarioId];
    const styleId = pick(scenario.styles, rng);
    const difficultyId = chooseDifficulty(index, rng);
    const difficulty = DIFFICULTIES[difficultyId];
    const style = STYLES[styleId];
    const reward = Math.round(scenario.baseReward * difficulty.rewardMultiplier * (1 + (style.supplyChance - 0.4) * 0.15));

    return {
      id: `act-${campaign.act}-sortie-${campaign.sortie}-offer-${index + 1}`,
      seed: nextSeed(rng),
      boardSeed: boardSeed >>> 0,
      campaign: { ...campaign },
      scenarioId,
      styleId,
      difficultyId,
      name: scenario.name,
      objectiveLabel: scenario.objectiveLabel,
      description: scenario.description,
      styleName: style.name,
      styleDescription: style.description,
      difficultyName: difficulty.name,
      difficultyRating: difficulty.rating,
      threatTags: [...scenario.threatTags],
      reward,
    };
  });
}

export function getScenario(id) {
  return SCENARIOS[id] || SCENARIOS.strike;
}

export function getStyle(id) {
  return STYLES[id] || STYLES.precision_strike;
}

export function getDifficulty(id) {
  return DIFFICULTIES[id] || DIFFICULTIES.standard;
}
