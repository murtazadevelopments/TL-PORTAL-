const cron = require('node-cron');
const { runBirthdayEmails } = require('./birthdayEmails');
const { runLoginLogsPrune } = require('./loginLogsPrune');
const { runAttendanceMissed } = require('./attendanceMissed');
const { startZktecoSync } = require('../scripts/sync');

/**
 * Register scheduled jobs. Call once after the HTTP server starts.
 *
 * Hostinger note: cron only runs while the Node process is alive.
 * If the plan sleeps or restarts the app, missed windows won't fire
 * until the next scheduled tick after boot.
 */
function startScheduledJobs() {
  const tz = process.env.APP_TIMEZONE || 'Asia/Karachi';
  const birthdayExpression = process.env.BIRTHDAY_CRON || '0 0 * * *'; // 00:00 daily
  const pruneExpression = process.env.LOGIN_LOGS_PRUNE_CRON || '0 3 * * *'; // 03:00 daily

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
    console.log(`[cron] Birthday emails scheduled: "${birthdayExpression}" (${tz}) — CEO 24h before, employee at midnight`);
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

  runLoginLogsPrune().catch((err) => {
    console.error('[login-logs-prune] startup failed:', err.message || err);
  });

  const attendanceExpression = process.env.ATTENDANCE_MISSED_CRON || '* * * * *';
  if (cron.validate(attendanceExpression)) {
    cron.schedule(
      attendanceExpression,
      () => {
        runAttendanceMissed().catch((err) => {
          console.error('[attendance-missed] failed:', err.message || err);
        });
      },
      { timezone: tz }
    );
    console.log(`[cron] Attendance missed scan scheduled: "${attendanceExpression}" (${tz})`);
  } else {
    console.error(`[cron] Invalid ATTENDANCE_MISSED_CRON expression: ${attendanceExpression}`);
  }

  if (/^(1|true|yes)$/i.test(String(process.env.ZKTECO_SYNC_ENABLED || ''))) {
    startZktecoSync();
  }
}

module.exports = { startScheduledJobs };
