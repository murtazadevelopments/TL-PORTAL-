const pool = require('../config/db');
const {
  getVapidPublicKey,
  isPushConfigured,
} = require('../services/pushNotifications');

/**
 * GET /api/push/vapid-public-key
 */
function getPublicKey(req, res) {
  if (!isPushConfigured()) {
    return res.status(503).json({
      configured: false,
      message: 'Push notifications are not configured on the server.',
    });
  }
  return res.json({
    configured: true,
    publicKey: getVapidPublicKey(),
  });
}

/**
 * GET /api/push/status
 */
async function getStatus(req, res) {
  const configured = isPushConfigured();
  let enabled = false;
  let subscriptionCount = 0;
  let schemaReady = true;

  try {
    const { rows } = await pool.query(
      `
        SELECT push_notifications_enabled AS enabled
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [req.user.id]
    );
    enabled = Boolean(rows[0]?.enabled);
  } catch (err) {
    schemaReady = false;
    console.error('push getStatus prefs error:', err.message || err);
  }

  try {
    const { rows: subs } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM push_subscriptions WHERE user_id = $1`,
      [req.user.id]
    );
    subscriptionCount = subs[0]?.count || 0;
  } catch (err) {
    schemaReady = false;
    console.error('push getStatus subs error:', err.message || err);
  }

  return res.json({
    configured: configured && schemaReady,
    enabled,
    subscriptionCount,
    schemaReady,
    message: !configured || !schemaReady
      ? 'Notifications are unavailable. Please contact your admin.'
      : undefined,
  });
}

/**
 * POST /api/push/subscribe
 * Body: { subscription: { endpoint, keys: { p256dh, auth } }, userAgent? }
 */
async function subscribe(req, res) {
  try {
    if (!isPushConfigured()) {
      return res.status(503).json({ message: 'Push notifications are not configured.' });
    }

    const sub = req.body?.subscription || req.body;
    const endpoint = String(sub?.endpoint || '').trim();
    const p256dh = String(sub?.keys?.p256dh || '').trim();
    const auth = String(sub?.keys?.auth || '').trim();
    const userAgent = String(req.body?.userAgent || req.headers['user-agent'] || '').slice(
      0,
      500
    );

    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({
        message: 'subscription.endpoint and keys (p256dh, auth) are required.',
      });
    }

    await pool.query(
      `
        INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (endpoint) DO UPDATE
          SET user_id = EXCLUDED.user_id,
              p256dh = EXCLUDED.p256dh,
              auth = EXCLUDED.auth,
              user_agent = EXCLUDED.user_agent,
              updated_at = NOW()
      `,
      [req.user.id, endpoint, p256dh, auth, userAgent || null]
    );

    await pool.query(
      `
        UPDATE users
        SET push_notifications_enabled = TRUE, updated_at = NOW()
        WHERE id = $1
      `,
      [req.user.id]
    );

    return res.json({ message: 'Notifications enabled on this device.', enabled: true });
  } catch (err) {
    console.error('push subscribe error:', err);
    return res.status(500).json({ message: 'Server error saving subscription.' });
  }
}

/**
 * DELETE /api/push/subscribe
 * Body optional: { endpoint } — remove one device, or all for user
 */
async function unsubscribe(req, res) {
  try {
    const endpoint = String(req.body?.endpoint || req.query?.endpoint || '').trim();

    if (endpoint) {
      await pool.query(
        `DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`,
        [req.user.id, endpoint]
      );
    } else {
      await pool.query(`DELETE FROM push_subscriptions WHERE user_id = $1`, [
        req.user.id,
      ]);
    }

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM push_subscriptions WHERE user_id = $1`,
      [req.user.id]
    );
    if (!(rows[0]?.count > 0)) {
      await pool.query(
        `
          UPDATE users
          SET push_notifications_enabled = FALSE, updated_at = NOW()
          WHERE id = $1
        `,
        [req.user.id]
      );
    }

    return res.json({
      message: 'Notifications disabled for this device.',
      enabled: Boolean(rows[0]?.count > 0),
    });
  } catch (err) {
    console.error('push unsubscribe error:', err);
    return res.status(500).json({ message: 'Server error removing subscription.' });
  }
}

/**
 * PUT /api/push/preferences  { enabled: boolean }
 * When disabling, wipe subscriptions for this user.
 */
async function setPreferences(req, res) {
  try {
    const enabled = Boolean(req.body?.enabled);
    await pool.query(
      `
        UPDATE users
        SET push_notifications_enabled = $1, updated_at = NOW()
        WHERE id = $2
      `,
      [enabled, req.user.id]
    );
    if (!enabled) {
      await pool.query(`DELETE FROM push_subscriptions WHERE user_id = $1`, [
        req.user.id,
      ]);
    }
    return res.json({ enabled });
  } catch (err) {
    console.error('push setPreferences error:', err);
    return res.status(500).json({ message: 'Server error updating preferences.' });
  }
}

module.exports = {
  getPublicKey,
  getStatus,
  subscribe,
  unsubscribe,
  setPreferences,
};
