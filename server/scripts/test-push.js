/**
 * Send a diagnostic Web Push to every subscription for a user.
 *
 * Usage (from server/):
 *   node scripts/test-push.js <username>
 *
 * Prints subscription count and per-subscription host + HTTP status only.
 * Never prints keys or full endpoints.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = require('../config/db');
const {
  sendPushToUser,
  isPushConfigured,
  endpointHost,
} = require('../services/pushNotifications');

async function main() {
  const username = String(process.argv[2] || '').trim();
  if (!username) {
    console.error('Usage: node scripts/test-push.js <username>');
    process.exit(1);
  }

  if (!isPushConfigured()) {
    console.error('[test-push] Web Push is not configured (VAPID missing).');
    process.exit(1);
  }

  const { rows: users } = await pool.query(
    `
      SELECT id, username, name, push_notifications_enabled
      FROM users
      WHERE LOWER(username) = LOWER($1)
      LIMIT 1
    `,
    [username]
  );
  const user = users[0];
  if (!user) {
    console.error(`[test-push] user not found: ${username}`);
    process.exit(1);
  }

  const { rows: subs } = await pool.query(
    `
      SELECT id, endpoint
      FROM push_subscriptions
      WHERE user_id = $1
      ORDER BY updated_at DESC NULLS LAST, id DESC
    `,
    [user.id]
  );

  console.log(
    `[test-push] user=${user.username} id=${user.id} prefs_enabled=${Boolean(
      user.push_notifications_enabled
    )} subscriptions=${subs.length}`
  );

  if (!subs.length) {
    console.log('[test-push] No subscriptions to send.');
    return;
  }

  for (const sub of subs) {
    console.log(`[test-push] queued host=${endpointHost(sub.endpoint)} sub=${sub.id}`);
  }

  const result = await sendPushToUser(
    user.id,
    {
      title: 'Test push',
      body: 'Diagnostic notification from the Portal TL server.',
      url: '/dashboard',
      tag: 'test-push',
    },
    { requireEnabled: false, event: 'test-push', urgency: 'high', ttl: 120 }
  );

  const rows = Array.isArray(result?.results) ? result.results : [];
  for (const row of rows) {
    console.log(
      `[test-push] host=${row.host} status=${row.status}${
        row.error ? ` error=${row.error}` : ''
      }`
    );
  }
  console.log(`[test-push] done sent=${result?.sent || 0} of ${subs.length}`);
}

main()
  .catch((err) => {
    console.error('[test-push] failed:', err.message || err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
