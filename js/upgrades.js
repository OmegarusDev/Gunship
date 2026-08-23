/** Small in-sortie upgrade pool used by Fear level-ups. */

import { mulberry32, shuffle } from './rng.js';

export const FEAR_CARDS = [
  {
    id: 'ap_rounds',
    name: 'AP ROUNDS',
    description: '+25% gun damage.',
    apply(heli) { heli.bulletDamage *= 1.25; },
  },
  {
    id: 'rapid_cycle',
    name: 'RAPID CYCLE',
    description: 'Fire 18% faster.',
    apply(heli) { heli.fireRate *= 0.82; },
  },
  {
    id: 'overpressure',
    name: 'OVERPRESSURE',
    description: '+20% projectile speed and +40 weapon range.',
    apply(heli) {
      heli.bulletSpeed *= 1.2;
      heli.weaponRange += 40;
    },
  },
  {
    id: 'long_belt',
    name: 'LONG BELT',
    description: '+90 weapon range.',
    apply(heli) { heli.weaponRange += 90; },
  },
  {
    id: 'hardened_frame',
    name: 'HARDENED FRAME',
    description: '+20 maximum HP and restore 20 HP.',
    apply(heli) {
      heli.maxHp += 20;
      heli.hp = Math.min(heli.maxHp, heli.hp + 20);
    },
  },
  {
    id: 'turbine_tuning',
    name: 'TURBINE TUNING',
    description: '+15% acceleration and maximum speed.',
    apply(heli) {
      heli.accel *= 1.15;
      heli.maxSpeed *= 1.15;
    },
  },
  {
    id: 'cooling_loop',
    name: 'COOLING LOOP',
    description: 'Heat decays 35% faster after breaking contact.',
    apply(heli) { heli.heatDecayMultiplier *= 1.35; },
  },
  {
    id: 'targeting_link',
    name: 'TARGETING LINK',
    description: '+120 weapon range and stronger target lock.',
    apply(heli) {
      heli.weaponRange += 120;
      heli.targetAssist = Math.min(1, heli.targetAssist + 0.25);
    },
  },
];

export function createUpgradeChoices(seed, appliedIds = []) {
  const available = FEAR_CARDS.filter((card) => !appliedIds.includes(card.id));
  const rng = mulberry32(seed >>> 0);
  return shuffle([...available], rng).slice(0, Math.min(3, available.length));
}
