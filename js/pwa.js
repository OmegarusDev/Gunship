/**
 * Installable PWA (Android Chrome WebAPK / iOS Add to Home Screen).
 * Fullscreen comes only from the installed app's manifest display mode.
 * Never call the Fullscreen API in a normal browser tab.
 */

let updateSW = null;
let pendingUpdate = false;
let deferredInstall = null;
let isSafeToReload = () => true;

function $(id) {
  return typeof document === 'undefined' ? null : document.getElementById(id);
}

export function isStandaloneDisplay() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean(window.navigator.standalone)
  );
}

function show(el, on) {
  if (!el) return;
  el.classList.toggle('hidden', !on);
}

function wireInstallButton() {
  const btn = $('pwa-install');
  if (!btn) return;
  const refresh = () => show(btn, Boolean(deferredInstall) && !isStandaloneDisplay());
  btn.addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    try {
      await deferredInstall.userChoice;
    } catch {
      /* dismissed */
    }
    deferredInstall = null;
    refresh();
  });
  refresh();
}

function wireUpdateButton() {
  const btn = $('pwa-update');
  if (!btn) return;
  btn.addEventListener('click', () => applyPwaUpdate());
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
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (hooks.isSafeToReload) isSafeToReload = hooks.isSafeToReload;

  wireInstallButton();
  wireUpdateButton();

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstall = event;
    show($('pwa-install'), !isStandaloneDisplay());
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    show($('pwa-install'), false);
  });

  const swUrl = new URL('../sw.js', import.meta.url);
  navigator.serviceWorker
    .register(swUrl, { scope: new URL('../', import.meta.url).pathname })
    .then((registration) => {
      const check = () => registration.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) check();
      });
      setInterval(check, 60 * 60 * 1000);
      if (registration.waiting) {
        pendingUpdate = true;
        if (isSafeToReload()) applyPwaUpdate();
        else show($('pwa-update'), true);
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
          else show($('pwa-update'), true);
        });
      });
    })
    .catch(() => {});

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (pendingUpdate && isSafeToReload()) window.location.reload();
  });
}
