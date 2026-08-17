const webpush = require('web-push');
const pool = require('../config/db');

let configured = false;

function configureVapid() {
  const publicKey = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = String(
    process.env.VAPID_SUBJECT || process.env.RESEND_FROM || 'mailto:noreply@texturedlab.org'
  ).trim();

  if (!publicKey || !privateKey) {
    configured = false;
    return false;
  }

  // Subject must be mailto: or https:
  let contact = subject;
  if (!/^mailto:/i.test(contact) && !/^https?:/i.test(contact)) {
    const emailMatch = contact.match(/[\w.+-]+@[\w.-]+/);
    contact = emailMatch ? `mailto:${emailMatch[0]}` : 'mailto:noreply@texturedlab.org';
  }

  webpush.setVapidDetails(contact, publicKey, privateKey);
  configured = true;
  return true;
}

function getVapidPublicKey() {
  return String(process.env.VAPID_PUBLIC_KEY || '').trim() || null;
}

function isPushConfigured() {
  if (!configured) configureVapid();
  return configured;
}

/**
 * Send a Web Push notification to all subscriptions for a user.
 * No-ops if push is not configured or user has notifications disabled.
 */
async function sendPushToUser(userId, payload) {
  if (!isPushConfigured()) return { sent: 0, skipped: true };

  const { rows: prefs } = await pool.query(
    `
      SELECT push_notifications_enabled
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );
  if (!prefs[0]?.push_notifications_enabled) {
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
        { TTL: 60 * 60 * 12, urgency: 'normal' }
      );
      sent += 1;
    } catch (err) {
      const status = err.statusCode || err.status;
      console.error(
        `[push] fail user=${userId} sub=${sub.id} status=${status}:`,
        err.message || err
      );
      // Gone / expired subscription — drop it
      if (status === 404 || status === 410) {
        try {
          await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
        } catch {
          /* ignore */
        }
      }
    }
  }

  return { sent };
}

/**
 * Best-effort; never throws to callers.
 */
async function sendPushToUserSafe(userId, payload) {
  try {
    return await sendPushToUser(userId, payload);
  } catch (err) {
    console.error('[push] unexpected error:', err.message || err);
    return { sent: 0, error: err.message };
  }
}

module.exports = {
  configureVapid,
  getVapidPublicKey,
  isPushConfigured,
  sendPushToUser,
  sendPushToUserSafe,
};
