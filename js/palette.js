/**
 * Color palette — 90s Gulf War vibrant cartoon aesthetic.
 * Olive drab player, brown enemies, steel/concrete buildings.
 * Bold outlines, saturated fills, military radar HUD.
 */

import { shade, withAlpha } from './drawUtil.js';

export const P = {
  // === TERRAIN ===
  terrain: {
    sand: '#e8c87a',
    hardpack: '#d4a860',
    rock: '#9a8060',
    road: '#8a7050',
    wadi: '#6a9ab0',
    oasis: '#4a9a5a',
    dunes: '#f0d890',
  },

  // === PLAYER GUNSHIPS ===
  gunship: {
    body: '#5a7a3a',
    bodyHi: '#6a8a4a',
    bodyDark: '#3a5a2a',
    steel: '#8a8a7a',
    steelHi: '#9a9a8a',
    steelDark: '#6a6a5a',
    cockpit: '#88ccdd',
    cockpitHi: '#aaeeff',
    rotor: '#555555',
    weaponPod: '#4a4a4a',
    weaponHi: '#5a5a5a',
    skid: '#333333',
    shadow: 'rgba(0,0,0,0.35)',
    outline: '#222222',
    stealth: '#3a5a3a',
    stealthHi: '#4a6a4a',
  },

  // === ENEMIES (all brown — simple, unified) ===
  enemy: {
    base: '#8a6a4a',
    baseHi: '#9a7a5a',
    baseDark: '#6a4a2a',
    outline: '#3a2a1a',
    vehicle: '#7a6040',
    vehicleHi: '#8a7050',
    vehicleDark: '#5a4020',
    aircraft: '#7a7a6a',
    aircraftHi: '#8a8a7a',
  },

  // === BUILDINGS ===
  building: {
    concrete: '#c0b898',
    concreteHi: '#d0c8a8',
    concreteDark: '#a09878',
    steel: '#8a8a7a',
    steelHi: '#9a9a8a',
    steelDark: '#6a6a5a',
    wood: '#a08050',
    woodHi: '#b09060',
    woodDark: '#806030',
    tent: '#9a8060',
    tentHi: '#aa9070',
    sandbag: '#b0a070',
    sandbagHi: '#c0b080',
    fuel: '#cc4433',
    fuelHi: '#dd5544',
    fuelStripe: '#ffcc00',
    hazard: '#ffcc00',
    hazardDark: '#222222',
    radar: '#6a7a6a',
    radarHi: '#7a8a7a',
    antenna: '#888888',
  },

  // === HIGH-PRIORITY TARGETS ===
  highPriority: {
    base: '#cc4433',
    highlight: '#ee6655',
    glow: 'rgba(220,60,40,0.4)',
    stripe: '#ffcc00',
    pulse: 'rgba(220,60,40,0.2)',
  },

  // === UI/HUD ===
  ui: {
    bg: 'rgba(10,15,10,0.75)',
    bgSolid: '#0a100a',
    border: '#3a5a2a',
    borderHi: '#5a7a3a',
    scanline: 'rgba(50,80,50,0.1)',
    text: '#88cc66',
    textBright: '#aaff88',
    textDim: '#446633',
    hp: '#44aa44',
    hpMed: '#ccaa33',
    hpLow: '#cc3333',
    hpBar: '#1a2a1a',
    hpBorder: '#3a5a2a',
    infamy: '#cc8833',
    infamyBar: '#1a1a0a',
    infamyBorder: '#5a4a2a',
    rocket: '#44cccc',
    rocketEmpty: '#224444',
    equipment: '#44cccc',
    equipEmpty: '#224444',
    equipCooldown: '#666633',
    minimap: '#0a120a',
    minimapGrid: '#1a2a1a',
    minimapSweep: 'rgba(50,200,50,0.1)',
    player: '#44ff44',
    enemy: '#ff4444',
    settlement: '#ffcc44',
    boss: '#ff2222',
    timer: '#88cc66',
    timerLow: '#ff4444',
    arrow: '#ff4444',
  },

  // === PROJECTILES ===
  projectile: {
    bullet: '#ffdd44',
    bulletTrail: '#ffaa33',
    rocket: '#ff6633',
    rocketFlame: '#ffcc33',
    rocketTrail: '#aa6633',
    missile: '#ff4444',
    missileTrail: '#aa3333',
    enemy: '#ff8866',
    enemyTrail: '#cc5533',
  },

  // === VFX ===
  vfx: {
    explosion: ['#ffdd44', '#ff8833', '#cc3333', '#663333'],
    muzzle: '#ffdd44',
    spark: '#ffdd44',
    sparkHi: '#ffffff',
    smoke: '#777777',
    smokeDark: '#444444',
    fire: '#ff6633',
    fireBright: '#ffaa33',
    chainLight: '#44ddff',
    napalm: '#ff6633',
    napalmBright: '#ffaa33',
    damageNum: '#ffffff',
    damageCrit: '#ffdd44',
    healNum: '#44ff44',
    infamyUp: '#ffaa33',
  },

  // === TERRAIN DECORATION ===
  deco: {
    crater: '#7a6a4a',
    craterRim: '#9a8a5a',
    stain: 'rgba(100,60,20,0.3)',
    bush: '#4a8a3a',
    rock: '#8a7a5a',
    crate: '#a08050',
    crateHi: '#b09060',
    crateStripe: '#cc3333',
  },
};

/** Get material palette from a base color. Convenience wrapper. */
export function mats(col) {
  return {
    top: shade(col, 0.16),
    topHi: shade(col, 0.28),
    side: shade(col, -0.05),
    sideDark: shade(col, -0.22),
    sideDeep: shade(col, -0.36),
    rim: shade(col, -0.42),
    accent: shade(col, 0.06),
  };
}
