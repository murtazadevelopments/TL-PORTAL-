const { markMissedSlots } = require('../controllers/attendanceController');

let ticking = false;

async function runAttendanceMissed() {
  if (ticking) {
    console.log('[attendance-missed] skip — previous tick still running');
    return null;
  }
  ticking = true;
  const started = new Date().toISOString();
  console.log(
    `[attendance-missed] fired ${started} (random checks + auto reminders + missed expiry)`
  );
  try {
    const result = await markMissedSlots();
    console.log(
      `[attendance-missed] ${new Date().toISOString()} processed remotes=${result.remotes || 0} ` +
        `due=${result.due || 0} notified=${result.sent || 0} ` +
        `expired=${result.expired || 0} inserted=${result.inserted || 0} created=${result.created || 0}`
    );
    return result;
  } finally {
    ticking = false;
  }
}

module.exports = { runAttendanceMissed };
