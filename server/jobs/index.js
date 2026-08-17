const cron = require('node-cron');
const { runBirthdayEmails } = require('./birthdayEmails');
const { runLoginLogsPrune } = require('./loginLogsPrune');

/**
 * Register scheduled jobs. Call once after the HTTP server starts.
 *
 * Hostinger note: cron only runs while the Node process is alive.
 * If the plan sleeps or restarts the app, missed windows won't fire
 * until the next scheduled tick after boot.
 */
function startScheduledJobs() {
  const tz = process.env.APP_TIMEZONE || 'Asia/Karachi';
  const birthdayExpression = process.env.BIRTHDAY_CRON || '0 8 * * *'; // 08:00 daily
  const pruneExpression = process.env.LOGIN_LOGS_PRUNE_CRON || '0 3 * * 0'; // Sunday 03:00

  if (cron.validate(birthdayExpression)) {
    cron.schedule(
      birthdayExpression,
      () => {
        runBirthdayEmails().catch((err) => {
          console.error('[birthday-job] failed:', err.message || err);
        });
      },
      { timezone: tz }
    );
    console.log(`[cron] Birthday emails scheduled: "${birthdayExpression}" (${tz})`);
  } else {
    console.error(`[cron] Invalid BIRTHDAY_CRON expression: ${birthdayExpression}`);
  }

  if (cron.validate(pruneExpression)) {
    cron.schedule(
      pruneExpression,
      () => {
        runLoginLogsPrune().catch((err) => {
          console.error('[login-logs-prune] failed:', err.message || err);
        });
      },
      { timezone: tz }
    );
    console.log(`[cron] Login logs prune scheduled: "${pruneExpression}" (${tz})`);
  } else {
    console.error(`[cron] Invalid LOGIN_LOGS_PRUNE_CRON expression: ${pruneExpression}`);
  }
}

module.exports = { startScheduledJobs };
