const pool = require('../config/db');
const { attachReadableUrls } = require('../utils/storageUrls');
const {
  notifyAdminsEmployeeSelfUpdate,
  summarizeChanges,
} = require('../services/notifications');

const USER_PUBLIC_COLUMNS = `
  id, employee_id, username, name, email, contact_number,
  address, cnic_number, cnic_front_url, cnic_back_url, cv_url, profile_picture_url,
  role, department, designation, status, branch, shift, salary,
  education, last_job_status,
  date_of_joining, date_joined, created_at, updated_at,
  bank_name, account_title, iban, account_number,
  emergency_contact_name, emergency_contact_number,
  reference_person AS reference_person_name
`;

const EMPLOYEE_UPDATE_WHITELIST = [
  'name',
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
  'education',
  'last_job_status',
  'cnic_number',
];

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

async function updateMe(req, res) {
  try {
    const body = req.body || {};

    const updates = {};
    for (const key of EMPLOYEE_UPDATE_WHITELIST) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        updates[key] = body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        message: `Provide at least one editable field: ${EMPLOYEE_UPDATE_WHITELIST.join(', ')}.`,
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
      name: nextText('name') ?? current.name,
      contact_number: nextText('contact_number'),
      address: nextText('address'),
      reference_person_name: nextText('reference_person_name'),
      emergency_contact_name: nextText('emergency_contact_name'),
      emergency_contact_number: nextText('emergency_contact_number'),
      bank_name: nextText('bank_name'),
      account_title: nextText('account_title'),
      iban: nextText('iban'),
      account_number: nextText('account_number'),
      education: nextText('education'),
      last_job_status: nextText('last_job_status'),
      cnic_number: nextText('cnic_number'),
      date_of_joining:
        updates.date_of_joining !== undefined
          ? updates.date_of_joining === null || updates.date_of_joining === ''
            ? null
            : updates.date_of_joining
          : current.date_of_joining,
    };

    if (!next.name) {
      return res.status(400).json({ message: 'name cannot be empty.' });
    }

    const { rows } = await pool.query(
      `
        UPDATE users
        SET
          name = $1,
          contact_number = $2,
          address = $3,
          reference_person = $4,
          emergency_contact_name = $5,
          emergency_contact_number = $6,
          bank_name = $7,
          account_title = $8,
          iban = $9,
          account_number = $10,
          education = $11,
          last_job_status = $12,
          cnic_number = $13,
          date_of_joining = $14,
          updated_at = NOW()
        WHERE id = $15
        RETURNING ${USER_PUBLIC_COLUMNS}
      `,
      [
        next.name,
        next.contact_number,
        next.address,
        next.reference_person_name,
        next.emergency_contact_name,
        next.emergency_contact_number,
        next.bank_name,
        next.account_title,
        next.iban,
        next.account_number,
        next.education,
        next.last_job_status,
        next.cnic_number,
        next.date_of_joining,
        req.user.id,
      ]
    );

    const user = await attachReadableUrls(rows[0]);

    const changed = summarizeChanges(current, user, EMPLOYEE_UPDATE_WHITELIST);
    if (changed.length) {
      await notifyAdminsEmployeeSelfUpdate(user, changed);
    }

    return res.json(user);
  } catch (err) {
    console.error('updateMe error:', err);
    return res.status(500).json({ message: 'Server error updating profile.' });
  }
}

module.exports = { getMe, updateMe };
