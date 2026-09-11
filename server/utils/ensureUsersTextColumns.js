const pool = require('../config/db');

const SIGNUP_TEXT_COLUMNS = [
  'username',
  'name',
  'email',
  'password',
  'contact_number',
  'address',
  'cnic_number',
  'education',
  'bank_name',
  'account_title',
  'account_number',
  'iban',
  'profile_picture_url',
  'cnic_front_url',
  'cnic_back_url',
  'cv_url',
  'department',
  'designation',
  'branch',
  'shift',
];

let ensured = false;
let ensurePromise = null;

async function widenColumnIfShort(column) {
  if (!SIGNUP_TEXT_COLUMNS.includes(column)) return;
  const { rows } = await pool.query(
    `
      SELECT data_type, character_maximum_length
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'users'
        AND column_name = $1
      LIMIT 1
    `,
    [column]
  );
  const row = rows[0];
  if (!row) return;
  const maxLen = Number(row.character_maximum_length);
  const isShortVarchar =
    (row.data_type === 'character varying' || row.data_type === 'character') &&
    Number.isFinite(maxLen) &&
    maxLen < 255;
  if (!isShortVarchar) return;
  await pool.query(`ALTER TABLE users ALTER COLUMN "${column}" TYPE TEXT`);
}

async function runEnsureUsersTextColumns() {
  for (const column of SIGNUP_TEXT_COLUMNS) {
    await widenColumnIfShort(column);
  }
  ensured = true;
}

async function ensureUsersTextColumns() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = runEnsureUsersTextColumns().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  await ensurePromise;
}

module.exports = { ensureUsersTextColumns };
