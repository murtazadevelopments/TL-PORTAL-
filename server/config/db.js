const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = require('pg');

// PostgreSQL pool (Supabase DATABASE_URL) — used for all DB queries
if (!process.env.DATABASE_URL) {
  throw new Error(
    'Missing DATABASE_URL. Set it in the hosting platform environment variables (or server/.env locally).'
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

module.exports = pool;
