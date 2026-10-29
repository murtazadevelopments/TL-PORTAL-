const crypto = require('crypto');
const pool = require('../config/db');

let webpush = null;
let configured = false;
let configureAttempted = false;
let lastConfigError = '';
let vapidSyncPromise = null;

function loadWebPush() {
  if (webpush) return webpush;
  try {
    webpush = require('web-push');
    return webpush;
  } catch (err) {
    console.error('[push] web-push package missing — run npm install in server/', err.message);
    return null;
  }
}

/** Hostinger/env panels often wrap values in quotes or inject newlines. */
function cleanEnvKey(value) {
  return String(value || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\s+/g, '');
}

function b64UrlToBuffer(value) {
  const pad = '='.repeat((4 - (value.length % 4)) % 4);
  const b64 = (value + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

function fingerprintPublicKey(publicKey) {
  return crypto.createHash('sha256').update(publicKey, 'utf8').digest('hex').slice(0, 16);
}

/**
 * When VAPID keys rotate, every stored browser endpoint was signed with the old
 * public key and FCM/APNs return 403. Wipe those rows so clients can re-subscribe.
 */
async function syncSubscriptionsToCurrentVapid(publicKey) {
  const fp = fingerprintPublicKey(publicKey);
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const { rows } = await pool.query(
      `SELECT value FROM app_meta WHERE key = 'vapid_public_fp' LIMIT 1`
    );
    const previous = rows[0]?.value || null;
    if (previous === fp) return;

    const deleted = await pool.query('DELETE FROM push_subscriptions');
    await pool.query(
      `
        INSERT INTO app_meta (key, value, updated_at)
        VALUES ('vapid_public_fp', $1, NOW())
        ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value, updated_at = NOW()
      `,
      [fp]
    );

    const count = deleted.rowCount || 0;
    if (previous) {
      console.warn(
        `[push] VAPID key changed (${previous} → ${fp}); cleared ${count} stale subscription(s). Devices must Enable notifications again.`
      );
    } else {
      console.log(
        `[push] Recorded VAPID fingerprint ${fp}; cleared ${count} prior subscription(s) so clients rebind to the current key.`
      );
    }
  } catch (err) {
    console.error('[push] vapid subscription sync failed:', err.message || err);
  }
}

function configureVapid() {
  configureAttempted = true;
  lastConfigError = '';

  const publicKey = cleanEnvKey(process.env.VAPID_PUBLIC_KEY);
  const privateKey = cleanEnvKey(process.env.VAPID_PRIVATE_KEY);
  const subject = String(
    process.env.VAPID_SUBJECT || process.env.SMTP_FROM || 'mailto:noreply@texturedlab.org'
  ).trim();

  if (!publicKey || !privateKey) {
    configured = false;
    lastConfigError = 'missing_vapid_keys';
    return false;
  }

  try {
    const pubBytes = b64UrlToBuffer(publicKey).length;
    const privBytes = b64UrlToBuffer(privateKey).length;
    if (pubBytes !== 65) {
      configured = false;
      lastConfigError = `bad_public_key_length:${pubBytes}`;
      console.error(
        `[push] VAPID_PUBLIC_KEY is invalid (decoded ${pubBytes} bytes, need 65). ` +
          `Chars=${publicKey.length}. Paste the full key into Hostinger env with no quotes or spaces.`
      );
      return false;
    }
    if (privBytes !== 32) {
      configured = false;
      lastConfigError = `bad_private_key_length:${privBytes}`;
      console.error(
        `[push] VAPID_PRIVATE_KEY is invalid (decoded ${privBytes} bytes, need 32). ` +
          `Chars=${privateKey.length}. Paste the full key into Hostinger env with no quotes or spaces.`
      );
      return false;
    }
  } catch (err) {
    configured = false;
    lastConfigError = 'vapid_decode_failed';
    console.error('[push] Could not decode VAPID keys:', err.message || err);
    return false;
  }

  const wp = loadWebPush();
  if (!wp) {
    configured = false;
    lastConfigError = 'web_push_missing';
    return false;
  }

  // Subject must be mailto: or https:
  let contact = subject;
  if (!/^mailto:/i.test(contact) && !/^https?:/i.test(contact)) {
    const emailMatch = contact.match(/[\w.+-]+@[\w.-]+/);
    contact = emailMatch ? `mailto:${emailMatch[0]}` : 'mailto:noreply@texturedlab.org';
  }

  try {
    wp.setVapidDetails(contact, publicKey, privateKey);
    configured = true;
    lastConfigError = '';
    if (!vapidSyncPromise) {
      vapidSyncPromise = syncSubscriptionsToCurrentVapid(publicKey).finally(() => {
        vapidSyncPromise = null;
      });
    }
    return true;
  } catch (err) {
    configured = false;
    lastConfigError = err.message || 'set_vapid_failed';
    console.error('[push] setVapidDetails failed:', err.message || err);
    return false;
  }
}

function getVapidPublicKey() {
  return cleanEnvKey(process.env.VAPID_PUBLIC_KEY) || null;
}

function isPushConfigured() {
  if (!configureAttempted) configureVapid();
  return configured;
}

function getPushConfigError() {
  if (!configureAttempted) configureVapid();
  return lastConfigError;
}

async function dropStaleSubscription(subId, userId, status) {
  console.warn(`[push] dropped stale sub user=${userId} sub=${subId} status=${status}`);
  try {
    await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [subId]);
  } catch {
    /* ignore */
  }
}

