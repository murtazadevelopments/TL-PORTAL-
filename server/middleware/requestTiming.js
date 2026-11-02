/**
 * Lightweight request timing — logs method, route, status, duration.
 * Flags anything over 500ms as SLOW. Hung requests log at 10s (REQUEST_TIMING=1).
 */
const { hungRequest, requestTimingEnabled, routeOf } = require('../utils/hangDiagnostics');

const SLOW_MS = 500;

function requestTiming(req, res, next) {
  hungRequest(req, res, () => {
    const started = process.hrtime.bigint();

    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const line = `${req.method} ${routeOf(req)} ${res.statusCode} ${ms.toFixed(1)}ms`;
      if (ms >= SLOW_MS) {
        console.warn(`[SLOW] ${line}`);
      } else if (requestTimingEnabled() || process.env.NODE_ENV !== 'production') {
        console.log(`[req] ${line}`);
      }
    });

    next();
  });
}

module.exports = { requestTiming, SLOW_MS };
