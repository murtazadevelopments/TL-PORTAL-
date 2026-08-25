const pool = require('../config/db');

let ensured = false;

function safeIdent(name) {
  const n = String(name || '');
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : null;
}

/**
 * users.branch used to be a fixed CHECK list (Head Office / Unit / Branch / Amir Chamber).
 * The branches catalog can add offices now, so any UPDATE that writes a newer name
 * fails with: new row violates check constraint "users_branch_check".
 */
async function ensureUsersBranchNotEnumLocked() {
  if (ensured) return;
  const { rows } = await pool.query(`
    SELECT con.conname, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = current_schema()
      AND rel.relname = 'users'
      AND con.contype = 'c'
  `);

  for (const row of rows) {
    const name = safeIdent(row.conname);
    if (!name) continue;
    const def = String(row.def || '');
    const mentionsBranch = /branch/i.test(name) || /\bbranch\b/i.test(def);
    const isEnumList = /\bIN\s*\(|=\s*ANY\s*\(/i.test(def);
    if (!mentionsBranch || !isEnumList) continue;
    await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS ${name}`);
    console.warn(`Dropped legacy users branch check ${name}: ${def}`);
  }

  ensured = true;
}

module.exports = { ensureUsersBranchNotEnumLocked };
