const pool = require('../config/db');
const { supabase, BUCKETS } = require('../config/supabaseClient');
const { extFromFile } = require('../middleware/uploadMiddleware');
const { attachReadableUrls } = require('../utils/storageUrls');
const {
  notifyAdminsEmployeeSelfUpdate,
  summarizeChanges,
} = require('../services/notifications');
const { loadAdminPermissions } = require('../middleware/permissions');

const USER_PUBLIC_COLUMNS = `
  id, employee_id, username, name, email, contact_number,
  address, cnic_number, cnic_front_url, cnic_back_url, cv_url, profile_picture_url,
  role, department, designation, status, branch, shift, salary,
  education, last_job_status, date_of_birth,
  date_of_joining, date_joined, created_at, updated_at, is_active,
  bank_name, account_title, iban, account_number,
  emergency_contact_name, emergency_contact_number,
  reference_person AS reference_person_name
`;

const EMPLOYEE_UPDATE_WHITELIST = [
  'name',
  'email',
  'contact_number',
  'address',
  'reference_person_name',
  'emergency_contact_name',
  'emergency_contact_number',
  'bank_name',
  'account_title',
  'iban',
  'account_number',
  'date_of_birth',
  'education',
  'last_job_status',
  'cnic_number',
];

/** Silently ignored if an employee sends them (admin-only). */
const EMPLOYEE_IGNORED_FIELDS = new Set([
  'date_of_joining',
  'date_joined',
  'employee_id',
  'status',
  'department',
  'designation',
  'branch',
  'shift',
  'salary',
  'role',
  'is_active',
]);

