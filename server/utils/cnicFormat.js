/** Pakistani CNIC display/storage format: XXXXX-XXXXXXX-X (13 digits). */
const CNIC_FORMAT_PATTERN = /^\d{5}-\d{7}-\d$/;
const CNIC_FORMAT_HINT = 'XXXXX-XXXXXXX-X';
const CNIC_INVALID_MESSAGE = 'CNIC must be in format XXXXX-XXXXXXX-X.';

let formatEnsured = false;
let formatEnsurePromise = null;

function cnicDigits(value) {
  return String(value || '')
    .replace(/\D/g, '')
    .slice(0, 13);
}

/** Formats while typing or converts stored digits to XXXXX-XXXXXXX-X without changing digits. */
function formatCnic(value) {
  const digits = cnicDigits(value);
  if (!digits) return '';
  if (digits.length <= 5) return digits;
  if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12, 13)}`;
}

function isCompleteCnic(value) {
  return CNIC_FORMAT_PATTERN.test(String(value || '').trim()) || cnicDigits(value).length === 13;
}

/** Returns XXXXX-XXXXXXX-X when 13 digits are present; otherwise null. */
function normalizeCnicForStorage(value) {
  const digits = cnicDigits(value);
  if (digits.length !== 13) return null;
  return formatCnic(digits);
}

/**
 * One-time (per process) convert of existing 13-digit CNIC values to XXXXX-XXXXXXX-X.
 * Digits are unchanged; only dashes are inserted.
 */
async function ensureCnicFormatted() {
  if (formatEnsured) return;
  if (!formatEnsurePromise) {
    formatEnsurePromise = (async () => {
      const pool = require('../config/db');
      await pool.query(`
        UPDATE users u
        SET cnic_number =
          substr(s.digits, 1, 5) || '-' ||
          substr(s.digits, 6, 7) || '-' ||
          substr(s.digits, 13, 1)
        FROM (
          SELECT
            id,
            regexp_replace(COALESCE(cnic_number, ''), '[^0-9]', '', 'g') AS digits
          FROM users
          WHERE cnic_number IS NOT NULL
            AND trim(cnic_number) <> ''
        ) s
        WHERE u.id = s.id
          AND length(s.digits) = 13
          AND u.cnic_number IS DISTINCT FROM (
            substr(s.digits, 1, 5) || '-' ||
            substr(s.digits, 6, 7) || '-' ||
            substr(s.digits, 13, 1)
          )
      `);
      formatEnsured = true;
    })().catch((err) => {
      formatEnsurePromise = null;
      throw err;
    });
  }
  await formatEnsurePromise;
}

module.exports = {
  CNIC_FORMAT_PATTERN,
  CNIC_FORMAT_HINT,
  CNIC_INVALID_MESSAGE,
  cnicDigits,
  formatCnic,
  isCompleteCnic,
  normalizeCnicForStorage,
  ensureCnicFormatted,
};
