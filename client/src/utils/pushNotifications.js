import api from '../api/client';
import { isIosDevice, isStandalonePwa } from '../pwaInstall';
import { showError } from './successPopup';

const PUSH_OPT_OUT_KEY = 'tl-push-opt-out';
const LAST_VAPID_KEY = 'tl-push-vapid-key';
const ENSURE_AT_KEY = 'tl-push-ensure-at';
const SYNC_AT_KEY = 'tl-push-sync-at';
const RESUBSCRIBE_AT_KEY = 'tl-push-resub-at';
const BANNER_DISMISS_UNTIL_KEY = 'tl-push-banner-dismiss-until';
const HOUR_MS = 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * HOUR_MS;
const TEN_MIN_MS = 10 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

let ensureInflight = null;
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

/** Normalize VAPID public key to base64url without padding for comparisons. */
function normalizeVapidKey(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/=+$/g, '');
}

/**
 * Compare subscription.options.applicationServerKey (ArrayBuffer) to the
 * server VAPID public key. Both sides are base64url without padding.
 *
 * Missing/unreadable key → treat as match (do not force unsubscribe).
 * Only an explicit mismatched key returns false.
 */
function applicationServerKeyMatches(subscription, vapidPublicKey) {
  try {
    const expected = normalizeVapidKey(vapidPublicKey);
    if (!expected) return false;
    const key = subscription?.options?.applicationServerKey;
    if (!key) return true;
    const byteLength = key.byteLength ?? key.length;
    if (!byteLength) return true;
    return arrayBufferToUrlBase64(key) === expected;
  } catch {
    return true;
  }
}

function readStoredMs(storageKey) {
  try {
    const raw = Number(localStorage.getItem(storageKey) || 0);
    return Number.isFinite(raw) ? raw : 0;
  } catch {
    return 0;
  }
}

function writeStoredMs(storageKey, value = Date.now()) {
  try {
    localStorage.setItem(storageKey, String(value));
  } catch {
    /* ignore */
  }
}

function rememberVapidKey(vapidKey) {
  try {
    localStorage.setItem(LAST_VAPID_KEY, normalizeVapidKey(vapidKey));
  } catch {
    /* ignore */
  }
}

function markEnsureNow() {
  writeStoredMs(ENSURE_AT_KEY);
}

function lastEnsureAt() {
  return readStoredMs(ENSURE_AT_KEY);
}

function markSyncNow() {
  writeStoredMs(SYNC_AT_KEY);
}

function lastSyncAt() {
  return readStoredMs(SYNC_AT_KEY);
}

function markResubscribeNow() {
  writeStoredMs(RESUBSCRIBE_AT_KEY);
}

function lastResubscribeAt() {
  return readStoredMs(RESUBSCRIBE_AT_KEY);
}

function canResubscribeNow() {
  return Date.now() - lastResubscribeAt() >= TEN_MIN_MS;
}

