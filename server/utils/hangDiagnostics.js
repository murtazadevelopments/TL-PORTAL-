/**
 * Hang / stall diagnostics. Request-path monitors run only when REQUEST_TIMING=1.
 * [BOOT], [SHUTDOWN], and crash handlers always log.
 */
const { monitorEventLoopDelay } = require('perf_hooks');

const LOOP_INTERVAL_MS = 10_000;
const POOL_INTERVAL_MS = 10_000;
const MEM_INTERVAL_MS = 5 * 60_000;
const HUNG_MS = 10_000;
const LOOP_P99_MS = 200;
const LOOP_MAX_MS = 1000;
const SLOW_SQL_MS = 2000;
const EXT_SLOW_MS = 2000;
const DEFAULT_EXT_TIMEOUT_MS = 8000;
const DB_HEALTH_TIMEOUT_MS = 3000;

function requestTimingEnabled() {
  return process.env.REQUEST_TIMING === '1';
}

function extTimeoutMs(override) {
  const envRaw = Number(process.env.EXT_TIMEOUT_MS);
  const cap = Number.isFinite(envRaw) && envRaw > 0 ? envRaw : DEFAULT_EXT_TIMEOUT_MS;
  if (override == null) return cap;
  const n = Number(override);
  if (!Number.isFinite(n) || n <= 0) return cap;
  return Math.min(n, cap);
}

function durationMs(started) {
  return Number(process.hrtime.bigint() - started) / 1e6;
}

function routeOf(req) {
  return (
    (req.route && req.baseUrl != null ? `${req.baseUrl}${req.route.path}` : null) ||
    req.originalUrl?.split('?')[0] ||
    req.url ||
    '?'
  );
}

/**
 * Wrap an outbound call with a timeout. Logs [EXT-SLOW] / [EXT-TIMEOUT] when
 * REQUEST_TIMING=1. Passes AbortSignal to `work` when it accepts one.
 */
async function withOutboundTimeout(service, work, timeoutMs) {
  const limit = extTimeoutMs(timeoutMs);
  const started = process.hrtime.bigint();
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try {
        controller?.abort();
      } catch {
        /* ignore */
      }
      const err = new Error(`${service} timed out after ${limit}ms`);
      err.code = 'EXT_TIMEOUT';
      reject(err);
    }, limit);
  });

  try {
    const result = await Promise.race([
      Promise.resolve().then(() => work(controller?.signal)),
      timeoutPromise,
    ]);
    const ms = durationMs(started);
    if (requestTimingEnabled() && ms >= EXT_SLOW_MS) {
      console.warn(`[EXT-SLOW] service=${service} ${ms.toFixed(1)}ms`);
    }
    return result;
  } catch (err) {
    const ms = durationMs(started);
    const timedOut =
      err?.code === 'EXT_TIMEOUT' ||
      err?.name === 'AbortError' ||
      /aborted|timeout/i.test(String(err?.message || ''));
    if (requestTimingEnabled() && timedOut) {
      console.warn(`[EXT-TIMEOUT] service=${service} ${ms.toFixed(1)}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function hungRequest(req, res, next) {
  if (!requestTimingEnabled()) return next();
  const started = Date.now();
  const timer = setTimeout(() => {
    const userId = req.user?.id != null ? req.user.id : 'anon';
    console.warn(
      `[HUNG] ${req.method} ${routeOf(req)} user=${userId} elapsed=${Date.now() - started}ms`
    );
  }, HUNG_MS);
  const clear = () => clearTimeout(timer);
  res.on('finish', clear);
  res.on('close', clear);
  next();
}

let monitorsStarted = false;

function startHangDiagnostics(pool) {
  if (!requestTimingEnabled()) {
    console.log('[BOOT] hang monitors not started: REQUEST_TIMING is not 1 (no [MEM]/[LOOP-LAG]/[POOL-WAIT]/[HUNG])');
    return;
  }
  if (monitorsStarted) return;
  monitorsStarted = true;
  console.log('[BOOT] hang monitors started: [MEM] every 5m, [LOOP-LAG] and [POOL-WAIT] every 10s, [HUNG] at 10s');

  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  setInterval(() => {
    const p99 = histogram.percentile(99) / 1e6;
    const max = histogram.max / 1e6;
    if (p99 > LOOP_P99_MS || max > LOOP_MAX_MS) {
      console.warn(`[LOOP-LAG] p99=${p99.toFixed(1)}ms max=${max.toFixed(1)}ms`);
    }
    histogram.reset();
  }, LOOP_INTERVAL_MS).unref();

  if (pool) {
    setInterval(() => {
      const waiting = Number(pool.waitingCount) || 0;
      if (waiting > 0) {
        console.warn(
          `[POOL-WAIT] total=${pool.totalCount} idle=${pool.idleCount} waiting=${waiting}`
        );
      }
    }, POOL_INTERVAL_MS).unref();
  }

  setInterval(() => {
    const mem = process.memoryUsage();
    console.log(
      `[MEM] rss=${mem.rss} heapUsed=${mem.heapUsed} heapTotal=${mem.heapTotal} external=${mem.external}`
    );
  }, MEM_INTERVAL_MS).unref();
}

let lifecycleStarted = false;
let shuttingDown = false;

function startProcessLifecycle() {
  if (lifecycleStarted) return;
  lifecycleStarted = true;

  const timing = process.env.REQUEST_TIMING === '1' ? '1' : '0';
  const queryTiming = process.env.QUERY_TIMING === '1' ? '1' : '0';
  console.log(
    `[BOOT] pid=${process.pid} at=${new Date().toISOString()} ` +
      `NODE_ENV=${process.env.NODE_ENV || ''} REQUEST_TIMING=${timing} QUERY_TIMING=${queryTiming} ` +
      `EXT_TIMEOUT_MS=${process.env.EXT_TIMEOUT_MS || '8000'} hangMonitors=${timing === '1' ? 'on' : 'off'}`
  );

  function onShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[SHUTDOWN] signal=${signal} pid=${process.pid} at=${new Date().toISOString()}`);
    process.exit(0);
  }

  process.on('SIGTERM', () => onShutdown('SIGTERM'));
  process.on('SIGINT', () => onShutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    console.error('[unhandledRejection]', err.stack || err.message || err);
  });

  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err?.stack || err);
    process.exit(1);
  });
}

module.exports = {
  requestTimingEnabled,
  extTimeoutMs,
  withOutboundTimeout,
  hungRequest,
  startHangDiagnostics,
  startProcessLifecycle,
  routeOf,
  SLOW_SQL_MS,
  HUNG_MS,
  DB_HEALTH_TIMEOUT_MS,
};
