const { createClient } = require('@supabase/supabase-js');

/**
 * Supabase client for Storage uploads only.
 * Database access stays on pg via config/db.js.
 */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

const BUCKETS = {
  cnic: 'cnic-documents', // private
  cv: 'cv-documents', // private
  profile: 'profile-pictures', // public
};

module.exports = { supabase, BUCKETS };
