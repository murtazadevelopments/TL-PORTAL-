/**
 * Capture the browser install prompt as soon as possible.
 * Chrome can fire beforeinstallprompt before the React bundle loads.
 */

let deferredPrompt = null;
const listeners = new Set();
const OPEN_HELP_EVENT = 'tl-open-install';

function ua() {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent || '';
}

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
  return (
    /iPad|iPhone|iPod/.test(ua()) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function isAndroidDevice() {
  return /Android/i.test(ua());
}

export function isPhoneOrTablet() {
  if (typeof navigator === 'undefined') return false;
  if (isIosDevice() || isAndroidDevice()) return true;
  return /Mobile|Tablet/i.test(ua());
}

export function isInAppBrowser() {
  const text = ua();
  return /FBAN|FBAV|Instagram|Line\/|Twitter|WhatsApp|Snapchat|TikTok|Bytedance|GSA\/|; wv\)|WebView/i.test(
    text
  );
}

export function isIosChromeOrOther() {
  return isIosDevice() && /CriOS|FxiOS|EdgiOS|OPiOS|OPT\//i.test(ua());
}

export function canNativeInstall() {
  return Boolean(getDeferredInstallPrompt()?.prompt);
}

/**
 * native — Chrome/Edge Android prompt
 * ios-safari — Share → Add to Home Screen
 * ios-other — must open Safari first
 * in-app — Facebook/Instagram/Gmail webview
 * manual — Chrome menu / desktop browser
 * installed
 */
export function getInstallKind() {
  if (isStandalonePwa()) return 'installed';
  if (isInAppBrowser()) return 'in-app';
  if (isIosChromeOrOther()) return 'ios-other';
  if (isIosDevice()) return 'ios-safari';
  if (canNativeInstall()) return 'native';
  return 'manual';
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

export function requestInstallHelp() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(OPEN_HELP_EVENT));
}

export function subscribeInstallHelp(listener) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(OPEN_HELP_EVENT, listener);
  return () => window.removeEventListener(OPEN_HELP_EVENT, listener);
}

export async function copyPortalLink() {
  const url = `${window.location.origin}/`;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const input = document.createElement('input');
    input.value = url;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
    return true;
  } catch {
    return false;
  }
}
