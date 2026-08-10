const pool = require('../config/db');
const { attachReadableUrls } = require('../utils/storageUrls');

/**
 * Public profile columns returned to the client (never includes password).
 * Includes admin-assigned fields as read-only display data.
 */
const USER_PUBLIC_COLUMNS = `
  id, employee_id, username, first_name, father_name, email, contact_number,
  address, cnic_number, cnic_front_url, cnic_back_url, cv_url, profile_picture_url,
  role, department, designation, status, branch, shift, salary,
  date_of_joining, date_joined, created_at, updated_at,
  bank_name, account_title, iban, account_number,
  emergency_contact_name, emergency_contact_number,
  reference_person AS reference_person_name
`;

/**
 * Strict whitelist for PUT /api/users/me.
 * Anything else in the body (including admin-only fields) is silently ignored.
 */
const EMPLOYEE_UPDATE_WHITELIST = [
  'first_name',
  'father_name',
  'contact_number',
  'address',
  'reference_person_name',
  'emergency_contact_name',
  'emergency_contact_number',
  'bank_name',
  'account_title',
  'iban',
  'account_number',
  'date_of_joining',
];

// Explicitly locked — never updated via this route even if present in the body:
// employee_id, status, department, designation, branch, shift, salary, role,
// username, email, password, and all file URL fields.

/**
 * GET /api/users/me
 */
async function getMe(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT ${USER_PUBLIC_COLUMNS} FROM users WHERE id = $1 LIMIT 1`,
      [req.user.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const user = await attachReadableUrls(rows[0]);
    return res.json(user);
  } catch (err) {
    console.error('getMe error:', err);
    return res.status(500).json({ message: 'Server error fetching profile.' });
  }
}

/**
 * PUT /api/users/me
 * Employee self-service updates only — whitelist enforced, admin fields ignored.
 */
async function updateMe(req, res) {
  try {
    const body = req.body || {};

    // Keep only whitelisted keys; silently drop everything else
    const updates = {};
    for (const key of EMPLOYEE_UPDATE_WHITELIST) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        updates[key] = body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        message:
          'Provide at least one editable field: first_name, father_name, contact_number, address, reference_person_name, emergency_contact_name, emergency_contact_number, bank_name, account_title, iban, account_number, date_of_joining.',
      });
    }

    const { rows: existingRows } = await pool.query(
      `SELECT ${USER_PUBLIC_COLUMNS} FROM users WHERE id = $1 LIMIT 1`,
      [req.user.id]
    );

    if (!existingRows[0]) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const current = existingRows[0];

    function nextText(key) {
      if (updates[key] === undefined) return current[key];
      if (updates[key] === null) return null;
      const value = String(updates[key]).trim();
      return value === '' ? null : value;
    }

    const next = {
      first_name: nextText('first_name') ?? current.first_name,
      father_name: nextText('father_name') ?? current.father_name,
      contact_number: nextText('contact_number'),
      address: nextText('address'),
      reference_person_name: nextText('reference_person_name'),
      emergency_contact_name: nextText('emergency_contact_name'),
      emergency_contact_number: nextText('emergency_contact_number'),
      bank_name: nextText('bank_name'),
      account_title: nextText('account_title'),
      iban: nextText('iban'),
      account_number: nextText('account_number'),
      date_of_joining:
        updates.date_of_joining !== undefined
          ? updates.date_of_joining === null || updates.date_of_joining === ''
            ? null
            : updates.date_of_joining
          : current.date_of_joining,
    };

    if (!next.first_name || !next.father_name) {
      return res.status(400).json({ message: 'first_name and father_name cannot be empty.' });
    }

    const { rows } = await pool.query(
      `
        UPDATE users
        SET
          first_name = $1,
          father_name = $2,
          contact_number = $3,
          address = $4,
          reference_person = $5,
          emergency_contact_name = $6,
          emergency_contact_number = $7,
          bank_name = $8,
          account_title = $9,
          iban = $10,
          account_number = $11,
          date_of_joining = $12,
          updated_at = NOW()
        WHERE id = $13
        RETURNING ${USER_PUBLIC_COLUMNS}
      `,
      [
        next.first_name,
        next.father_name,
        next.contact_number,
        next.address,
        next.reference_person_name,
        next.emergency_contact_name,
        next.emergency_contact_number,
        next.bank_name,
        next.account_title,
        next.iban,
        next.account_number,
        next.date_of_joining,
        req.user.id,
      ]
    );

    const user = await attachReadableUrls(rows[0]);
    return res.json(user);
  } catch (err) {
    console.error('updateMe error:', err);
    return res.status(500).json({ message: 'Server error updating profile.' });
  }
}

module.exports = { getMe, updateMe };
