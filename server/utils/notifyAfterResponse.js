const NOTIFY_TIMEOUT_MS = 120000;

/**
 * Best-effort side notification after the HTTP response is already sent.
 * Never throw to the caller — log success, failure, or a 5s timeout.
 */
async function notifyAfterResponse(label, userId, work) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NOTIFY_TIMEOUT_MS);
  try {
    const result = await Promise.race([
      Promise.resolve().then(work),
      new Promise((_, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => {
            const err = new Error(`${label} timed out after ${NOTIFY_TIMEOUT_MS}ms`);
            err.code = 'NOTIFY_TIMEOUT';
            reject(err);
          },
          { once: true }
        );
      }),
    ]);
    if (result && result.sent === false) {
      console.log(`[${label}] skipped for user id=${userId} reason=${result.reason || 'n/a'}`);
    } else {
      console.log(`[${label}] success for user id=${userId}`);
    }
  } catch (err) {
    console.error(`[${label}] failed for user id=${userId}:`, err.message || err);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { notifyAfterResponse, NOTIFY_TIMEOUT_MS };
