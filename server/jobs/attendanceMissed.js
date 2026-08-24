const { markMissedSlots } = require('../controllers/attendanceController');

async function runAttendanceMissed() {
  const result = await markMissedSlots();
  console.log(
    `[attendance-missed] ${new Date().toISOString()} inserted=${result.inserted} remotes=${result.remotes || 0} slots=${result.slots || 0}`
  );
  return result;
}

module.exports = { runAttendanceMissed };
