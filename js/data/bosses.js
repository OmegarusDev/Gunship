/**
 * Hunter / stronghold commanders. One dossier slot per unique campaign type.
 * Kills are recorded on the career the same way regular classes are.
 */
import { CAMPAIGN_BOSSES } from '../contracts.js';

export const BOSS_DOSSIERS = Object.fromEntries(
  CAMPAIGN_BOSSES.map((row, index) => [
    row.type,
    {
      id: row.type,
      name: row.name.replace(/^FINAL BOSS:\s*/i, ''),
      short: bossShort(row.type, row.name),
      hp: row.hp,
      bodyguards: row.bodyguards || 0,
      final: Boolean(row.final),
      act: Math.floor(index / 4) + 1,
      silhouette: bossSilhouette(row.type),
      blurb: bossBlurb(row.type),
    },
  ])
);

export const BOSS_DOSSIER_ORDER = CAMPAIGN_BOSSES.map((row) => row.type);

function bossShort(type, name) {
  const shorts = {
    light_tank: 'PATROL',
    medium_tank: 'ESCORT',
    heavy_tank: 'COLUMN',
    fortified: 'CHECKPT',
    sam_vehicle: 'SAM CVY',
    aa_complex: 'AA PIT',
    heavy_column: 'BRIGADE',
    ad_complex: 'AD SITE',
    attack_heli: 'HIND',
    sam_network: 'SAM NET',
    combined_arms: 'COMBINED',
    strategic_sam: 'STRAT SAM',
    fighter: 'FIGHTER',
    heavy_ad: 'HEAVY AD',
    combined_elite: 'AIR RAID',
    supergunship: 'GUARDIAN',
  };
  if (shorts[type]) return shorts[type];
  return String(name || type)
    .replace(/^FINAL BOSS:\s*/i, '')
    .split(/\s+/)[0]
    .slice(0, 10)
    .toUpperCase();
}

function bossSilhouette(type) {
  if (/fighter/.test(type)) return 'fighter';
  if (/heli|gunship|supergunship/.test(type)) return 'heli';
  if (/sam/.test(type)) return 'sam';
  if (/aa|ad_|air_defense|fortified/.test(type)) return 'aa';
  return 'tank';
}

function bossBlurb(type) {
  if (type === 'supergunship') return 'The Guardian. Multi-turret, last bird of the campaign.';
  if (type === 'fighter') return 'Fast intercept. One pass, then another.';
  if (type === 'attack_heli') return 'Hostile gunship. Strafe, break, return.';
  if (/sam/.test(type)) return 'Missile commander. Long reach, escorts on the hull.';
  if (/aa|ad_|fortified/.test(type)) return 'Dug-in air defense. The pit shoots back.';
  return 'Armored hunter. Tracks, turret, bodyguards.';
}

export function bossDossierId(boss) {
  return boss?.type || boss?.className || null;
}
