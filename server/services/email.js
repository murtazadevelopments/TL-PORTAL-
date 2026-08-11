const { Resend } = require('resend');

/**
 * Resend email helper.
 * From-address: use RESEND_FROM if set (verified domain).
 * Otherwise Resend's onboarding sender (testing only).
 */
function getClient() {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    const err = new Error('RESEND_API_KEY is not set');
    err.code = 'RESEND_NOT_CONFIGURED';
    throw err;
  }
  return new Resend(key);
}

function getFrom() {
  return (
    process.env.RESEND_FROM ||
    'Portal TL <onboarding@resend.dev>'
  );
}

/**
 * @param {{ to: string|string[], subject: string, html: string, text?: string }} opts
 */
async function sendEmail({ to, subject, html, text }) {
  const resend = getClient();
  const recipients = Array.isArray(to) ? to : [to];

  const { data, error } = await resend.emails.send({
    from: getFrom(),
    to: recipients,
    subject,
    html,
    text: text || undefined,
  });

  if (error) {
    const err = new Error(error.message || 'Failed to send email');
    err.cause = error;
    throw err;
  }

  return data;
}

async function sendEmailSafe(opts) {
  try {
    return await sendEmail(opts);
  } catch (err) {
    console.error('Email send failed:', err.message || err);
    return null;
  }
}

module.exports = { sendEmail, sendEmailSafe, getFrom };
