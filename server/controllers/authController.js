const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { supabase, BUCKETS } = require('../config/supabaseClient');
const { extFromFile } = require('../middleware/uploadMiddleware');
const { attachReadableUrls } = require('../utils/storageUrls');
const {
  notifyAdminsNewSignup,
  notifyUserSignup,
  notifyUsernameReminder,
  notifyPasswordReset,
} = require('../services/notifications');

const USER_PUBLIC_COLUMNS = `
  id, employee_id, username, name, email, contact_number,
  address, cnic_number, cnic_front_url, cnic_back_url, cv_url,
  profile_picture_url, role, department, education, last_job_status,
  bank_name, account_title, iban, account_number,
  date_joined, created_at, updated_at
`;

const USERNAME_REGEX = /^[a-z0-9._]+$/;

const LAST_JOB_STATUSES = new Set([
  'still_employed',
  'resigned',
  'terminated',
  'fresh_graduate',
  'other',
]);

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      employee_id: user.employee_id,
      username: user.username,
      email: user.email,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function omitPassword(row) {
  if (!row) return null;
  const { password, ...safe } = row;
  return safe;
}

function getFile(req, field) {
  return req.files?.[field]?.[0] || null;
}

function frontendBaseUrl() {
  return String(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
}

async function uploadToBucket(bucket, objectPath, file) {
  const { error } = await supabase.storage.from(bucket).upload(objectPath, file.buffer, {
    contentType: file.mimetype,
    upsert: true,
    cacheControl: '3600',
  });

  if (error) {
    const err = new Error(error.message || `Failed to upload to ${bucket}`);
    err.status = 400;
    throw err;
  }

  return objectPath;
}

/**
 * POST /api/auth/signup
 * employee_id is NOT set here — admin assigns it later in the admin panel.
 */
async function signup(req, res) {
  try {
    const {
      username,
      name,
      email,
      password,
      contact_number,
      address,
      cnic_number,
      department,
      education,
      last_job_status,
      bank_name,
      account_title,
      account_number,
      iban,
    } = req.body;

    const cnicFront = getFile(req, 'cnic_front');
    const cnicBack = getFile(req, 'cnic_back');
    const cv = getFile(req, 'cv');
    const profilePicture = getFile(req, 'profile_picture');

    if (
      !username ||
      !name ||
      !email ||
      !password ||
      !contact_number ||
      !address ||
      !education ||
      !last_job_status ||
      !bank_name ||
      !account_title ||
      !account_number ||
      !iban
    ) {
      return res.status(400).json({
        message:
          'username, name, email, password, contact_number, address, education, last_job_status, bank_name, account_title, account_number, and iban are required.',
      });
    }

    const normalizedUsername = String(username).trim().toLowerCase();

    if (normalizedUsername.length < 3 || normalizedUsername.length > 30) {
      return res.status(400).json({
        message: 'Username must be between 3 and 30 characters.',
      });
    }

    if (!USERNAME_REGEX.test(normalizedUsername)) {
      return res.status(400).json({
        message:
          'Username may only contain lowercase letters, numbers, dots, and underscores.',
      });
    }

    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    if (!LAST_JOB_STATUSES.has(String(last_job_status).trim())) {
      return res.status(400).json({
        message:
          'last_job_status must be one of: still_employed, resigned, terminated, fresh_graduate, other.',
      });
    }

    // CV + profile required; CNIC files optional
    if (!cv || !profilePicture) {
      return res.status(400).json({
        message: 'CV and profile_picture are required.',
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedCnic = cnic_number ? String(cnic_number).trim() : null;
    const hashedPassword = await bcrypt.hash(password, 10);
    // Storage prefix before admin assigns employee_id
    const storagePrefix = `user-${normalizedUsername}`;

    const uploadJobs = [
      uploadToBucket(BUCKETS.cv, `${storagePrefix}/cv${extFromFile(cv, '.pdf')}`, cv),
      uploadToBucket(
        BUCKETS.profile,
        `${storagePrefix}/profile${extFromFile(profilePicture, '.jpg')}`,
        profilePicture
      ),
    ];

    if (cnicFront) {
      uploadJobs.push(
        uploadToBucket(
          BUCKETS.cnic,
          `${storagePrefix}/cnic_front${extFromFile(cnicFront, '.jpg')}`,
          cnicFront
        )
      );
    } else {
      uploadJobs.push(Promise.resolve(null));
    }

    if (cnicBack) {
      uploadJobs.push(
        uploadToBucket(
          BUCKETS.cnic,
          `${storagePrefix}/cnic_back${extFromFile(cnicBack, '.jpg')}`,
          cnicBack
        )
      );
    } else {
      uploadJobs.push(Promise.resolve(null));
    }

    const [cv_url, profile_picture_url, cnic_front_url, cnic_back_url] =
      await Promise.all(uploadJobs);

    const insertQuery = `
      INSERT INTO users (
        employee_id, username, name, email, password,
        contact_number, address, cnic_number,
        cnic_front_url, cnic_back_url, cv_url, profile_picture_url,
        role, department, education, last_job_status,
        bank_name, account_title, account_number, iban,
        date_joined
      )
      VALUES (
        NULL, $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13, $14, $15,
        $16, $17, $18, $19,
        NOW()
      )
      RETURNING ${USER_PUBLIC_COLUMNS}
    `;

    const { rows } = await pool.query(insertQuery, [
      normalizedUsername,
      String(name).trim(),
      normalizedEmail,
      hashedPassword,
      String(contact_number).trim(),
      String(address).trim(),
      normalizedCnic,
      cnic_front_url,
      cnic_back_url,
      cv_url,
      profile_picture_url,
      'employee',
      department ? String(department).trim() : null,
      String(education).trim(),
      String(last_job_status).trim(),
      String(bank_name).trim(),
      String(account_title).trim(),
      String(account_number).trim(),
      String(iban).trim(),
    ]);

    const user = await attachReadableUrls(rows[0]);
    const token = signToken(user);

    // Emails are best-effort; signup still succeeds if Resend fails
    await Promise.all([notifyUserSignup(user), notifyAdminsNewSignup(user)]);

    return res.status(201).json({
      token,
      user,
      message: 'Congrats, your account has been created!',
    });
  } catch (err) {
    if (err.code === '23505') {
      const detail = String(err.detail || err.message || '').toLowerCase();
      if (detail.includes('username')) {
        return res.status(409).json({ message: 'This username is already taken.' });
      }
      if (detail.includes('cnic')) {
        return res.status(409).json({ message: 'An account with this CNIC number already exists.' });
      }
      if (detail.includes('email')) {
        return res.status(409).json({ message: 'An account with this email already exists.' });
      }
      if (detail.includes('employee_id')) {
        return res.status(409).json({ message: 'This employee ID is already in use.' });
      }
      return res.status(409).json({
        message: 'Duplicate value — username, email, CNIC, or employee ID already registered.',
      });
    }

    console.error('signup error:', err);
    return res.status(err.status || 500).json({
      message: err.message || 'Server error during signup.',
    });
  }
}

async function login(req, res) {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required.' });
    }

    const normalizedUsername = String(username).trim().toLowerCase();

    const { rows } = await pool.query(
      'SELECT * FROM users WHERE username = $1 LIMIT 1',
      [normalizedUsername]
    );

    const user = rows[0];
    if (!user) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    const safeUser = await attachReadableUrls(omitPassword(user));

    return res.json({
      token: signToken(user),
      user: safeUser,
    });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ message: 'Server error during login.' });
  }
}

