const { Resend } = require('resend');
const { logEmail } = require('./notificationSettings');

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
 * @param {{ to: string|string[], subject: string, html: string, text?: string, emailType?: string }} opts
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
    err.statusCode = error.statusCode;
    throw err;
  }

  return data;
}

async function sendEmailSafe(opts) {
  const recipients = Array.isArray(opts.to) ? opts.to : [opts.to];
  const recipientStr = recipients.filter(Boolean).join(',');
  try {
    const data = await sendEmail(opts);
    console.log(
      `[email] OK type=${opts.emailType || 'generic'} to=${recipientStr} id=${data?.id || 'n/a'} from=${getFrom()}`
    );
    if (opts.emailType) {
      await logEmail({
        emailType: opts.emailType,
        recipient: recipientStr,
        meta: { ok: true, id: data?.id || null, subject: opts.subject },
      });
    }
    return data;
  } catch (err) {
    console.error(
      `[email] FAIL type=${opts.emailType || 'generic'} to=${recipientStr} from=${getFrom()}:`,
      err.message || err
    );
    await logEmail({
      emailType: opts.emailType || 'email_failure',
      recipient: recipientStr,
      meta: {
        ok: false,
        error: err.message || String(err),
        subject: opts.subject || null,
        from: getFrom(),
      },
    });
    return null;
  }
}

module.exports = { sendEmail, sendEmailSafe, getFrom };
