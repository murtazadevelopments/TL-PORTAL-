const pool = require('../config/db');
const { sendEmailSafe } = require('../services/email');
const { PORTAL_SENDER_LABEL } = require('./messageSender');
const { normalizeEmploymentType } = require('./employmentType');

const COOLDOWN_MS = 12 * 60 * 60 * 1000;

let ensured = false;
let ensurePromise = null;

async function ensureAttendanceReviewEmailColumn() {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = pool
      .query(
        `
          ALTER TABLE users
            ADD COLUMN IF NOT EXISTS attendance_review_email_at TIMESTAMPTZ
        `
      )
      .then(() => {
        ensured = true;
      })
      .catch((err) => {
        ensurePromise = null;
        throw err;
      });
  }
  await ensurePromise;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function notifyRemoteAttendanceOpened(target, { force = false } = {}) {
  await ensureAttendanceReviewEmailColumn();
  if (!target?.id) return { sent: false, reason: 'no_user' };
  if (normalizeEmploymentType(target.employment_type) !== 'remote') {
    return { sent: false, reason: 'not_remote' };
  }
  const email = String(target.email || '').trim();
  if (!email) return { sent: false, reason: 'no_email' };

  const { rows: beforeRows } = await pool.query(
    `SELECT attendance_review_email_at FROM users WHERE id = $1 LIMIT 1`,
    [target.id]
  );
  const previousAt = beforeRows[0]?.attendance_review_email_at || null;
  if (!force) {
    const last = previousAt ? new Date(previousAt).getTime() : 0;
    if (Number.isFinite(last) && last > 0 && Date.now() - last < COOLDOWN_MS) {
      return { sent: false, reason: 'cooldown' };
    }
  }

  const claimed = (
    await pool.query(
      `
        UPDATE users
        SET attendance_review_email_at = NOW(), updated_at = NOW()
        WHERE id = $1
          AND (
            $2::boolean
            OR attendance_review_email_at IS NULL
            OR attendance_review_email_at < NOW() - INTERVAL '12 hours'
          )
        RETURNING id
      `,
      [target.id, Boolean(force)]
    )
  ).rows[0];
  if (!claimed) return { sent: false, reason: 'cooldown' };

  const firstName = String(target.name || target.username || 'there').split(' ')[0];
  const subject = 'Your attendance was reviewed';
  const text =
    `Hi ${firstName},\n\n` +
    `Your remote attendance was opened on ${PORTAL_SENDER_LABEL}.\n\n` +
    'If a check is open, complete it from My attendance.\n\n' +
    `— ${PORTAL_SENDER_LABEL}`;
  const result = await sendEmailSafe({
    to: email,
    subject,
    text,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
        <p>Hi ${escapeHtml(firstName)},</p>
        <p>Your remote attendance was opened on <strong>${escapeHtml(PORTAL_SENDER_LABEL)}</strong>.</p>
        <p>If a check is open, complete it from My attendance.</p>
        <p style="margin-top:16px;color:#555;font-size:13px">— ${escapeHtml(PORTAL_SENDER_LABEL)}</p>
      </div>
    `,
    emailType: 'attendance_review',
  });
  if (!result) {
    await pool.query(
      `
        UPDATE users
        SET attendance_review_email_at = $2, updated_at = NOW()
        WHERE id = $1
      `,
      [target.id, previousAt]
    );
    return { sent: false, reason: 'email_failed' };
  }
  return { sent: true, to: email, subject };
}

module.exports = {
  ensureAttendanceReviewEmailColumn,
  notifyRemoteAttendanceOpened,
};
