const pool = require('../config/db');
const { publicKey, webpush } = require('../config/vapid');

function endpointHost(endpoint) {
  try {
    return new URL(String(endpoint || '')).host || 'unknown';
  } catch {
    return 'unknown';
  }
}

function errorBodySnippet(err) {
  const raw = err?.body != null ? err.body : err?.message;
  if (raw == null) return '';
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  return text.replace(/\s+/g, ' ').trim().slice(0, 240);
}

/**
 * Send a Web Push notification to all subscriptions for a user.
 * No-ops if the user has notifications disabled when requireEnabled is true.
 * Behavior unchanged; adds diagnostic logging and optional per-sub results.
 */
async function sendPushToUser(userId, payload, opts = {}) {
  const requireEnabled = opts.requireEnabled === true;
  const eventType = String(opts.event || payload?.tag || payload?.title || 'portal-update')
    .trim()
    .slice(0, 80) || 'portal-update';

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
    console.log(`[push] event=${eventType} user=${userId} subs=0 status=disabled`);
    return { sent: 0, disabled: true, results: [] };
  }

  const { rows: subs } = await pool.query(
    `
      SELECT id, endpoint, p256dh, auth
      FROM push_subscriptions
      WHERE user_id = $1
    `,
    [userId]
  );

  if (!subs.length) {
    console.log(`[push] event=${eventType} user=${userId} subs=0 status=none`);
    return { sent: 0, results: [] };
  }

  const body = JSON.stringify({
    title: payload.title || 'Textured Lab Portal',
    body: payload.body || '',
    url: payload.url || '/account/messages',
    tag: payload.tag || 'portal-update',
  });

  let sent = 0;
  const results = [];
  for (const sub of subs) {
    const host = endpointHost(sub.endpoint);
    try {
      const response = await webpush.sendNotification(
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
      const okStatus = Number(response?.statusCode) || 201;
      results.push({ id: sub.id, host, status: okStatus, error: '' });
    } catch (err) {
      const status = err.statusCode || err.status || 0;
      const error = errorBodySnippet(err);
      results.push({ id: sub.id, host, status, error });
      // 404/410 = endpoint gone — drop. 401/403 = auth/VAPID issue — keep + warn.
      if (status === 404 || status === 410) {
        await dropStaleSubscription(sub.id, userId, status);
      } else if (status === 401 || status === 403) {
        console.warn(`[push] auth fail user=${userId} host=${host} status=${status}`);
      } else {
        console.error(
          `[push] fail user=${userId} sub=${sub.id} status=${status}:`,
          err.message || err
        );
      }
    }
  }

  const statusSummary = results
    .map((row) => `${row.host}:${row.status}${row.error ? `(${row.error})` : ''}`)
    .join(',');
  console.log(
    `[push] event=${eventType} user=${userId} subs=${subs.length} status=${statusSummary || 'none'}`
  );

  return { sent, results };
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
    return { sent: 0, error: err.message, results: [] };
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
  endpointHost,
};
