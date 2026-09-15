/**
 * Contract board and scenario definitions.
 *
 * A contract is a promise about the operation. The world generator receives
 * the selected contract and creates a battlefield that fulfils that promise.
 */

import { mulberry32, pick, shuffle } from './rng.js';
import { hourFromSeed } from './sun.js';

export const SCENARIOS = {
  strike: {
    id: 'strike',
    name: 'STRIKE',
    objectiveLabel: 'Destroy the command target',
    description: 'Secure the intel, smash the command post, then extract across the border.',
    targetTags: ['command', 'military', 'industrial'],
    styles: ['loud_assault', 'precision_strike', 'deep_raid'],
    threatTags: ['armor', 'command', 'patrol'],
    baseReward: 220,
  },
  intercept: {
    id: 'intercept',
    name: 'INTERCEPT',
    objectiveLabel: 'Stop the supply convoy',
    description: 'Secure the intel to reveal the route, wreck the convoy, then extract.',
    targetTags: ['convoyRoute', 'logistics'],
    styles: ['pursuit', 'loud_assault', 'deep_raid'],
    threatTags: ['convoy', 'mobility', 'armor'],
    baseReward: 250,
  },
  sabotage: {
    id: 'sabotage',
    name: 'SABOTAGE',
    objectiveLabel: 'Disable the radar relay',
    description: 'Secure the intel, blind the relay, then extract across the border.',
    targetTags: ['radar', 'communications', 'military'],
    styles: ['precision_strike', 'deep_raid', 'low_profile'],
    threatTags: ['radar', 'manpads', 'low_intel'],
    baseReward: 280,
  },
  suppression: {
    id: 'suppression',
    name: 'SUPPRESSION',
    objectiveLabel: 'Destroy three air-defense units',
    description: 'Secure the intel to mark the guns, destroy them, then extract.',
    targetTags: ['airDefense', 'military'],
    styles: ['loud_assault', 'precision_strike', 'deep_raid'],
    threatTags: ['air_defense', 'coordinated', 'high_heat'],
    baseReward: 300,
  },
  recovery: {
    id: 'recovery',
    name: 'RECOVERY',
    objectiveLabel: 'Recover the supply cache',
    description: 'Secure the intel to locate the cache, grab it, then extract.',
    targetTags: ['supply', 'logistics'],
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

export const CAMPAIGN_RULES = {
  acts: 4,
  sortiesPerAct: 4,
  strongholdSortie: 4,
  strongholdTime: 300,
};

export const STRONGHOLDS = {
  1: {
    name: 'FORTIFIED CHECKPOINT',
    description: 'Break the first line and destroy the command post before the garrison rallies.',
    styleId: 'loud_assault',
    difficultyId: 'standard',
  },
  2: {
    name: 'AIR DEFENSE COMPLEX',
    description: 'Crack the layered air-defense complex and erase its command network.',
    styleId: 'precision_strike',
    difficultyId: 'hazardous',
  },
  3: {
    name: 'STRATEGIC SAM SITE',
    description: 'Silence the strategic battery before its full tracking net comes online.',
    styleId: 'deep_raid',
    difficultyId: 'hazardous',
  },
  4: {
    name: 'GUARDIAN STRONGHOLD',
    description: 'Penetrate the final compound and destroy the supergunship command core.',
    styleId: 'loud_assault',
    difficultyId: 'severe',
  },
};

export const CAMPAIGN_BOSSES = [
  { id: 'armored_patrol', name: 'ARMORED PATROL', type: 'light_tank', hp: 110, bodyguards: 1 },
  { id: 'convoy_escort', name: 'CONVOY ESCORT', type: 'medium_tank', hp: 140, bodyguards: 2 },
  { id: 'armored_column', name: 'ARMORED COLUMN', type: 'heavy_tank', hp: 180, bodyguards: 3 },
  {
    id: 'fortified_checkpoint',
    name: 'FORTIFIED CHECKPOINT',
    type: 'fortified',
    hp: 220,
    bodyguards: 4,
  },
  { id: 'sam_convoy', name: 'SAM CONVOY', type: 'sam_vehicle', hp: 200, bodyguards: 3 },
  { id: 'aa_battery', name: 'AA BATTERY', type: 'aa_complex', hp: 240, bodyguards: 4 },
  { id: 'armored_brigade', name: 'ARMORED BRIGADE', type: 'heavy_column', hp: 260, bodyguards: 5 },
  {
    id: 'air_defense_complex',
    name: 'AIR DEFENSE COMPLEX',
    type: 'ad_complex',
    hp: 300,
    bodyguards: 6,
  },
  { id: 'attack_heli', name: 'ATTACK HELICOPTER', type: 'attack_heli', hp: 150, bodyguards: 2 },
  { id: 'sam_network', name: 'SAM NETWORK', type: 'sam_network', hp: 300, bodyguards: 5 },
  { id: 'combined_arms', name: 'HEAVY ARMOR + AIR', type: 'combined_arms', hp: 340, bodyguards: 6 },
  {
    id: 'strategic_sam',
    name: 'STRATEGIC SAM SITE',
    type: 'strategic_sam',
    hp: 380,
    bodyguards: 8,
  },
  { id: 'fighter_intercept', name: 'FIGHTER INTERCEPT', type: 'fighter', hp: 100, bodyguards: 0 },
  { id: 'heavy_air_defense', name: 'HEAVY AIR DEFENSE', type: 'heavy_ad', hp: 420, bodyguards: 8 },
  {
    id: 'armored_air_raid',
    name: 'ARMORED AIR RAID',
    type: 'combined_elite',
    hp: 460,
    bodyguards: 10,
  },
  {
    id: 'guardian_supergunship',
    name: 'FINAL BOSS: SUPERGUNSHIP',
    type: 'supergunship',
    hp: 620,
    bodyguards: 12,
    final: true,
  },
];

export function getCampaignMission(campaign = { act: 1, sortie: 1 }) {
  const act = Math.max(1, Math.min(CAMPAIGN_RULES.acts, Math.floor(campaign.act || 1)));
  const sortie = Math.max(
    1,
    Math.min(CAMPAIGN_RULES.sortiesPerAct, Math.floor(campaign.sortie || 1))
  );
  const bossProfile = CAMPAIGN_BOSSES[(act - 1) * CAMPAIGN_RULES.sortiesPerAct + sortie - 1];
  return {
    act,
    sortie,
    stronghold: sortie === CAMPAIGN_RULES.strongholdSortie,
    strongholdTime: sortie === CAMPAIGN_RULES.strongholdSortie ? CAMPAIGN_RULES.strongholdTime : 0,
    bossProfile,
  };
}

function nextSeed(rng) {
  return Math.floor(rng() * 0xffffffff) >>> 0;
}

export function intelCountForCampaign(campaign = { act: 1 }) {
  return Math.max(1, Math.min(4, campaign.act || 1));
}

function withHour(card) {
  card.hour = hourFromSeed(card.seed);
  card.intelCount = intelCountForCampaign(card.campaign);
  return card;
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
  const mission = getCampaignMission(campaign);
  if (mission.stronghold) {
    const stronghold = STRONGHOLDS[mission.act];
    const difficulty = DIFFICULTIES[stronghold.difficultyId];
    const style = STYLES[stronghold.styleId];
    return [
      withHour({
        id: `act-${mission.act}-sortie-${mission.sortie}-stronghold`,
        seed: nextSeed(rng),
        boardSeed: boardSeed >>> 0,
        campaign: { act: mission.act, sortie: mission.sortie },
        scenarioId: 'strike',
        styleId: stronghold.styleId,
        difficultyId: stronghold.difficultyId,
        missionType: 'stronghold',
        stronghold: true,
        strongholdTime: mission.strongholdTime,
        bossProfile: mission.bossProfile,
        name: stronghold.name,
        objectiveLabel: 'Destroy the command post and defeat the commander',
        description: stronghold.description,
        styleName: style.name,
        styleDescription: style.description,
        difficultyName: difficulty.name,
        difficultyRating: difficulty.rating,
        threatTags: ['stronghold', 'command', 'reinforcements'],
        reward: Math.round(500 * difficulty.rewardMultiplier),
      }),
    ];
  }
  const scenarioIds = shuffle(Object.keys(SCENARIOS), rng).slice(0, 4);

  return scenarioIds.map((scenarioId, index) => {
    const scenario = SCENARIOS[scenarioId];
    const styleId = pick(scenario.styles, rng);
    const difficultyId = chooseDifficulty(index, rng);
    const difficulty = DIFFICULTIES[difficultyId];
    const style = STYLES[styleId];
    const reward = Math.round(
      scenario.baseReward * difficulty.rewardMultiplier * (1 + (style.supplyChance - 0.4) * 0.15)
    );

    return withHour({
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
      missionType: 'sortie',
      stronghold: false,
      strongholdTime: 0,
      bossProfile: mission.bossProfile,
    });
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
