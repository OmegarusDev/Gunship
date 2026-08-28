/**
 * sim/sortieLogic.js — sortie-specific helpers (extracted from app.js).
 * This file will eventually hold the full tick logic; for now it re-exports
 * shared helpers so screens/sortie.js can import without circular deps.
 */
export * from './state.js';
export * from './movement.js';
export * from './objectives.js';
