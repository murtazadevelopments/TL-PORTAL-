const path = require('path');
const dns = require('dns');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = require('pg');

// Prefer IPv4 — Supabase direct db.* hosts are often IPv6-only and fail on many networks.
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  // Node < 17
}

// PostgreSQL pool (Supabase DATABASE_URL) — used for all DB queries
if (!process.env.DATABASE_URL) {
  throw new Error(
    'Missing DATABASE_URL. Check your environment variables.'
  );
}

/**
 * Build a pg Pool config that works with Supabase pooler.
 * Do NOT put sslmode=require in the URL — pg treats it like verify-full and
 * fails with SELF_SIGNED_CERT_IN_CHAIN against Supabase.
 */
function poolConfigFromEnv() {
  let connectionString = String(process.env.DATABASE_URL).trim();

  // Strip sslmode from URL so Pool.ssl controls TLS verification.
  connectionString = connectionString
    .replace(/([?&])sslmode=[^&]*/gi, '$1')
    .replace(/\?&/, '?')
    .replace(/[?&]$/, '');

  const disableSsl =
    process.env.DATABASE_SSL === 'false' ||
    /[?&]sslmode=disable/i.test(String(process.env.DATABASE_URL));

  // Single shared Pool for the app (scripts may open a one-off max:1 pool).
  // Session pooler default is about 15 clients; stay at 10 unless PG_POOL_MAX is set.
  // node-pg has no min-size option. Boot warms 3 sockets and a 30s SELECT 1 holds them.
  const idleTimeoutMillis =
    Number(process.env.PG_POOL_IDLE_MS || process.env.PG_IDLE_TIMEOUT_MS) || 300000;
  return {
    connectionString,
    ssl: disableSsl ? false : { rejectUnauthorized: false },
    max: Number(process.env.PG_POOL_MAX) || 10,
    idleTimeoutMillis,
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS) || 15000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  };
}

const pool = new Pool(poolConfigFromEnv());

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message || err);
});

function warmPoolConnections() {
  const count = Math.min(3, pool.options.max || 3);
  return Promise.all(
    Array.from({ length: count }, async () => {
      const client = await pool.connect();
      try {
        await client.query('SELECT 1');
      } finally {
        client.release();
      }
    })
  );
}

function startPoolKeepAlive() {
  const timer = setInterval(() => {
    if (pool.waitingCount > 0 || pool.idleCount === 0) return;
    pool.query('SELECT 1').catch((err) => {
      console.warn('[pool] keepalive failed:', err.message || err);
    });
  }, 30000);
  if (typeof timer.unref === 'function') timer.unref();
}

console.log(
  `[BOOT] pool max=${pool.options.max} idleTimeoutMillis=${pool.options.idleTimeoutMillis} keepAlive=true`
);
warmPoolConnections().catch((err) => {
  console.error('[pool] warm connections failed:', err.message || err);
});
startPoolKeepAlive();

/**
 * Query duration around the shared pool. Logs first 60 chars of SQL + ms.
 * [SLOW-SQL] for >2s when REQUEST_TIMING=1; verbose [sql]/500ms when QUERY_TIMING=1 or non-prod.
 */
const { requestTimingEnabled, SLOW_SQL_MS } = require('../utils/hangDiagnostics');

const originalQuery = pool.query.bind(pool);
pool.query = function timedQuery(textOrConfig, values, callback) {
  const sql =
    typeof textOrConfig === 'string'
      ? textOrConfig
      : textOrConfig && typeof textOrConfig.text === 'string'
        ? textOrConfig.text
        : '(query)';
  const label = String(sql).replace(/\s+/g, ' ').trim().slice(0, 60);
  const started = process.hrtime.bigint();
  const verboseSql =
    process.env.QUERY_TIMING === '1' || process.env.NODE_ENV !== 'production';

  const finish = (err, result) => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (requestTimingEnabled() && ms >= SLOW_SQL_MS) {
      console.warn(`[SLOW-SQL] ${ms.toFixed(1)}ms ${label}`);
    } else if (verboseSql) {
      const tag = ms >= 500 ? '[SLOW-SQL]' : '[sql]';
      console.log(`${tag} ${ms.toFixed(1)}ms ${label}`);
    }
    return { err, result };
  };

  if (typeof values === 'function') {
    callback = values;
    values = undefined;
  }
  if (typeof callback === 'function') {
    return originalQuery(textOrConfig, values, (err, result) => {
      finish(err, result);
      callback(err, result);
    });
  }

  return originalQuery(textOrConfig, values).then(
    (result) => {
      finish(null, result);
      return result;
    },
    (err) => {
      finish(err, null);
      throw err;
    }
  );
};

module.exports = pool;
