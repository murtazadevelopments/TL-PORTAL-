const pool = require('../config/db');

const SETTING_NEW_SIGNUP_RECIPIENT = 'new_signup_recipient';

async function getSetting(key) {
  const { rows } = await pool.query(
    `
      SELECT id, setting_key, setting_value, updated_by, updated_at
      FROM notification_settings
      WHERE setting_key = $1
      LIMIT 1
    `,
    [key]
  );
  return rows[0] || null;
}

async function upsertSetting(key, value, updatedBy) {
  const { rows } = await pool.query(
    `
      INSERT INTO notification_settings (setting_key, setting_value, updated_by, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (setting_key)
      DO UPDATE SET
        setting_value = EXCLUDED.setting_value,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      RETURNING id, setting_key, setting_value, updated_by, updated_at
    `,
    [key, value, updatedBy ?? null]
  );
  return rows[0];
}

/**
 * Resolve new_signup_recipient to an email.
 * setting_value may be a user id or a raw email address.
 */
async function resolveNewSignupRecipientEmail() {
  const setting = await getSetting(SETTING_NEW_SIGNUP_RECIPIENT);
  if (!setting?.setting_value) return null;

  const raw = String(setting.setting_value).trim();
  if (!raw) return null;

  if (raw.includes('@')) {
    return { email: raw.toLowerCase(), userId: null, source: 'email' };
  }

  const { rows } = await pool.query(
    `
      SELECT id, name, email, employee_id, username, is_active
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [Number(raw) || raw]
  );
  if (!rows[0]) {
    console.warn(
      `[signup-notify] notification_settings user_id=${raw} not found in users`
    );
    return null;
  }
  if (rows[0].is_active === false) {
    console.warn(
      `[signup-notify] notification_settings user_id=${raw} is deactivated`
    );
    return null;
  }
  if (!rows[0].email) {
    console.warn(
      `[signup-notify] notification_settings user_id=${raw} has no email on file`
    );
    return null;
  }
  return {
    email: String(rows[0].email).trim().toLowerCase(),
    userId: rows[0].id,
    user: rows[0],
    source: 'user_id',
  };
}

async function logEmail({ emailType, recipient, meta }) {
  try {
    await pool.query(
      `
        INSERT INTO email_log (email_type, recipient, meta)
        VALUES ($1, $2, $3::jsonb)
      `,
      [emailType, recipient || null, JSON.stringify(meta || {})]
    );
  } catch (err) {
    console.warn('email_log insert failed:', err.message);
  }
}

module.exports = {
  SETTING_NEW_SIGNUP_RECIPIENT,
  getSetting,
  upsertSetting,
  resolveNewSignupRecipientEmail,
  logEmail,
};
