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

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

function isHttpUrl(value) {
  if (!value || typeof value !== 'string') return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

if (!supabaseUrl || !supabaseKey || !isHttpUrl(supabaseUrl)) {
  throw new Error(
    `Missing or invalid Supabase config. ` +
      `SUPABASE_URL=${supabaseUrl ? (isHttpUrl(supabaseUrl) ? 'set' : 'INVALID (must be http/https URL)') : 'MISSING'}, ` +
      `SUPABASE_SECRET_KEY=${supabaseKey ? 'set' : 'MISSING'}. ` +
      `Set these in the hosting platform environment variables (not only in a local .env file).`
  );
}

const supabase = createClient(supabaseUrl.trim(), supabaseKey.trim(), {
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
