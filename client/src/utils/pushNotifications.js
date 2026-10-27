import api from '../api/client';
import { isStandalonePwa } from '../pwaInstall';

const PUSH_OPT_OUT_KEY = 'tl-push-opt-out';

let enableInflight = null;
let lastSyncedEndpoint = null;

/** True when running as an installed PWA (home screen / standalone). */
export function isInstalledPwa() {
  return isStandalonePwa();
}

export function isMobileDevice() {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
}

/** Notifications settings UI: mobile only (phone/tablet). */
export function canUseMobilePushUi() {
  return isMobileDevice();
}

export function hasPushOptOut() {
  try {
    return localStorage.getItem(PUSH_OPT_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setPushOptOut(optedOut) {
  try {
    if (optedOut) localStorage.setItem(PUSH_OPT_OUT_KEY, '1');
    else localStorage.removeItem(PUSH_OPT_OUT_KEY);
  } catch {
    /* ignore */
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export function currentNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
  return Notification.permission || 'denied';
}

export function notificationBlockedHelp() {
  if (typeof navigator === 'undefined') {
    return 'Notifications are blocked. Allow them in this device’s settings, then tap Enable again.';
  }
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent || '')) {
    return 'Notifications are blocked on this iPhone. Open Settings → Notifications → TL Portal (or Safari), turn Allow Notifications on, then return here and tap Enable again.';
  }
  return 'Notifications are blocked in this browser. Open site settings, allow Notifications, then tap Enable again.';
}

/**
 * Ask for notification permission from a user tap.
 * Safari/iOS: the callback form can report "granted" when the Promise form wrongly says "denied".
 * Auto-enable must never call this — a prompt without a tap is stored as denied.
 */
export async function requestPushPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';

  return new Promise((resolve) => {
    let finished = false;
    const finish = (value) => {
      const next = typeof value === 'string' ? value : Notification.permission;
      if (next === 'granted') {
        finished = true;
        resolve('granted');
        return;
      }
      if (finished) return;
      window.setTimeout(() => {
        if (finished) return;
        finished = true;
        resolve(Notification.permission === 'granted' ? 'granted' : next || Notification.permission);
      }, 50);
    };

    try {
      const result = Notification.requestPermission(finish);
      if (result && typeof result.then === 'function') {
        result.then(finish).catch(() => finish(Notification.permission));
      }
    } catch {
      finish(Notification.permission);
    }
  });
}

/**
 * Subscribe this device to Web Push and register with the API.
 * Works in the installed app and in a mobile/desktop browser that supports push.
 */
export async function enablePushNotifications(options = {}) {
  if (typeof window === 'undefined') {
    throw new Error('Not available in this environment.');
  }
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push notifications are not supported in this browser.');
  }

  const permission = options.silent
    ? currentNotificationPermission()
    : await requestPushPermission();
  if (permission !== 'granted') {
    throw new Error(notificationBlockedHelp());
  }

  const { data: keyData } = await api.get('/api/push/vapid-public-key');
  if (!keyData?.publicKey) {
    throw new Error(keyData?.message || 'Server push is not configured.');
  }

  const reg = await navigator.serviceWorker.ready;
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
    });
  }

  const payload = subscription.toJSON();
  const endpoint = payload?.endpoint || '';
  if (options.silent && lastSyncedEndpoint && lastSyncedEndpoint === endpoint) {
    return true;
  }

  await api.post(
    '/api/push/subscribe',
    {
      subscription: payload,
      userAgent: navigator.userAgent,
    },
    { skipSuccessPopup: true }
  );
  lastSyncedEndpoint = endpoint;
  setPushOptOut(false);

  return true;
}

/**
 * Silent enable for installed PWAs (existing and newly installed).
 * Skips if the user turned notifications off in Settings.
 */
export async function enablePushNotificationsSafe() {
  if (enableInflight) return enableInflight;
  enableInflight = (async () => {
    try {
      if (hasPushOptOut()) return false;
      if (!localStorage.getItem('token')) return false;
      if (!('Notification' in window) || Notification.permission !== 'granted') return false;
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
      await enablePushNotifications({ silent: true });
      return true;
    } catch {
      return false;
    } finally {
      enableInflight = null;
    }
  })();
  return enableInflight;
}

export async function disablePushNotifications() {
  setPushOptOut(true);
  lastSyncedEndpoint = null;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    await api.put('/api/push/preferences', { enabled: false });
    return;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.getSubscription();
    if (subscription) {
      const endpoint = subscription.endpoint;
      try {
        await subscription.unsubscribe();
      } catch {
        /* ignore */
      }
      await api.delete('/api/push/subscribe', { data: { endpoint } });
    } else {
      await api.put('/api/push/preferences', { enabled: false });
    }
  } catch {
    await api.put('/api/push/preferences', { enabled: false });
  }
}

export async function fetchPushStatus() {
  const { data } = await api.get('/api/push/status');
  return data;
}
