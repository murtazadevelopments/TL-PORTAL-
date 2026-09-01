import api from '../api/client';

const PUSH_OPT_OUT_KEY = 'tl-push-opt-out';

let enableInflight = null;

/** True when running as an installed PWA (home screen / standalone). */
export function isInstalledPwa() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
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

export async function requestPushPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/**
 * Subscribe this device to Web Push and register with the API.
 * Requires: installed PWA, notification permission, active service worker.
 */
export async function enablePushNotifications() {
  if (typeof window === 'undefined') {
    throw new Error('Not available in this environment.');
  }
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push notifications are not supported in this browser.');
  }
  if (!isInstalledPwa()) {
    throw new Error('Install the app on your phone first, then open it from the home screen.');
  }

  const permission = await requestPushPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission was denied.');
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

  await api.post('/api/push/subscribe', {
    subscription: subscription.toJSON(),
    userAgent: navigator.userAgent,
  });
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
      if (!isInstalledPwa()) return false;
      if (!('Notification' in window) || Notification.permission === 'denied') return false;
      await enablePushNotifications();
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
