const cron = require('node-cron');
const { runBirthdayEmails } = require('./birthdayEmails');

/**
 * Register scheduled jobs. Call once after the HTTP server starts.
 *
 * Hostinger note: cron only runs while the Node process is alive.
 * If the plan sleeps or restarts the app, missed windows won't fire
 * until the next scheduled tick after boot.
 */
function startScheduledJobs() {
  const tz = process.env.APP_TIMEZONE || 'Asia/Karachi';
  const expression = process.env.BIRTHDAY_CRON || '0 8 * * *'; // 08:00 daily

  if (!cron.validate(expression)) {
    console.error(`[cron] Invalid BIRTHDAY_CRON expression: ${expression}`);
    return;
  }

  cron.schedule(
    expression,
    () => {
      runBirthdayEmails().catch((err) => {
        console.error('[birthday-job] failed:', err.message || err);
      });
    },
    { timezone: tz }
  );

  console.log(`[cron] Birthday emails scheduled: "${expression}" (${tz})`);
}

module.exports = { startScheduledJobs };
