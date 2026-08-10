const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { supabase, BUCKETS } = require('../config/supabaseClient');
const { extFromFile } = require('../middleware/uploadMiddleware');
const { attachReadableUrls } = require('../utils/storageUrls');

const USER_PUBLIC_COLUMNS = `
  id, employee_id, username, first_name, father_name, email, contact_number,
  address, cnic_number, cnic_front_url, cnic_back_url, cv_url,
  profile_picture_url, role, department, date_joined, created_at, updated_at
`;

const USERNAME_REGEX = /^[a-z0-9._]+$/;

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

/**
 * Upload a buffer to a Supabase Storage bucket.
 * Stores the object path; readable signed/public URLs are resolved on GET /users/me.
 */
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
 * multipart/form-data — text fields + cnic_front, cnic_back, cv, profile_picture
 */
async function signup(req, res) {
  try {
    const {
      username,
      first_name,
      father_name,
      email,
      password,
      contact_number,
      address,
      cnic_number,
      department,
    } = req.body;

    const cnicFront = getFile(req, 'cnic_front');
    const cnicBack = getFile(req, 'cnic_back');
    const cv = getFile(req, 'cv');
    const profilePicture = getFile(req, 'profile_picture');

    if (
      !username ||
      !first_name ||
      !father_name ||
      !email ||
      !password ||
      !contact_number ||
      !address ||
      !cnic_number
    ) {
      return res.status(400).json({
        message:
          'username, first_name, father_name, email, password, contact_number, address, and cnic_number are required.',
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

    if (!cnicFront || !cnicBack || !cv || !profilePicture) {
      return res.status(400).json({
        message: 'All files are required: cnic_front, cnic_back, cv, profile_picture.',
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedCnic = String(cnic_number).trim();
    const hashedPassword = await bcrypt.hash(password, 10);
    const employeeId = `EMP-${Date.now().toString(36).toUpperCase()}`;

    // Upload documents to the correct buckets
    const cnicFrontPath = `${employeeId}/cnic_front${extFromFile(cnicFront, '.jpg')}`;
    const cnicBackPath = `${employeeId}/cnic_back${extFromFile(cnicBack, '.jpg')}`;
    const cvPath = `${employeeId}/cv${extFromFile(cv, '.pdf')}`;
    const profilePath = `${employeeId}/profile${extFromFile(profilePicture, '.jpg')}`;

    const [cnic_front_url, cnic_back_url, cv_url, profile_picture_url] = await Promise.all([
      uploadToBucket(BUCKETS.cnic, cnicFrontPath, cnicFront),
      uploadToBucket(BUCKETS.cnic, cnicBackPath, cnicBack),
      uploadToBucket(BUCKETS.cv, cvPath, cv),
      uploadToBucket(BUCKETS.profile, profilePath, profilePicture),
    ]);

    const insertQuery = `
      INSERT INTO users (
        employee_id, username, first_name, father_name, email, password,
        contact_number, address, cnic_number,
        cnic_front_url, cnic_back_url, cv_url, profile_picture_url,
        role, department, date_joined
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12, $13,
        $14, $15, NOW()
      )
      RETURNING ${USER_PUBLIC_COLUMNS}
    `;

    const { rows } = await pool.query(insertQuery, [
      employeeId,
      normalizedUsername,
      String(first_name).trim(),
      String(father_name).trim(),
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
    ]);

    const user = await attachReadableUrls(rows[0]);
    const token = signToken(user);

    return res.status(201).json({ token, user });
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
      return res.status(409).json({
        message: 'Duplicate value — username, email, or CNIC already registered.',
      });
    }

    console.error('signup error:', err);
    return res.status(err.status || 500).json({
      message: err.message || 'Server error during signup.',
    });
  }
}

/**
 * POST /api/auth/login
 * JSON body: { username, password }
 */
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

module.exports = { signup, login };