async function getMe(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT ${USER_PUBLIC_COLUMNS} FROM users WHERE id = $1 LIMIT 1`,
      [req.user.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ message: 'User not found.' });
    }

    if (rows[0].is_active === false) {
      return res.status(403).json({
        message: 'This account has been deactivated. Contact an administrator.',
      });
    }

    const accountStatus = String(rows[0].status || '')
      .trim()
      .toLowerCase();
    const meRole = String(rows[0].role || '')
      .trim()
      .toLowerCase();
    if (meRole === 'employee' && accountStatus !== 'active') {
      return res.status(403).json({
        message: 'Your account is pending admin approval.',
        pendingApproval: true,
      });
    }

    const user = await attachReadableUrls(rows[0]);
    const role = String(user.role || '')
      .trim()
      .toLowerCase();

    if (role === 'ceo') {
      user.permissions = ['*'];
    } else if (role === 'admin') {
      user.permissions = await loadAdminPermissions(user.id);
    } else {
      user.permissions = [];
    }

    return res.json(user);
  } catch (err) {
    console.error('getMe error:', err);
    return res.status(500).json({ message: 'Server error fetching profile.' });
  }
}

async function updateMe(req, res) {
  try {
    const body = req.body || {};

    // Admin-only keys are dropped silently (no error) if present
    for (const key of EMPLOYEE_IGNORED_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        delete body[key];
      }
    }

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
      email: nextText('email') ?? current.email,
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
      date_of_birth:
        updates.date_of_birth !== undefined
          ? updates.date_of_birth === null || updates.date_of_birth === ''
            ? null
            : updates.date_of_birth
          : current.date_of_birth,
    };

    if (!next.name) {
      return res.status(400).json({ message: 'name cannot be empty.' });
    }

    if (!next.email) {
      return res.status(400).json({ message: 'email cannot be empty.' });
    }

    const normalizedEmail = String(next.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ message: 'Enter a valid email address.' });
    }
    next.email = normalizedEmail;

    if (next.cnic_number) {
      next.cnic_number = String(next.cnic_number).trim();
    }

    const { rows } = await pool.query(
      `
        UPDATE users
        SET
          name = $1,
          email = $2,
          contact_number = $3,
          address = $4,
          reference_person = $5,
          emergency_contact_name = $6,
          emergency_contact_number = $7,
          bank_name = $8,
          account_title = $9,
          iban = $10,
          account_number = $11,
          education = $12,
          last_job_status = $13,
          cnic_number = $14,
          date_of_birth = $15,
          updated_at = NOW()
        WHERE id = $16
        RETURNING ${USER_PUBLIC_COLUMNS}
      `,
      [
        next.name,
        next.email,
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
        next.date_of_birth,
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
    if (err.code === '23505') {
      const detail = String(err.detail || err.message || '').toLowerCase();
      if (detail.includes('email')) {
        return res.status(409).json({ message: 'An account with this email already exists.' });
      }
      if (detail.includes('cnic')) {
        return res.status(409).json({ message: 'An account with this CNIC number already exists.' });
      }
      return res.status(409).json({ message: 'That value is already in use.' });
    }
    console.error('updateMe error:', err);
    return res.status(500).json({ message: 'Server error updating profile.' });
  }
}

/**
 * PUT /api/users/me/avatar
 * multipart field: profile_picture
 */
async function updateProfilePicture(req, res) {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ message: 'profile_picture file is required.' });
    }

    const { rows: existingRows } = await pool.query(
      `
        SELECT id, username, employee_id, is_active
        FROM users WHERE id = $1 LIMIT 1
      `,
      [req.user.id]
    );

    const existing = existingRows[0];
    if (!existing) {
      return res.status(404).json({ message: 'User not found.' });
    }
    if (existing.is_active === false) {
      return res.status(403).json({
        message: 'This account has been deactivated. Contact an administrator.',
      });
    }

    const prefix =
      existing.employee_id ||
      (existing.username ? `user-${existing.username}` : `user-${existing.id}`);
    const objectPath = `${prefix}/profile${extFromFile(file, '.jpg')}`;

    const { error } = await supabase.storage.from(BUCKETS.profile).upload(objectPath, file.buffer, {
      contentType: file.mimetype || 'image/jpeg',
      upsert: true,
      cacheControl: '3600',
    });

    if (error) {
      return res.status(400).json({ message: error.message || 'Failed to upload profile picture.' });
    }

    const { rows } = await pool.query(
      `
        UPDATE users
        SET profile_picture_url = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING ${USER_PUBLIC_COLUMNS}
      `,
      [objectPath, req.user.id]
    );

    const user = await attachReadableUrls(rows[0]);
    await notifyAdminsEmployeeSelfUpdate(user, ['profile picture (updated)']);

    return res.json(user);
  } catch (err) {
    console.error('updateProfilePicture error:', err);
    return res.status(500).json({ message: 'Server error updating profile picture.' });
  }
}

/**
 * PUT /api/users/me/documents
 * multipart fields (any subset): cnic_front, cnic_back, cv
 */
async function updateDocuments(req, res) {
  try {
    const files = req.files || {};
    const cnicFront = files.cnic_front?.[0] || null;
    const cnicBack = files.cnic_back?.[0] || null;
    const cv = files.cv?.[0] || null;

    if (!cnicFront && !cnicBack && !cv) {
      return res.status(400).json({
        message: 'Upload at least one file: cnic_front, cnic_back, or cv.',
      });
    }

    const { rows: existingRows } = await pool.query(
      `
        SELECT id, username, employee_id, is_active,
               cnic_front_url, cnic_back_url, cv_url
        FROM users WHERE id = $1 LIMIT 1
      `,
      [req.user.id]
    );

    const existing = existingRows[0];
    if (!existing) {
      return res.status(404).json({ message: 'User not found.' });
    }
    if (existing.is_active === false) {
      return res.status(403).json({
        message: 'This account has been deactivated. Contact an administrator.',
      });
    }

    const prefix =
      existing.employee_id ||
      (existing.username ? `user-${existing.username}` : `user-${existing.id}`);

    async function uploadOne(bucket, objectPath, file) {
      const { error } = await supabase.storage.from(bucket).upload(objectPath, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
        cacheControl: '3600',
      });
      if (error) {
        const err = new Error(error.message || `Failed to upload ${objectPath}`);
        err.status = 400;
        throw err;
      }
      return objectPath;
    }

    const nextFront = cnicFront
      ? await uploadOne(
          BUCKETS.cnic,
          `${prefix}/cnic_front${extFromFile(cnicFront, '.jpg')}`,
          cnicFront
        )
      : existing.cnic_front_url;
    const nextBack = cnicBack
      ? await uploadOne(
          BUCKETS.cnic,
          `${prefix}/cnic_back${extFromFile(cnicBack, '.jpg')}`,
          cnicBack
        )
      : existing.cnic_back_url;
    const nextCv = cv
      ? await uploadOne(BUCKETS.cv, `${prefix}/cv${extFromFile(cv, '.pdf')}`, cv)
      : existing.cv_url;

    const { rows } = await pool.query(
      `
        UPDATE users
        SET
          cnic_front_url = $1,
          cnic_back_url = $2,
          cv_url = $3,
          updated_at = NOW()
        WHERE id = $4
        RETURNING ${USER_PUBLIC_COLUMNS}
      `,
      [nextFront, nextBack, nextCv, req.user.id]
    );

    const user = await attachReadableUrls(rows[0]);
    const changed = [];
    if (cnicFront) changed.push('CNIC front (updated)');
    if (cnicBack) changed.push('CNIC back (updated)');
    if (cv) changed.push('CV (updated)');
    if (changed.length) {
      await notifyAdminsEmployeeSelfUpdate(user, changed);
    }

    return res.json({
      message: 'Documents updated.',
      user,
    });
  } catch (err) {
    console.error('updateDocuments error:', err);
    return res.status(err.status || 500).json({
      message: err.message || 'Server error updating documents.',
    });
  }
}

module.exports = { getMe, updateMe, updateProfilePicture, updateDocuments };
