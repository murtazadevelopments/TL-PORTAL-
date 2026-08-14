const {
  SETTING_NEW_SIGNUP_RECIPIENT,
  getSetting,
  upsertSetting,
} = require('../services/notificationSettings');
const pool = require('../config/db');

/**
 * GET /api/admin/notification-settings
 */
async function getNotificationSettings(req, res) {
  try {
    const setting = await getSetting(SETTING_NEW_SIGNUP_RECIPIENT);
    let recipientUser = null;

    if (setting?.setting_value && !String(setting.setting_value).includes('@')) {
      const { rows } = await pool.query(
        `
          SELECT id, employee_id, name, email, username, role, department, designation
          FROM users
          WHERE id = $1
          LIMIT 1
        `,
        [setting.setting_value]
      );
      recipientUser = rows[0] || null;
    }

    return res.json({
      settings: {
        new_signup_recipient: {
          setting_key: SETTING_NEW_SIGNUP_RECIPIENT,
          setting_value: setting?.setting_value ?? null,
          updated_by: setting?.updated_by ?? null,
          updated_at: setting?.updated_at ?? null,
          recipient_user: recipientUser,
          recipient_email:
            recipientUser?.email ||
            (setting?.setting_value && String(setting.setting_value).includes('@')
              ? String(setting.setting_value).trim().toLowerCase()
              : null),
        },
      },
    });
  } catch (err) {
    console.error('getNotificationSettings error:', err);
    return res.status(500).json({ message: 'Server error loading notification settings.' });
  }
}

/**
 * PUT /api/admin/notification-settings
 * Body: { new_signup_recipient_user_id } or { new_signup_recipient_email }
 *        or { setting_key, setting_value }
 */
async function updateNotificationSettings(req, res) {
  try {
    const body = req.body || {};
    let value = null;

    if (body.new_signup_recipient_user_id != null && body.new_signup_recipient_user_id !== '') {
      const userId = body.new_signup_recipient_user_id;
      const { rows } = await pool.query(
        `
          SELECT id, email, name, employee_id, username
          FROM users
          WHERE id = $1 AND is_active = true AND email IS NOT NULL
          LIMIT 1
        `,
        [userId]
      );
      if (!rows[0]) {
        return res.status(404).json({
          message: 'Selected user not found, inactive, or has no email.',
        });
      }
      value = String(rows[0].id);
    } else if (body.new_signup_recipient_email) {
      const email = String(body.new_signup_recipient_email).trim().toLowerCase();
      if (!email.includes('@')) {
        return res.status(400).json({ message: 'Provide a valid email address.' });
      }
      value = email;
    } else if (
      body.setting_key === SETTING_NEW_SIGNUP_RECIPIENT &&
      body.setting_value != null
    ) {
      value = String(body.setting_value).trim();
    } else if (body.clear_new_signup_recipient) {
      value = null;
    } else {
      return res.status(400).json({
        message:
          'Provide new_signup_recipient_user_id, new_signup_recipient_email, or clear_new_signup_recipient.',
      });
    }

    const saved = await upsertSetting(
      SETTING_NEW_SIGNUP_RECIPIENT,
      value,
      req.user.id
    );

    return res.json({
      message: value
        ? 'New signup notification recipient updated.'
        : 'New signup notification recipient cleared.',
      setting: saved,
    });
  } catch (err) {
    console.error('updateNotificationSettings error:', err);
    return res.status(500).json({ message: 'Server error saving notification settings.' });
  }
}

module.exports = {
  getNotificationSettings,
  updateNotificationSettings,
};
