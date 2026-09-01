/**
 * Capture the browser install prompt as soon as possible.
 * Chrome can fire beforeinstallprompt before the React bundle loads.
 */

let deferredPrompt = null;
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => fn(deferredPrompt));
}

function storePrompt(event) {
  if (!event) return;
  try {
    event.preventDefault();
  } catch {
    /* already canceled */
  }
  deferredPrompt = event;
  if (typeof window !== 'undefined') window.__tlPwaPrompt = event;
  notify();
}

export function isStandalonePwa() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    window.navigator.standalone === true
  );
}

export function isIosDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function startPwaInstallCapture() {
  if (typeof window === 'undefined') return;

  if (window.__tlPwaPrompt) storePrompt(window.__tlPwaPrompt);

  window.addEventListener(
    'beforeinstallprompt',
    (event) => {
      storePrompt(event);
    },
    true
  );

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    window.__tlPwaPrompt = null;
    notify();
  });
}

export function getDeferredInstallPrompt() {
  return deferredPrompt || (typeof window !== 'undefined' ? window.__tlPwaPrompt : null);
}

export function subscribeInstallPrompt(listener) {
  listeners.add(listener);
  listener(getDeferredInstallPrompt());
  return () => listeners.delete(listener);
}

/**
 * Must be called directly from a tap/click so Chrome keeps user activation.
 */
export function promptInstallApp() {
  const event = getDeferredInstallPrompt();
  if (!event?.prompt) return Promise.resolve({ outcome: 'unavailable' });
  deferredPrompt = null;
  if (typeof window !== 'undefined') window.__tlPwaPrompt = null;
  notify();
  try {
    event.prompt();
  } catch {
    return Promise.resolve({ outcome: 'unavailable' });
  }
  if (!event.userChoice) return Promise.resolve({ outcome: 'unavailable' });
  return event.userChoice
    .then((choice) => choice || { outcome: 'dismissed' })
    .catch(() => ({ outcome: 'unavailable' }));
}