/**
 * Send a Web Push notification to all subscriptions for a user.
 * No-ops if push is not configured or user has notifications disabled.
 */
async function sendPushToUser(userId, payload, opts = {}) {
  if (!isPushConfigured()) return { sent: 0, skipped: true, error: lastConfigError || 'not_configured' };

  if (vapidSyncPromise) {
    try {
      await vapidSyncPromise;
    } catch {
      /* already logged */
    }
  }

  const requireEnabled = opts.requireEnabled === true;
  const { rows: prefs } = await pool.query(
    `
      SELECT push_notifications_enabled
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );
  if (requireEnabled && !prefs[0]?.push_notifications_enabled) {
    return { sent: 0, disabled: true };
  }

  const { rows: subs } = await pool.query(
    `
      SELECT id, endpoint, p256dh, auth
      FROM push_subscriptions
      WHERE user_id = $1
    `,
    [userId]
  );

  if (!subs.length) return { sent: 0 };

  const body = JSON.stringify({
    title: payload.title || 'Textured Lab Portal',
    body: payload.body || '',
    url: payload.url || '/account/messages',
    tag: payload.tag || 'portal-update',
  });

  const wp = loadWebPush();
  if (!wp) return { sent: 0, skipped: true };

  let sent = 0;
  for (const sub of subs) {
    try {
      await wp.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        body,
        {
          TTL: Number.isFinite(opts.ttl) ? opts.ttl : 60 * 60 * 12,
          urgency: opts.urgency || 'high',
        }
      );
      sent += 1;
    } catch (err) {
      const status = err.statusCode || err.status;
      // 404/410 = endpoint gone. 401/403 = usually old VAPID key after rotation.
      if (status === 404 || status === 410 || status === 401 || status === 403) {
        await dropStaleSubscription(sub.id, userId, status);
      } else {
        console.error(
          `[push] fail user=${userId} sub=${sub.id} status=${status}:`,
          err.message || err
        );
      }
    }
  }

  return { sent };
}

/**
 * Best-effort; never throws to callers.
 */
async function sendPushToUserSafe(userId, payload, opts) {
  try {
    return await sendPushToUser(userId, payload, opts);
  } catch (err) {
    console.error('[push] unexpected error:', err.message || err);
    return { sent: 0, error: err.message };
  }
}

module.exports = {
  configureVapid,
  getVapidPublicKey,
  isPushConfigured,
  getPushConfigError,
  sendPushToUser,
  sendPushToUserSafe,
};
