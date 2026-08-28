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

  return {
    connectionString,
    ssl: disableSsl ? false : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  };
}

const pool = new Pool(poolConfigFromEnv());

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message || err);
});

module.exports = pool;
