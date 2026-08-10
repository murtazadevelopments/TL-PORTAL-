const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Load server/.env when present (local dev). On Hostinger, set the same vars
// in the hosting dashboard — .env is gitignored and is not deployed.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

/**
 * Supabase client for Storage uploads / signed URLs only.
 * Database access stays on pg via config/db.js.
 *
 * Required env vars:
 *   SUPABASE_URL         — https://xxxx.supabase.co
 *   SUPABASE_SECRET_KEY  — server-side secret key (sb_secret_...)
 */

/** Strip quotes/whitespace Hostinger panels sometimes include. */
function cleanEnv(value) {
  if (value == null) return '';
  let v = String(value).trim();
  // Remove wrapping quotes: "https://..." or 'https://...'
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

function normalizeSupabaseUrl(value) {
  let v = cleanEnv(value);
  if (!v) return '';

  // Common Hostinger mistake: pasted hostname without protocol
  if (!/^https?:\/\//i.test(v) && /^[a-z0-9.-]+\.supabase\.co\/?$/i.test(v)) {
    v = `https://${v.replace(/\/$/, '')}`;
  }

  return v;
}

function isHttpUrl(value) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Safe preview for logs (no secrets). */
function previewUrl(value) {
  const v = cleanEnv(value);
  if (!v) return '(empty)';
  if (v.length <= 48) return JSON.stringify(v);
  return `${JSON.stringify(v.slice(0, 48))}…`;
}

const supabaseUrl = normalizeSupabaseUrl(process.env.SUPABASE_URL);
const supabaseKey = cleanEnv(process.env.SUPABASE_SECRET_KEY);

if (!supabaseUrl || !supabaseKey || !isHttpUrl(supabaseUrl)) {
  const urlStatus = !cleanEnv(process.env.SUPABASE_URL)
    ? 'MISSING'
    : !isHttpUrl(supabaseUrl)
      ? `INVALID (got ${previewUrl(process.env.SUPABASE_URL)}; must look like https://xxxx.supabase.co)`
      : 'set';

  throw new Error(
    `Missing or invalid Supabase config. ` +
      `SUPABASE_URL=${urlStatus}, ` +
      `SUPABASE_SECRET_KEY=${supabaseKey ? 'set' : 'MISSING'}. ` +
      `Set these in the Hostinger environment variable panel (injected env (0) from .env means the local .env file is empty/absent — platform env vars must be used).`
  );
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const BUCKETS = {
  cnic: 'cnic-documents', // private
  cv: 'cv-documents', // private
  profile: 'profile-pictures', // public
};

module.exports = { supabase, BUCKETS };
