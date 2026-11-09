const { runOutboxBatch } = require('../services/notificationOutbox');

const INTERVAL_MS = 20000;
let running = false;
let timer = null;
let missingLogged = false;

async function runNotificationOutbox() {
  if (running) {
    console.log('[outbox] skip — previous batch still running');
    return;
  }
  running = true;
  try {
    await runOutboxBatch();
    missingLogged = false;
  } catch (err) {
    if (err.code === '42P01') {
      if (!missingLogged) {
        console.error('[outbox] notification_outbox table is missing; apply migration 064');
        missingLogged = true;
      }
      return;
    }
    console.error('[outbox] batch failed:', err.message || err);
  } finally {
    running = false;
  }
}

function startNotificationOutboxWorker() {
  if (timer) return;
  timer = setInterval(() => {
    runNotificationOutbox().catch((err) => {
      console.error('[outbox] worker failed:', err.message || err);
    });
  }, INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  console.log(`[outbox] worker every ${INTERVAL_MS / 1000}s`);
}

module.exports = { runNotificationOutbox, startNotificationOutboxWorker };