/**
 * POST /api/auth/forgot-username  { email }
 */
async function forgotUsername(req, res) {
  const generic = {
    message: 'If an account exists for that email, we sent the username.',
  };

  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    if (!email) {
      return res.status(400).json({ message: 'Email is required.' });
    }

    const { rows } = await pool.query(
      `SELECT id, name, username, email FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );

    if (rows[0]) {
      await notifyUsernameReminder(rows[0]);
    }

    return res.json(generic);
  } catch (err) {
    console.error('forgotUsername error:', err);
    return res.json(generic);
  }
}

/**
 * POST /api/auth/forgot-password  { email }
 */
async function forgotPassword(req, res) {
  const generic = {
    message: 'If an account exists for that email, we sent a password reset link.',
  };

  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    if (!email) {
      return res.status(400).json({ message: 'Email is required.' });
    }

    const { rows } = await pool.query(
      `SELECT id, name, username, email FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );

    const user = rows[0];
    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [user.id, tokenHash, expiresAt]
      );

      const resetUrl = `${frontendBaseUrl()}/reset-password?token=${rawToken}`;
      await notifyPasswordReset(user, resetUrl);
    }

    return res.json(generic);
  } catch (err) {
    console.error('forgotPassword error:', err);
    return res.json(generic);
  }
}

/**
 * POST /api/auth/reset-password  { token, password }
 */
async function resetPassword(req, res) {
  try {
    const { token, password } = req.body || {};

    if (!token || !password) {
      return res.status(400).json({ message: 'Token and new password are required.' });
    }

    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');

    const { rows } = await pool.query(
      `
        SELECT id, user_id, expires_at, used_at
        FROM password_reset_tokens
        WHERE token_hash = $1
        LIMIT 1
      `,
      [tokenHash]
    );

    const row = rows[0];
    if (!row || row.used_at || new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ message: 'Invalid or expired reset token.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query('BEGIN');
    try {
      await pool.query(`UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2`, [
        hashedPassword,
        row.user_id,
      ]);
      await pool.query(
        `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`,
        [row.id]
      );
      // Invalidate any other unused tokens for this user
      await pool.query(
        `
          UPDATE password_reset_tokens
          SET used_at = NOW()
          WHERE user_id = $1 AND used_at IS NULL AND id <> $2
        `,
        [row.user_id, row.id]
      );
      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }

    return res.json({ message: 'Password updated. You can sign in with your new password.' });
  } catch (err) {
    console.error('resetPassword error:', err);
    return res.status(500).json({ message: 'Server error resetting password.' });
  }
}

/**
 * POST /api/auth/change-password  (authenticated)
 * { current_password, new_password }
 */
async function changePassword(req, res) {
  try {
    const { current_password, new_password } = req.body || {};

    if (!current_password || !new_password) {
      return res.status(400).json({
        message: 'current_password and new_password are required.',
      });
    }

    if (typeof new_password !== 'string' || new_password.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters.' });
    }

    const { rows } = await pool.query(`SELECT id, password FROM users WHERE id = $1 LIMIT 1`, [
      req.user.id,
    ]);

    const user = rows[0];
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const ok = await bcrypt.compare(String(current_password), user.password);
    if (!ok) {
      return res.status(401).json({ message: 'Current password is incorrect.' });
    }

    const hashedPassword = await bcrypt.hash(String(new_password), 10);
    await pool.query(`UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2`, [
      hashedPassword,
      user.id,
    ]);

    return res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error('changePassword error:', err);
    return res.status(500).json({ message: 'Server error changing password.' });
  }
}

module.exports = {
  signup,
  login,
  forgotUsername,
  forgotPassword,
  resetPassword,
  changePassword,
};
