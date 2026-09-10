/**
 * Single mutable session store. Screens and the sortie tick read and write
 * here; app.js must not keep a parallel world/career/board copy.
 */
import { createHeli, createBoss, createBossState, createSortieState } from './state.js';

export let world = null;
export let sharedTerrain = null;
export let terrainNoise = null;
export let moistureNoise = null;
export let detailNoise = null;
export function setWorld(w) {
  world = w;
}
export function setSharedTerrain(t) {
  sharedTerrain = t;
}
export function setNoises(tn, mn, dn) {
  terrainNoise = tn;
  moistureNoise = mn;
  detailNoise = dn;
}

export let career = null;
export let activeContract = null;
export let sortieXpEarned = 0;
export let sortieDollarsEarned = 0;
export let contractBoard = [];
export const titleMenuBoxes = [];
export const briefingEquipmentBoxes = [];
export const sortieContext = {
  mode: 'campaign',
  pilotName: null,
  gunshipId: null,
  outcomeCommitted: false,
};
export function setCareer(c) {
  career = c;
}
export function setActiveContract(c) {
  activeContract = c;
}
export function setSortieXp(n) {
  sortieXpEarned = n;
}
export function setSortieDollars(n) {
  sortieDollarsEarned = n;
}
export function addSortieXp(n) {
  if (sortieContext.mode === 'practice' || !Number.isFinite(n) || n <= 0) return;
  sortieXpEarned += n;
}
export function addSortieDollars(n) {
  if (sortieContext.mode === 'practice' || !Number.isFinite(n) || n <= 0) return;
  sortieDollarsEarned += n;
}
export function setContractBoard(b) {
  contractBoard = b;
}
export function setSortieMode(mode = 'campaign') {
  sortieContext.mode = mode === 'practice' ? 'practice' : 'campaign';
  sortieContext.pilotName = null;
  sortieContext.gunshipId = null;
  sortieContext.outcomeCommitted = false;
}
export function captureSortieSnapshot() {
  sortieContext.pilotName = career?.pilot?.name || 'UNKNOWN PILOT';
  sortieContext.gunshipId = career?.gunship || 'cobra';
  sortieContext.outcomeCommitted = false;
}
export function isPracticeSortie() {
  return sortieContext.mode === 'practice';
}

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
export let lastShotX = 0,
  lastShotY = 0,
  lastShotT = -999;
export function setSortieStartedAt(t) {
  sortieStartedAt = t;
}
export function setLastFps(n) {
  lastFps = n;
}
export function setModeToastUntil(t) {
  modeToastUntil = t;
}
export function setLastShot(x, y, t) {
  lastShotX = x;
  lastShotY = y;
  lastShotT = t;
}

export let selectedEquipment = 'rocket';
export function setSelectedEquipment(v) {
  selectedEquipment = v;
}
