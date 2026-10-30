/**
 * Pure Web Push VAPID key helpers (safe to import from Node tests).
 */

/** Convert a base64url (or base64) VAPID public key string to bytes. */
export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (String(base64String || '').length % 4)) % 4);
  const base64 = (String(base64String || '') + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Encode an ArrayBuffer / TypedArray as base64url with no padding.
 * Used for comparing PushSubscription.options.applicationServerKey to the server key.
 */
export function keyToB64u(arrayBuffer) {
  const bytes =
    arrayBuffer instanceof Uint8Array
      ? arrayBuffer
      : new Uint8Array(arrayBuffer == null ? [] : arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** Normalize a VAPID public key string to base64url without padding. */
export function normalizeVapidKey(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/=+$/g, '');
}

/**
 * Compare subscription applicationServerKey (ArrayBuffer) to a server VAPID public key string.
 * Both sides are encoded with keyToB64u. Missing/empty subscription key → treat as match
 * (do not force unsubscribe).
 */
export function applicationServerKeyMatches(subscription, vapidPublicKey) {
  try {
    const expectedRaw = normalizeVapidKey(vapidPublicKey);
    if (!expectedRaw) return false;
    const key = subscription?.options?.applicationServerKey;
    if (!key) return true;
    const byteLength = key.byteLength ?? key.length;
    if (!byteLength) return true;
    const expectedBytes = urlBase64ToUint8Array(expectedRaw);
    return keyToB64u(key) === keyToB64u(expectedBytes);
  } catch {
    return true;
  }
}
