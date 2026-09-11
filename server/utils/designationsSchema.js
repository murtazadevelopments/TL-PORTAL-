const pool = require('../config/db');
const {
  DESIGNATION_OPTIONS,
  TEAM_LEAD_LIKE_DESIGNATIONS,
  TEAM_LEAD_LIKE_NORMALIZED,
  normalizeDesignation,
} = require('../constants/designations');

let ensured = false;
let ensurePromise = null;
let tlAccessSet = new Set(TEAM_LEAD_LIKE_NORMALIZED);
let catalogSet = new Set(DESIGNATION_OPTIONS.map((label) => normalizeDesignation(label)));

function designationHasTlAccess(name) {
  const n = normalizeDesignation(name);
  if (!n) return false;
  if (tlAccessSet.has(n)) return true;
  return /team[\s_-]*leader/.test(n);
}

function isKnownDesignation(name) {
  return catalogSet.has(normalizeDesignation(name));
}

function applyCache(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  tlAccessSet = new Set(
    rows
      .filter((row) => row.tl_dashboard_access)
      .map((row) => normalizeDesignation(row.name))
  );
  catalogSet = new Set(rows.map((row) => normalizeDesignation(row.name)));
}

async function refreshDesignationCache() {
  const { rows } = await pool.query(
    `SELECT name, tl_dashboard_access FROM designations ORDER BY name ASC`
  );
  applyCache(rows);
  return rows;
}

async function runEnsureDesignationsSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS designations (
      id                   BIGSERIAL PRIMARY KEY,
      name                 TEXT NOT NULL,
      tl_dashboard_access  BOOLEAN NOT NULL DEFAULT false,
      created_by           BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT designations_name_unique UNIQUE (name)
    )
  `);
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS designations_name_lower_idx ON designations (lower(name))`
  );

  for (const name of DESIGNATION_OPTIONS) {
    const tl = TEAM_LEAD_LIKE_DESIGNATIONS.includes(name);
    await pool.query(
      `
        INSERT INTO designations (name, tl_dashboard_access)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `,
      [name, tl]
    );
  }

  try {
    await pool.query(`ALTER TABLE designations ENABLE ROW LEVEL SECURITY`);
    await pool.query(`
      DO $$
      BEGIN
        CREATE POLICY designations_no_anon ON designations
          FOR ALL TO anon USING (false) WITH CHECK (false);
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `);
  } catch {
    /* local Postgres without RLS roles */
  }

  await refreshDesignationCache();
}

async function ensureDesignationsSchema() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = runEnsureDesignationsSchema()
      .then(() => {
        ensured = true;
      })
      .catch((err) => {
        ensurePromise = null;
        throw err;
      });
  }
  await ensurePromise;
}

module.exports = {
  ensureDesignationsSchema,
  refreshDesignationCache,
  designationHasTlAccess,
  isKnownDesignation,
};
