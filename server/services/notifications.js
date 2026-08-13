const pool = require('../config/db');
const { sendEmailSafe } = require('./email');

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

async function notifyAdminsNewSignup(user) {
  const admins = await getAdminEmails();
  if (!admins.length) {
    console.warn('No admin emails found for signup notification');
    return;
  }

  const name = escapeHtml(user.name);
  const username = escapeHtml(user.username);
  const email = escapeHtml(user.email);
  const education = escapeHtml(user.education || '—');
  const lastJob = escapeHtml(user.last_job_status || '—');
  const contact = escapeHtml(user.contact_number || '—');

  await sendEmailSafe({
    to: admins,
    subject: `New employee signup: ${user.name}`,
    html: `
      <p>A new employee account was created.</p>
      <ul>
        <li><strong>Name:</strong> ${name}</li>
        <li><strong>Username:</strong> ${username}</li>
        <li><strong>Email:</strong> ${email}</li>
        <li><strong>Contact:</strong> ${contact}</li>
        <li><strong>Education:</strong> ${education}</li>
        <li><strong>Last job status:</strong> ${lastJob}</li>
      </ul>
      <p>Assign an Employee ID in the admin panel when ready.</p>
      <p><em>Banking details were submitted but are not included in this email.</em></p>
    `,
  });
}

async function notifyUserSignup(user) {
  if (!user?.email) return;
  await sendEmailSafe({
    to: user.email,
    subject: 'Welcome to Textured Lab — account created',
    html: `
      <p>Congrats, <strong>${escapeHtml(user.name)}</strong>!</p>
      <p>Your employee portal account has been created.</p>
      <p>Username: <strong>${escapeHtml(user.username)}</strong></p>
      <p>An administrator will assign your Employee ID and work details.</p>
    `,
  });
}

async function notifyUsernameReminder(user) {
  if (!user?.email) return;
  await sendEmailSafe({
    to: user.email,
    subject: 'Your Portal TL username',
    html: `
      <p>Hi ${escapeHtml(user.name || '')},</p>
      <p>Your username is: <strong>${escapeHtml(user.username)}</strong></p>
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

module.exports = {
  getAdminEmails,
  notifyAdminsNewSignup,
  notifyUserSignup,
  notifyUsernameReminder,
  notifyPasswordReset,
  notifyEmployeeAdminUpdated,
  notifyAdminsEmployeeSelfUpdate,
  summarizeChanges,
};
