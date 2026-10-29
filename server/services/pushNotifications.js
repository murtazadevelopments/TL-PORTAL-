const pool = require('../config/db');
const { publicKey, webpush } = require('../config/vapid');

/**
 * Send a Web Push notification to all subscriptions for a user.
 * No-ops if the user has notifications disabled when requireEnabled is true.
 */
async function sendPushToUser(userId, payload, opts = {}) {
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

  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
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

async function dropStaleSubscription(subId, userId, status) {
  console.warn(`[push] dropped stale sub user=${userId} sub=${subId} status=${status}`);
  try {
    await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [subId]);
  } catch {
    /* ignore */
  }
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

function getVapidPublicKey() {
  return publicKey;
}

function isPushConfigured() {
  return Boolean(publicKey);
}

function getPushConfigError() {
  return '';
}

/** @deprecated VAPID is configured in server/config/vapid.js at load time. */
function configureVapid() {
  return true;
}

module.exports = {
  configureVapid,
  getVapidPublicKey,
  isPushConfigured,
  getPushConfigError,
  sendPushToUser,
  sendPushToUserSafe,
};
