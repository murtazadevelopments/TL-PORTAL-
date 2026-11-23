/** Pakistani mobile format: 03XZ-YYYYYYY (11 digits). */
const CONTACT_FORMAT_PATTERN = /^03\d{2}-\d{7}$/;
const CONTACT_FORMAT_HINT = '03XZ-YYYYYYY';
const CONTACT_INVALID_MESSAGE = 'Contact number must be in format 03XZ-YYYYYYY.';

let formatEnsured = false;
let formatEnsurePromise = null;

function contactDigits(value) {
  return String(value || '')
    .replace(/\D/g, '')
    .slice(0, 11);
}

function formatContactNumber(value) {
  const digits = contactDigits(value);
  if (!digits) return '';
  if (digits.length <= 4) return digits;
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

function normalizeContactForStorage(value) {
  const digits = contactDigits(value);
  if (!/^03\d{9}$/.test(digits)) return null;
  return formatContactNumber(digits);
}

/** Display/convert any 11-digit number to XXXX-XXXXXXX without changing digits. */
function formatContactDisplay(value) {
  const digits = contactDigits(value);
  if (!digits) return '';
  if (digits.length !== 11) return formatContactNumber(digits) || String(value || '').trim();
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

/**
 * One-time (per process) convert of existing 11-digit contact values to XXXX-XXXXXXX.
 * Digits are unchanged; only a dash is inserted after the 4th digit.
 */
async function ensureContactFormatted() {
  if (formatEnsured) return;
  if (!formatEnsurePromise) {
    formatEnsurePromise = (async () => {
      const pool = require('../config/db');
      await pool.query(`
        UPDATE users u
        SET contact_number =
          substr(s.digits, 1, 4) || '-' || substr(s.digits, 5, 7)
        FROM (
          SELECT
            id,
            regexp_replace(COALESCE(contact_number, ''), '[^0-9]', '', 'g') AS digits
          FROM users
          WHERE contact_number IS NOT NULL
            AND trim(contact_number) <> ''
        ) s
        WHERE u.id = s.id
          AND length(s.digits) = 11
          AND u.contact_number IS DISTINCT FROM (
            substr(s.digits, 1, 4) || '-' || substr(s.digits, 5, 7)
          )
      `);
      await pool.query(`
        UPDATE users u
        SET emergency_contact_number =
          substr(s.digits, 1, 4) || '-' || substr(s.digits, 5, 7)
        FROM (
          SELECT
            id,
            regexp_replace(COALESCE(emergency_contact_number, ''), '[^0-9]', '', 'g') AS digits
          FROM users
          WHERE emergency_contact_number IS NOT NULL
            AND trim(emergency_contact_number) <> ''
        ) s
        WHERE u.id = s.id
          AND length(s.digits) = 11
          AND u.emergency_contact_number IS DISTINCT FROM (
            substr(s.digits, 1, 4) || '-' || substr(s.digits, 5, 7)
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
  CONTACT_FORMAT_PATTERN,
  CONTACT_FORMAT_HINT,
  CONTACT_INVALID_MESSAGE,
  contactDigits,
  formatContactNumber,
  formatContactDisplay,
  normalizeContactForStorage,
  ensureContactFormatted,
};
