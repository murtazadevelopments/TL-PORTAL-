/**
 * One-off: delete all Web Push subscriptions (e.g. after VAPID key rotation).
 * Devices must Enable notifications again afterward.
 *
 * Usage (from server/): node scripts/clear-push-subscriptions.js
 * Idempotent — safe to run when the table is already empty.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = require('../config/db');

async function main() {
  const { rowCount } = await pool.query('DELETE FROM push_subscriptions');
  console.log(`[push] cleared ${rowCount || 0} push_subscriptions row(s)`);
}

main()
  .catch((err) => {
    console.error('[push] clear-push-subscriptions failed:', err.message || err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
