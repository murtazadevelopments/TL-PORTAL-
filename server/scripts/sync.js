/**
 * ZKTeco → Supabase attendance sync.
 *
 * Run this on a PC/Raspberry Pi on the SAME LAN as the device
 * (default 192.168.1.201:4370). Hostinger cannot reach that private IP.
 *
 *   cd server
 *   node scripts/sync.js
 *
 * Env: see server/.env.example (ZKTECO_* and SUPABASE_*).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

const ZKLib = require('node-zklib');
const { createClient } = require('@supabase/supabase-js');
const { Pool } = require('pg');

const TABLE = 'zkteco_attendance_logs';
const DEVICE_IP = process.env.ZKTECO_IP || '192.168.1.201';
const DEVICE_PORT = Number(process.env.ZKTECO_PORT || 4370);
const INTERVAL_MS = Number(process.env.ZKTECO_SYNC_INTERVAL_MS || 5 * 60 * 1000);
const IN_TIMEOUT = Number(process.env.ZKTECO_TIMEOUT_MS || 10000);
const COMM = Number(process.env.ZKTECO_COMM || 4000);

function supabaseAdmin() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  ).trim();
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY (service role) are required.');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function ensureTable() {
  if (!process.env.DATABASE_URL) return;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id TEXT NOT NULL,
        punch_time TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, punch_time)
      )
    `);
  } finally {
    await pool.end();
  }
}

function normalizePunch(row) {
  if (!row || typeof row !== 'object') return null;
  const userId = String(
    row.deviceUserId ?? row.uid ?? row.user_id ?? row.userId ?? row.userSn ?? ''
  ).trim();
  const raw = row.recordTime ?? row.timestamp ?? row.punch_time ?? row.attTime;
  if (!userId || raw == null || raw === '') return null;
  const punchTime = new Date(raw);
  if (!Number.isFinite(punchTime.getTime())) return null;
  return { user_id: userId, punch_time: punchTime.toISOString() };
}

async function fetchDeviceLogs() {
  const zk = new ZKLib(DEVICE_IP, DEVICE_PORT, IN_TIMEOUT, COMM);
  await zk.createSocket();
  try {
    const result = await zk.getAttendances();
    const list = Array.isArray(result)
      ? result
      : Array.isArray(result?.data)
        ? result.data
        : [];
    return list.map(normalizePunch).filter(Boolean);
  } finally {
    try {
      await zk.disconnect();
    } catch {
      /* device already closed */
    }
  }
}

async function upsertLogs(supabase, punches) {
  if (!punches.length) return { attempted: 0 };
  const unique = [];
  const seen = new Set();
  for (const row of punches) {
    const key = `${row.user_id}|${row.punch_time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }

  const { error } = await supabase.from(TABLE).upsert(unique, {
    onConflict: 'user_id,punch_time',
    ignoreDuplicates: true,
  });
  if (error) throw error;
  return { attempted: unique.length };
}

async function runZktecoSyncOnce() {
  await ensureTable();
  const supabase = supabaseAdmin();
  const punches = await fetchDeviceLogs();
  const result = await upsertLogs(supabase, punches);
  console.log(
    `[zkteco-sync] ${new Date().toISOString()} device=${DEVICE_IP}:${DEVICE_PORT} fetched=${punches.length} upserted=${result.attempted}`
  );
  return { fetched: punches.length, upserted: result.attempted };
}

function startZktecoSync() {
  const tick = () => {
    runZktecoSyncOnce().catch((err) => {
      console.error('[zkteco-sync] failed:', err.message || err);
    });
  };
  tick();
  const timer = setInterval(tick, INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  console.log(
    `[zkteco-sync] polling every ${Math.round(INTERVAL_MS / 1000)}s → ${DEVICE_IP}:${DEVICE_PORT}`
  );
  return timer;
}

if (require.main === module) {
  startZktecoSync();
}

module.exports = { runZktecoSyncOnce, startZktecoSync };
