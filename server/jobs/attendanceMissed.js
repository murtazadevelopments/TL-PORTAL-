const { markMissedSlots } = require('../controllers/attendanceController');

async function runAttendanceMissed() {
  const result = await markMissedSlots();
  console.log(
    `[attendance-missed] ${new Date().toISOString()} inserted=${result.inserted || 0} remotes=${result.remotes || 0} notified=${result.sent || 0} expired=${result.expired || 0}`
  );
  return result;
}

module.exports = { runAttendanceMissed };
