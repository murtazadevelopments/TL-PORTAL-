const { markMissedSlots } = require('../controllers/attendanceController');

async function runAttendanceMissed() {
  const started = new Date().toISOString();
  console.log(
    `[attendance-missed] fired ${started} (random checks + auto reminders + missed expiry)`
  );
  const result = await markMissedSlots();
  console.log(
    `[attendance-missed] ${new Date().toISOString()} processed remotes=${result.remotes || 0} ` +
      `due=${result.due || 0} notified=${result.sent || 0} ` +
      `expired=${result.expired || 0} inserted=${result.inserted || 0} created=${result.created || 0}`
  );
  return result;
}

module.exports = { runAttendanceMissed };
