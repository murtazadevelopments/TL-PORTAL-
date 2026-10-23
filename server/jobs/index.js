const cron = require('node-cron');
const { runBirthdayEmails } = require('./birthdayEmails');
const { runLoginLogsPrune } = require('./loginLogsPrune');
const { runAttendanceMissed } = require('./attendanceMissed');
const { startZktecoSync } = require('../scripts/sync');
const { ensureQueryIndexes } = require('../utils/ensureQueryIndexes');
const { JOB_LOCKS, lockedJob } = require('../utils/pgAdvisoryLock');

const runBirthdayEmailsLocked = lockedJob(
  'birthday-emails',
  JOB_LOCKS.birthdayEmails,
  runBirthdayEmails
);
const runLoginLogsPruneLocked = lockedJob(
  'login-logs-prune',
  JOB_LOCKS.loginLogsPrune,
  runLoginLogsPrune
);
const runAttendanceMissedLocked = lockedJob(
  'attendance-missed',
  JOB_LOCKS.attendanceMissed,
  runAttendanceMissed
);

let jobsStarted = false;

/**
 * Register scheduled jobs. Call once after the HTTP server starts.
 *
 * Hostinger note: cron only runs while the Node process is alive.
 * If the plan sleeps or restarts the app, missed windows won't fire
 * until the next scheduled tick after boot.
 */
function startScheduledJobs() {
  if (jobsStarted) {
    console.warn('[cron] already started in this process — skip duplicate schedule');
    return;
  }
  jobsStarted = true;

  ensureQueryIndexes().catch((err) => {
    console.error('[query-indexes] failed:', err.message || err);
  });

  const tz = process.env.APP_TIMEZONE || 'Asia/Karachi';
  const birthdayExpression = process.env.BIRTHDAY_CRON || '0 0 * * *'; // 00:00 daily
  const pruneExpression = process.env.LOGIN_LOGS_PRUNE_CRON || '0 3 * * *'; // 03:00 daily

  if (cron.validate(birthdayExpression)) {
    cron.schedule(
      birthdayExpression,
      () => {
        runBirthdayEmailsLocked().catch((err) => {
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
        runLoginLogsPruneLocked().catch((err) => {
          console.error('[login-logs-prune] failed:', err.message || err);
        });
      },
      { timezone: tz }
    );
    console.log(`[cron] Login logs prune scheduled: "${pruneExpression}" (${tz})`);
  } else {
    console.error(`[cron] Invalid LOGIN_LOGS_PRUNE_CRON expression: ${pruneExpression}`);
  }

  runLoginLogsPruneLocked().catch((err) => {
    console.error('[login-logs-prune] startup failed:', err.message || err);
  });

  const attendanceExpression = process.env.ATTENDANCE_MISSED_CRON || '* * * * *';
  if (cron.validate(attendanceExpression)) {
    cron.schedule(
      attendanceExpression,
      () => {
        runAttendanceMissedLocked().catch((err) => {
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