export function isPushBannerDismissed() {
  try {
    const until = Number(localStorage.getItem(BANNER_DISMISS_UNTIL_KEY) || 0);
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

export function dismissPushBannerForWeek() {
  try {
    localStorage.setItem(BANNER_DISMISS_UNTIL_KEY, String(Date.now() + WEEK_MS));
  } catch {
    /* ignore */
  }
}

export function shouldShowPushEnableBanner() {
  if (typeof window === 'undefined') return false;
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false;
  }
  if (hasPushOptOut() || isPushBannerDismissed()) return false;
  if (Notification.permission !== 'default') return false;
  if (isIosDevice() && !isStandalonePwa()) return false;
  return true;
}

export function shouldShowIosInstallHint() {
  if (typeof window === 'undefined') return false;
  if (!isIosDevice() || isStandalonePwa()) return false;
  if (isPushBannerDismissed()) return false;
  if (!('Notification' in window)) return false;
  return Notification.permission === 'default';
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

function formatPushError(err) {
  const name = err?.name ? String(err.name) : 'Error';
  const message =
    err?.response?.data?.message ||
    err?.message ||
    'Could not enable notifications.';
  return `${name}: ${message}`;
}

/**
 * Upsert this device's subscription on the server.
 * Matching / reuse path: at most once per 6 hours (persisted), unless force.
 */
async function syncSubscriptionToServer(subscription, { force = false } = {}) {
  const payload = subscription.toJSON();
  const endpoint = payload?.endpoint || '';
  if (!force && endpoint) {
    let remembered = '';
    try {
      remembered = localStorage.getItem('tl-push-last-endpoint') || '';
    } catch {
      remembered = '';
    }
    const sameEndpoint = remembered === endpoint || lastSyncedEndpoint === endpoint;
    if (sameEndpoint && Date.now() - lastSyncAt() < SIX_HOURS_MS) {
      lastSyncedEndpoint = endpoint;
      return { endpoint, skipped: true };
    }
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
  markSyncNow();
  try {
    localStorage.setItem('tl-push-last-endpoint', endpoint);
  } catch {
    /* ignore */
  }
  setPushOptOut(false);
  return { endpoint, skipped: false };
}

async function unsubscribeQuiet(subscription) {
  if (!subscription) return;
  try {
    await subscription.unsubscribe();
  } catch {
    /* ignore */
  }
}

async function createSubscription(reg, vapidKey) {
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });
}

/**
 * Resubscribe at most once per 10 minutes (persisted). Returns false if blocked.
 */
function guardResubscribe(reason) {
  if (canResubscribeNow()) {
    markResubscribeNow();
    return true;
  }
  console.warn(
    `[push] Resubscribe blocked (${reason}): at most once per 10 minutes on this device.`
  );
  return false;
}

async function subscribeAndSave(vapidKey) {
  const reg = await navigator.serviceWorker.ready;
  let subscription = await reg.pushManager.getSubscription();

  if (subscription && applicationServerKeyMatches(subscription, vapidKey)) {
    await syncSubscriptionToServer(subscription);
    rememberVapidKey(vapidKey);
    return subscription;
  }

  // Existing sub with an explicit key mismatch — guarded unsubscribe + subscribe.
  if (subscription) {
    if (!guardResubscribe('vapid-key-mismatch')) {
      // Keep serving the existing endpoint; do not thrash.
      await syncSubscriptionToServer(subscription);
      return subscription;
    }
    await unsubscribeQuiet(subscription);
    subscription = null;
  }

  try {
    subscription = await createSubscription(reg, vapidKey);
  } catch (err) {
    if (err?.name === 'InvalidStateError') {
      if (!guardResubscribe('InvalidStateError')) {
        throw err;
      }
      const stale = await reg.pushManager.getSubscription();
      await unsubscribeQuiet(stale);
      subscription = await createSubscription(reg, vapidKey);
    } else {
      throw err;
    }
  }

  await syncSubscriptionToServer(subscription, { force: true });
  rememberVapidKey(vapidKey);
  return subscription;
}

/**
 * Keep this device's Web Push subscription in sync with the server.
 * - granted: reuse matching subscription (or resubscribe), then upsert.
 * - default/denied: no automatic permission prompt.
 * Silent background runs never toast errors.
 */
export async function ensurePushSubscription(options = {}) {
  const silent = options.silent !== false;
  // Default throttle on; callers may opt out for a user-initiated enable.
  const throttle = options.throttle !== false;

  // Single-flight: SignIn, AppShell, and visibility share one in-flight promise.
  if (ensureInflight) return ensureInflight;

  ensureInflight = (async () => {
    if (typeof window === 'undefined') return { ok: false, reason: 'ssr' };
    if (!localStorage.getItem('token')) return { ok: false, reason: 'anon' };
    if (hasPushOptOut() && silent) return { ok: false, reason: 'opt-out' };

    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      return { ok: false, reason: 'unsupported' };
    }

    if (throttle && Date.now() - lastEnsureAt() < HOUR_MS) {
      return { ok: true, reason: 'throttled' };
    }

    const permission = currentNotificationPermission();
    if (permission !== 'granted') {
      return { ok: false, reason: permission };
    }

    try {
      const { data: keyData } = await api.get('/api/push/public-key');
      const vapidKey = keyData?.key || keyData?.publicKey;
      if (!vapidKey) {
        throw new Error(keyData?.message || 'Server push is not configured.');
      }
      await subscribeAndSave(vapidKey);
      markEnsureNow();
      return { ok: true };
    } catch (err) {
      if (!silent) {
        showError(formatPushError(err));
      }
      return { ok: false, reason: 'error', error: err };
    }
  })().finally(() => {
    ensureInflight = null;
  });

  return ensureInflight;
}

/**
 * User-initiated enable (Settings / banner). May request permission.
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

  setPushOptOut(false);
  const result = await ensurePushSubscription({ silent: false, throttle: false });
  if (!result?.ok) {
    throw result?.error || new Error('Could not enable notifications.');
  }
  return true;
}

/** @deprecated Prefer ensurePushSubscription({ silent: true }) */
export async function enablePushNotificationsSafe() {
  try {
    if (hasPushOptOut()) return false;
    if (!localStorage.getItem('token')) return false;
    if (currentNotificationPermission() !== 'granted') return false;
    const result = await ensurePushSubscription({ silent: true, throttle: true });
    return Boolean(result?.ok);
  } catch {
    return false;
  }
}

/**
 * User-initiated logout only: delete this device endpoint on the server, then
 * unsubscribe locally. Call while the auth token is still present.
 * Never throws; bounded by a short timeout so logout is never blocked.
 */
export async function clearDevicePushSubscription({ timeoutMs = 2500 } = {}) {
  lastSyncedEndpoint = null;
  try {
    localStorage.removeItem('tl-push-last-endpoint');
    localStorage.removeItem(SYNC_AT_KEY);
  } catch {
    /* ignore */
  }
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  const run = async () => {
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.getSubscription();
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    try {
      await api.delete('/api/push/subscription', {
        data: { endpoint },
        skipSuccessPopup: true,
      });
    } catch {
      /* ignore network/auth failures during logout */
    }
    try {
      await subscription.unsubscribe();
    } catch {
      /* ignore */
    }
  };

  try {
    await Promise.race([
      run(),
      new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error('push-clear-timeout')), timeoutMs);
      }),
    ]);
  } catch {
    /* ignore timeout / failures — logout must continue */
  }
}

export async function disablePushNotifications() {
  setPushOptOut(true);
  lastSyncedEndpoint = null;
  try {
    localStorage.removeItem('tl-push-last-endpoint');
    localStorage.removeItem(SYNC_AT_KEY);
  } catch {
    /* ignore */
  }
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
