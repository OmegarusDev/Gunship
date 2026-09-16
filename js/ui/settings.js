/**
 * Player UI prefs (not career). Survive RESET SAVE? No — wipeAllSaves only
 * clears roster keys. These live on their own key so a wipe doesn't fight
 * fullscreen/hover muscle memory. Hover-tips still default on.
 */

const KEY = 'gunship_settings_v1';

export const uiSettings = {
  hoverTips: true,
};

export function finePointerHover() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

export function hoverTipsActive() {
  return Boolean(uiSettings.hoverTips) && finePointerHover();
}

export function loadUiSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return uiSettings;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.hoverTips === 'boolean') uiSettings.hoverTips = parsed.hoverTips;
  } catch {
    /* private mode */
  }
  return uiSettings;
}

export function saveUiSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ hoverTips: uiSettings.hoverTips }));
  } catch {
    /* ignore */
  }
}

export function setUiSetting(key, value) {
  if (key === 'hoverTips') uiSettings.hoverTips = Boolean(value);
  saveUiSettings();
}
