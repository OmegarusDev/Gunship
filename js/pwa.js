/**
 * Installable PWA (Android Chrome WebAPK / iOS Add to Home Screen).
 *
 * Installed launches use the manifest display mode (fullscreen).
 * The Fullscreen API is only used from an explicit FULLSCREEN control —
 * never from a generic pointerdown / game click.
 */

let updateSW = null;
let pendingUpdate = false;
let deferredInstall = null;
let isSafeToReload = () => true;
const surface = { screen: '', settingsOpen: false };
let hubLayout = null;

function $(id) {
  return typeof document === 'undefined' ? null : document.getElementById(id);
}

export function isStandaloneDisplay() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    Boolean(window.navigator.standalone)
  );
}

export function isManifestFullscreen() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: fullscreen)').matches;
}

export function isDomFullscreen() {
  if (typeof document === 'undefined') return false;
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

export function canPromptInstall() {
  return Boolean(deferredInstall);
}

function show(el, on) {
  if (!el) return;
  el.classList.toggle('hidden', !on);
}

export function setPwaSurface({ screen, settingsOpen } = {}) {
  if (screen !== undefined) surface.screen = screen;
  if (settingsOpen !== undefined) surface.settingsOpen = settingsOpen;
  refreshPwaChrome();
}

/** Pin the hub chips to the canvas header, opposite the cog. */
export function layoutPwaChrome(layout) {
  hubLayout = layout || null;
  refreshPwaChrome();
}

export function refreshPwaChrome() {
  const standalone = isStandaloneDisplay();
  const onHub = surface.screen === 'title' && !surface.settingsOpen;
  const chrome = $('pwa-chrome');
  if (chrome) {
    chrome.classList.toggle('hidden', !onHub);
    if (onHub && hubLayout) {
      const top = Math.max(0, (hubLayout.headerMetaY || 18) - 2);
      const right = Math.max(8, hubLayout.w - (hubLayout.content.x + hubLayout.content.w));
      chrome.style.top = `${top}px`;
      chrome.style.right = `${right}px`;
    } else {
      chrome.style.top = '';
      chrome.style.right = '';
    }
  }
  const install = $('pwa-install');
  if (install) {
    install.textContent = canPromptInstall() ? 'INSTALL APP' : 'HOW TO INSTALL';
    show(install, !standalone && onHub);
  }
  const fs = $('pwa-fullscreen');
  if (fs) {
    fs.textContent = isDomFullscreen() ? 'EXIT FULLSCREEN' : 'FULLSCREEN';
    show(fs, onHub);
  }
  show($('pwa-update'), pendingUpdate);
}

function showInstallHelp(on) {
  show($('pwa-install-help'), on);
}

export async function promptInstall() {
  if (isStandaloneDisplay()) return 'installed';
  if (deferredInstall) {
    try {
      deferredInstall.prompt();
      await deferredInstall.userChoice;
    } catch {
      /* dismissed or already consumed */
    }
    deferredInstall = null;
    refreshPwaChrome();
    return 'prompted';
  }
  showInstallHelp(true);
  return 'help';
}

export async function toggleFullscreen() {
  if (typeof document === 'undefined') return false;
  try {
    if (isDomFullscreen()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) await exit.call(document);
      refreshPwaChrome();
      return true;
    }
    const root = document.documentElement;
    const req = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!req) return false;
    await req.call(root);
    refreshPwaChrome();
    return true;
  } catch {
    return false;
  }
}

function wireButtons() {
  const install = $('pwa-install');
  if (install) install.addEventListener('click', () => promptInstall());
  const fs = $('pwa-fullscreen');
  if (fs) fs.addEventListener('click', () => toggleFullscreen());
  const update = $('pwa-update');
  if (update) update.addEventListener('click', () => applyPwaUpdate());
  const helpClose = $('pwa-install-help-close');
  if (helpClose) helpClose.addEventListener('click', () => showInstallHelp(false));
  const help = $('pwa-install-help');
  if (help) {
    help.addEventListener('click', (event) => {
      if (event.target === help) showInstallHelp(false);
    });
  }
  document.addEventListener('fullscreenchange', refreshPwaChrome);
  document.addEventListener('webkitfullscreenchange', refreshPwaChrome);
}

export function hasPwaUpdate() {
  return pendingUpdate;
}

export function applyPwaUpdate() {
  if (!pendingUpdate) return false;
  pendingUpdate = false;
  show($('pwa-update'), false);
  if (updateSW) updateSW();
  else window.location.reload();
  return true;
}

export function initPwa(hooks = {}) {
  if (typeof window === 'undefined') return;
  if (hooks.isSafeToReload) isSafeToReload = hooks.isSafeToReload;

  wireButtons();
  refreshPwaChrome();

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstall = event;
    refreshPwaChrome();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    showInstallHelp(false);
    refreshPwaChrome();
  });

  if (!('serviceWorker' in navigator)) return;

  const swUrl = new URL('../sw.js', import.meta.url).href;
  const scope = new URL('../', import.meta.url).href;

  navigator.serviceWorker
    .register(swUrl, { scope, updateViaCache: 'none' })
    .then((registration) => {
      const check = () => registration.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) check();
      });
      setInterval(check, 60 * 60 * 1000);
      if (registration.waiting) {
        pendingUpdate = true;
        if (isSafeToReload()) applyPwaUpdate();
        else refreshPwaChrome();
      }
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state !== 'installed' || !navigator.serviceWorker.controller) return;
          pendingUpdate = true;
          updateSW = () => {
            worker.postMessage({ type: 'SKIP_WAITING' });
            window.location.reload();
          };
          if (isSafeToReload()) applyPwaUpdate();
          else refreshPwaChrome();
        });
      });
    })
    .catch(() => {});

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (pendingUpdate && isSafeToReload()) window.location.reload();
  });
}
