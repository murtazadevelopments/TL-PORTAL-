import api from '../api/client';
import { isStandalonePwa } from '../pwaInstall';

const PUSH_OPT_OUT_KEY = 'tl-push-opt-out';
const LAST_VAPID_KEY = 'tl-push-vapid-key';

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
  const base64 = (String(base64String || '') + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function arrayBufferToUrlBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function applicationServerKeyMatches(subscription, vapidPublicKey) {
  try {
    const key = subscription?.options?.applicationServerKey;
    if (!key || !vapidPublicKey) return false;
    return arrayBufferToUrlBase64(key) === String(vapidPublicKey).replace(/\s+/g, '');
  } catch {
    return false;
  }
}

function rememberVapidKey(vapidKey) {
  try {
    localStorage.setItem(LAST_VAPID_KEY, String(vapidKey || ''));
  } catch {
    /* ignore */
  }
}

function storedVapidKey() {
  try {
    return localStorage.getItem(LAST_VAPID_KEY) || '';
  } catch {
    return '';
  }
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

async function syncSubscriptionToServer(subscription) {
  const payload = subscription.toJSON();
  const endpoint = payload?.endpoint || '';
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
  return endpoint;
}

/**
 * Subscribe this device to Web Push and register with the API.
 * Reuses an existing browser subscription whenever the VAPID key still matches —
 * repeatedly unsubscribe/resubscribe orphans FCM endpoints and breaks delivery.
 */
export async function enablePushNotifications(options = {}) {
  if (enableInflight) return enableInflight;

  enableInflight = (async () => {
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

    const { data: keyData } = await api.get('/api/push/public-key');
    const vapidKey = keyData?.key || keyData?.publicKey;
    if (!vapidKey) {
      throw new Error(keyData?.message || 'Server push is not configured.');
    }

    const reg = await navigator.serviceWorker.ready;
    let subscription = await reg.pushManager.getSubscription();
    const keyChanged =
      Boolean(options.force) ||
      (subscription && !applicationServerKeyMatches(subscription, vapidKey)) ||
      (storedVapidKey() && storedVapidKey() !== vapidKey);

    if (subscription && keyChanged) {
      try {
        await subscription.unsubscribe();
      } catch {
        /* ignore */
      }
      subscription = null;
    }

    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
    }

    const endpoint = subscription?.endpoint || '';
    if (options.silent && lastSyncedEndpoint && lastSyncedEndpoint === endpoint) {
      rememberVapidKey(vapidKey);
      return true;
    }

    await syncSubscriptionToServer(subscription);
    rememberVapidKey(vapidKey);
    return true;
  })().finally(() => {
    enableInflight = null;
  });

  return enableInflight;
}

/**
 * Silent enable for installed PWAs (existing and newly installed).
 * Skips if the user turned notifications off in Settings.
 */
export async function enablePushNotificationsSafe() {
  try {
    if (hasPushOptOut()) return false;
    if (!localStorage.getItem('token')) return false;
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    await enablePushNotifications({ silent: true });
    return true;
  } catch {
    return false;
  }
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
