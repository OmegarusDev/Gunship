/**
 * sim/gameState.js — minimal shared mutable state for the sortie screen.
 * Only the core that both app.js and screens/sortie.js need.
 * UI-only vars (titleMenuBoxes etc.) stay in app.js.
 */
import { createHeli, createBoss, createBossState, createSortieState } from './state.js';

export let world = null;
export let sharedTerrain = null;
export let terrainNoise = null;
export let moistureNoise = null;
export let detailNoise = null;
export function setWorld(w) { world = w; }
export function setSharedTerrain(t) { sharedTerrain = t; }
export function setNoises(tn, mn, dn) { terrainNoise = tn; moistureNoise = mn; detailNoise = dn; }

export let career = null;
export let activeContract = null;
export let sortieXpEarned = 0;
export let sortieDollarsEarned = 0;
export function setCareer(c) { career = c; }
export function setActiveContract(c) { activeContract = c; }
export function setSortieXp(n) { sortieXpEarned = n; }
export function setSortieDollars(n) { sortieDollarsEarned = n; }

export const sortieState = createSortieState();
export const heli = createHeli();
export const boss = createBoss();
export const bossState = createBossState();

export const projectiles = [];
export const explosions = [];
export const enemies = [];
export const floatingTexts = [];

export let sortieStartedAt = performance.now();
export let lastFps = 0;
export let modeToastUntil = 0;
export let lastShotX = 0, lastShotY = 0, lastShotT = -999;
export function setSortieStartedAt(t) { sortieStartedAt = t; }
export function setLastFps(n) { lastFps = n; }
export function setModeToastUntil(t) { modeToastUntil = t; }
export function setLastShot(x, y, t) { lastShotX = x; lastShotY = y; lastShotT = t; }

export let selectedEquipment = 'rocket';
export function setSelectedEquipment(v) { selectedEquipment = v; }
