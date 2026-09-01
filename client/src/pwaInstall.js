/**
 * Capture the browser install prompt as soon as the app boots so any
 * Install App button can open it on click (the event only fires once).
 */

let deferredPrompt = null;
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => fn(deferredPrompt));
}

export function startPwaInstallCapture() {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    notify();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

export function getDeferredInstallPrompt() {
  return deferredPrompt;
}

export function subscribeInstallPrompt(listener) {
  listeners.add(listener);
  listener(deferredPrompt);
  return () => listeners.delete(listener);
}

export async function promptInstallApp() {
  const event = deferredPrompt;
  if (!event?.prompt) return { outcome: 'unavailable' };
  event.prompt();
  const choice = await event.userChoice;
  deferredPrompt = null;
  notify();
  return choice || { outcome: 'dismissed' };
}
