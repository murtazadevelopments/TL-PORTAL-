import api from '../api/client';

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

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Subscribe this device to Web Push and register with the API.
 * Requires: installed mobile PWA, notification permission, active service worker.
 */
export async function enablePushNotifications() {
  if (typeof window === 'undefined') {
    throw new Error('Not available in this environment.');
  }
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push notifications are not supported in this browser.');
  }
  if (!isMobileDevice()) {
    throw new Error('Notifications are only available on mobile.');
  }
  if (!isInstalledPwa()) {
    throw new Error('Install the app on your phone first, then open it from the home screen.');
  }

  const permission = await Notification.requestPermission();
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

  return true;
}

export async function disablePushNotifications() {
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
