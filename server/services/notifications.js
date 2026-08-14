const pool = require('../config/db');
const { sendEmailSafe } = require('./email');
const {
  resolveNewSignupRecipientEmail,
  logEmail,
} = require('./notificationSettings');

async function getAdminEmails() {
  const fromEnv = String(process.env.ADMIN_NOTIFY_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const { rows } = await pool.query(
    `SELECT email FROM users WHERE role IN ('admin', 'ceo') AND email IS NOT NULL`
  );
  const fromDb = rows.map((r) => String(r.email).trim().toLowerCase()).filter(Boolean);

  return [...new Set([...fromEnv, ...fromDb])];
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function firstName(fullName) {
  const part = String(fullName || '')
    .trim()
    .split(/\s+/)[0];
  return part || 'there';
}

function formatTimestamp(value = new Date()) {
  try {
    return new Date(value).toLocaleString('en-PK', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: process.env.APP_TIMEZONE || 'Asia/Karachi',
    });
  } catch {
    return String(value);
  }
}

/**
 * Feature A — notify designated recipient(s) of a new signup.
 * Primary: notification_settings.new_signup_recipient → users.email
 * Also: any admin with permission notifications:signup_recipient
 */
async function notifyDesignatedNewSignup(user) {
  console.log(`[signup-notify] start for new user id=${user?.id} username=${user?.username}`);
  const emails = new Set();

  // 1) Primary: notification_settings
  try {
    const designated = await resolveNewSignupRecipientEmail();
    if (designated?.email) {
      emails.add(designated.email);
      console.log(
        `[signup-notify] settings recipient=${designated.email} (source=${designated.source}, userId=${designated.userId || 'n/a'})`
      );
    } else {
      console.warn(
        '[signup-notify] notification_settings.new_signup_recipient missing or unresolved'
      );
    }
  } catch (err) {
    console.error('[signup-notify] settings lookup failed:', err.message || err);
  }

  // 2) Admins granted the signup-notification permission
  try {
    const { rows } = await pool.query(
      `
        SELECT DISTINCT u.email
        FROM users u
        INNER JOIN admin_permissions ap ON ap.user_id = u.id
        WHERE u.is_active = true
          AND u.email IS NOT NULL
          AND ap.permission_key = 'notifications:signup_recipient'
      `
    );
    for (const row of rows) {
      const email = String(row.email || '')
        .trim()
        .toLowerCase();
      if (email) emails.add(email);
    }
    console.log(`[signup-notify] permission holders added; total recipients=${emails.size}`);
  } catch (err) {
    console.warn('[signup-notify] permission lookup failed:', err.message);
  }

  if (!emails.size) {
    console.warn(
      '[signup-notify] SKIP — no recipients (set notification_settings or grant notifications:signup_recipient)'
    );
    await logEmail({
      emailType: 'new_signup_recipient',
      recipient: null,
      meta: { ok: false, skipped: true, reason: 'no_recipients', userId: user?.id },
    });
    return null;
  }

  const when = formatTimestamp(user.created_at || new Date());
  const to = [...emails];
  const result = await sendEmailSafe({
    emailType: 'new_signup_recipient',
    to,
    subject: `New employee signup: ${user.name || user.username}`,
    html: `
      <p>A new employee account was created on Portal TL.</p>
      <ul>
        <li><strong>Name:</strong> ${escapeHtml(user.name)}</li>
        <li><strong>Employee ID:</strong> ${escapeHtml(user.employee_id || 'Not assigned yet')}</li>
        <li><strong>Username:</strong> ${escapeHtml(user.username)}</li>
        <li><strong>Email:</strong> ${escapeHtml(user.email)}</li>
        <li><strong>Department:</strong> ${escapeHtml(user.department || '—')}</li>
        <li><strong>Designation:</strong> ${escapeHtml(user.designation || '—')}</li>
        <li><strong>Signed up:</strong> ${escapeHtml(when)}</li>
      </ul>
      <p>Assign an Employee ID in the admin panel when ready.</p>
    `,
  });

  return result;
}

/** @deprecated Prefer notifyDesignatedNewSignup — kept for any callers expecting admin blast */
async function notifyAdminsNewSignup(user) {
  return notifyDesignatedNewSignup(user);
}

async function notifyUserSignup(user) {
  if (!user?.email) return;
  await sendEmailSafe({
    to: user.email,
    subject: 'Welcome to Textured Lab — account created',
    html: `
      <p>Congrats, <strong>${escapeHtml(user.name)}</strong>!</p>
      <p>Your employee portal account has been created and is <strong>pending admin approval</strong>.</p>
      <p>Username: <strong>${escapeHtml(user.username)}</strong></p>
      <p>You will be able to sign in after an administrator activates your account. You will receive another email when that happens.</p>
    `,
  });
}

async function notifyAccountApproved(user) {
  if (!user?.email) return null;
  const { frontendBaseUrl } = require('../utils/frontendUrl');
  const loginUrl = `${frontendBaseUrl()}/`;

  const result = await sendEmailSafe({
    emailType: 'account_approved',
    to: user.email,
    subject: 'Your Portal TL account has been approved',
    text: `Hi ${user.name || ''},\n\nYour Portal TL account has been approved. You can now sign in:\n${loginUrl}\n\nUsername: ${user.username || ''}\n`,
    html: `
      <p>Hi ${escapeHtml(user.name || '')},</p>
      <p>Your Portal TL account has been <strong>approved</strong>. You can now sign in.</p>
      <p>Username: <strong>${escapeHtml(user.username || '')}</strong></p>
      <p><a href="${escapeHtml(loginUrl)}">Sign in to Portal TL</a></p>
    `,
  });

  await logEmail({
    emailType: 'account_approved',
    recipient: user.email,
    meta: { userId: user.id, ok: Boolean(result) },
  });

  return result;
}

async function notifyUsernameReminder(userOrUsers) {
  const list = (Array.isArray(userOrUsers) ? userOrUsers : [userOrUsers]).filter(
    (u) => u && String(u.username || '').trim() !== ''
  );
  if (!list.length) {
    console.warn('[forgot-username] skip email — no non-empty username on matched accounts');
    return null;
  }

  const email = list[0].email;
  if (!email) {
    console.warn('[forgot-username] skip email — matched account has no email');
    return null;
  }

  const usernames = [...new Set(list.map((u) => String(u.username).trim()))];
  const greetingName = escapeHtml(list[0].name || '');

  const usernameBlock =
    usernames.length === 1
      ? `<p>Your username is: <strong>${escapeHtml(usernames[0])}</strong></p>`
      : `<p>We found more than one account for this email. Your usernames are:</p>
         <ul>${usernames.map((u) => `<li><strong>${escapeHtml(u)}</strong></li>`).join('')}</ul>`;

  const textBlock =
    usernames.length === 1
      ? `Your username is: ${usernames[0]}`
      : `Your usernames are:\n${usernames.map((u) => `- ${u}`).join('\n')}`;

  return sendEmailSafe({
    emailType: 'forgot_username',
    to: email,
    subject: 'Your Portal TL username',
    text: `Hi ${list[0].name || ''},\n\n${textBlock}\n\nIf you did not request this, you can ignore this email.`,
    html: `
      <p>Hi ${greetingName},</p>
      ${usernameBlock}
      <p>If you did not request this, you can ignore this email.</p>
    `,
  });
}

async function notifyPasswordReset(user, resetUrl) {
  if (!user?.email) return;
  await sendEmailSafe({
    to: user.email,
    subject: 'Reset your Portal TL password',
    html: `
      <p>Hi ${escapeHtml(user.name || '')},</p>
      <p>We received a password reset request. Click the link below (expires in 1 hour):</p>
      <p><a href="${escapeHtml(resetUrl)}">${escapeHtml(resetUrl)}</a></p>
      <p>If you did not request this, you can ignore this email.</p>
    `,
  });
}

const SENSITIVE_KEYS = new Set([
  'password',
  'account_number',
  'iban',
  'bank_name',
  'account_title',
]);

function summarizeChanges(before, after, keys) {
  const changed = [];
  for (const key of keys) {
    const a = before?.[key] ?? null;
    const b = after?.[key] ?? null;
    const aNorm = a == null ? '' : String(a);
    const bNorm = b == null ? '' : String(b);
    if (aNorm === bNorm) continue;
    if (SENSITIVE_KEYS.has(key)) {
      changed.push(`${key.replace(/_/g, ' ')} (updated)`);
    } else {
      changed.push(`${key.replace(/_/g, ' ')}`);
    }
  }
  return changed;
}

async function notifyEmployeeAdminUpdated(employee, changedFields) {
  if (!employee?.email) return;
  const list =
    changedFields.length > 0
      ? `<ul>${changedFields.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`
      : '<p>Your profile information was updated.</p>';

  await sendEmailSafe({
    to: employee.email,
    subject: 'Your profile was updated by an administrator',
    html: `
      <p>Hi ${escapeHtml(employee.name || '')},</p>
      <p>An administrator updated your employee profile.</p>
      ${list}
      <p>Sensitive values (passwords, bank account numbers) are never included in emails.</p>
    `,
  });
}

async function notifyAdminsEmployeeSelfUpdate(employee, changedFields) {
  const admins = await getAdminEmails();
  if (!admins.length) return;

  const list =
    changedFields.length > 0
      ? `<ul>${changedFields.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`
      : '<p>Profile fields were updated.</p>';

  await sendEmailSafe({
    to: admins,
    subject: `Employee profile updated: ${employee.name || employee.username}`,
    html: `
      <p>Employee <strong>${escapeHtml(employee.name || employee.username)}</strong> updated their profile.</p>
      ${list}
      <p><em>Banking/password values are not included.</em></p>
    `,
  });
}

/**
 * Feature B — routine login notification to the user.
 */
async function notifyUserLogin(user, { ip, userAgent, locationLabel } = {}) {
  if (!user?.email) return null;

  const when = formatTimestamp(new Date());
  const device = escapeHtml(userAgent || 'Unknown device');
  const where = escapeHtml(locationLabel || ip || 'Unknown location');

  const result = await sendEmailSafe({
    to: user.email,
    subject: 'New login to your Portal TL account',
    html: `
      <p>Hi ${escapeHtml(firstName(user.name))},</p>
      <p>You just logged in to your Portal TL account.</p>
      <ul>
        <li><strong>When:</strong> ${escapeHtml(when)}</li>
        <li><strong>Approximate location:</strong> ${where}</li>
        <li><strong>Device:</strong> ${device}</li>
      </ul>
      <p>If this was you, no action is needed.</p>
    `,
  });

  await logEmail({
    emailType: 'login_notify',
    recipient: user.email,
    meta: { userId: user.id, ip: ip || null, ok: Boolean(result) },
  });

  return result;
}

/**
 * Feature C — birthday email.
 */
async function notifyBirthday(user) {
  if (!user?.email) return null;

  const result = await sendEmailSafe({
    to: user.email,
    subject: `Happy Birthday, ${firstName(user.name)}! 🎉`,
    html: `
      <p>Happy Birthday, <strong>${escapeHtml(firstName(user.name))}</strong>!</p>
      <p>Everyone at Textured Lab wishes you a wonderful day filled with joy.</p>
      <p>— The Textured Lab team</p>
    `,
  });

  await logEmail({
    emailType: 'birthday',
    recipient: user.email,
    meta: { userId: user.id, ok: Boolean(result) },
  });

  return result;
}

module.exports = {
  getAdminEmails,
  notifyAdminsNewSignup,
  notifyDesignatedNewSignup,
  notifyUserSignup,
  notifyAccountApproved,
  notifyUsernameReminder,
  notifyPasswordReset,
  notifyEmployeeAdminUpdated,
  notifyAdminsEmployeeSelfUpdate,
  notifyUserLogin,
  notifyBirthday,
  summarizeChanges,
  firstName,
  formatTimestamp,
};
