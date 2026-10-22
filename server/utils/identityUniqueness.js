const pool = require('../config/db');
const { ensureBlockedColumn, isClosedAccount } = require('./accountStatus');

const OPEN_ACCOUNT_SQL = `
  LOWER(TRIM(COALESCE(status::text, ''))) NOT IN ('resigned', 'terminated')
  AND resigned_at IS NULL
  AND terminated_at IS NULL
  AND LOWER(TRIM(COALESCE(blocked_reason, ''))) NOT IN ('resigned', 'terminated')
`;

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function conflictForRow(row, { username, email, contactDigits, cnicDigits, employeeId }) {
  const rowUsername = String(row.username || '').trim().toLowerCase();
  const rowEmail = String(row.email || '').trim().toLowerCase();
  const rowEmployeeId = String(row.employee_id || '').trim().toLowerCase();
  const rowContact = digitsOnly(row.contact_number);
  const rowCnic = digitsOnly(row.cnic_number);

  if (username && rowUsername === username) {
    return { field: 'username', message: 'This username is already taken.' };
  }
  if (employeeId && rowEmployeeId === employeeId) {
    return {
      field: 'employee_id',
      message: 'This employee ID is already in use and cannot be reused.',
    };
  }
  if (isClosedAccount(row)) return null;
  if (email && rowEmail === email) {
    return { field: 'email', message: 'An account with this email already exists.' };
  }
  if (contactDigits && rowContact === contactDigits) {
    return {
      field: 'contact_number',
      message: 'An account with this contact number already exists.',
    };
  }
  if (cnicDigits && rowCnic === cnicDigits) {
    return { field: 'cnic_number', message: 'An account with this CNIC number already exists.' };
  }
  return null;
}

/**
 * Username and employee ID stay unique forever (including resigned/terminated).
 * Email, contact, and CNIC may be reused after an account is resigned or terminated.
 */
async function findIdentityConflict({
  username,
  email,
  contactNumber,
  cnicNumber,
  employeeId,
  excludeUserId,
} = {}) {
  await ensureBlockedColumn();

  const normalizedUsername = String(username || '').trim().toLowerCase();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedEmployeeId = String(employeeId || '').trim().toLowerCase();
  const contactDigits = digitsOnly(contactNumber);
  const cnicDigits = digitsOnly(cnicNumber);

  const params = [];
  const orParts = [];
  const add = (fragment, value) => {
    params.push(value);
    orParts.push(fragment.replaceAll('?', `$${params.length}`));
  };

  if (normalizedUsername) add('LOWER(TRIM(username)) = ?', normalizedUsername);
  if (normalizedEmployeeId) {
    add("LOWER(TRIM(COALESCE(employee_id, ''))) = ?", normalizedEmployeeId);
  }
  if (normalizedEmail) {
    add(`(${OPEN_ACCOUNT_SQL}) AND LOWER(TRIM(COALESCE(email, ''))) = ?`, normalizedEmail);
  }
  if (contactDigits) {
    add(
      `(${OPEN_ACCOUNT_SQL}) AND regexp_replace(COALESCE(contact_number, ''), '[^0-9]', '', 'g') = ?`,
      contactDigits
    );
  }
  if (cnicDigits) {
    add(
      `(${OPEN_ACCOUNT_SQL}) AND regexp_replace(COALESCE(cnic_number, ''), '[^0-9]', '', 'g') = ?`,
      cnicDigits
    );
  }
  if (!orParts.length) return null;

  let sql = `
    SELECT id, username, email, contact_number, cnic_number, employee_id,
           status, resigned_at, terminated_at, blocked_reason
    FROM users
    WHERE (${orParts.join(' OR ')})
  `;
  if (excludeUserId != null && String(excludeUserId).trim() !== '') {
    params.push(excludeUserId);
    sql += ` AND id <> $${params.length}`;
  }
  sql += ' LIMIT 25';

  const { rows } = await pool.query(sql, params);
  const lookup = {
    username: normalizedUsername,
    email: normalizedEmail,
    contactDigits,
    cnicDigits,
    employeeId: normalizedEmployeeId,
  };
  for (const row of rows) {
    const conflict = conflictForRow(row, lookup);
    if (conflict) return { ...conflict, userId: row.id };
  }
  return null;
}

function preferOpenAccounts(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => !isClosedAccount(row));
}

module.exports = {
  OPEN_ACCOUNT_SQL,
  digitsOnly,
  findIdentityConflict,
  preferOpenAccounts,
};
