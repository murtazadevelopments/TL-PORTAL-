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
    'Textured Lab Portal <onboarding@resend.dev>'
  );
}

function uniqueRecipients(to) {
  const list = Array.isArray(to) ? to : [to];
  return [
    ...new Set(
      list
        .map((email) => String(email || '').trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

async function sendOne({ to, subject, html, text }) {
  const resend = getClient();
  const { data, error } = await resend.emails.send({
    from: getFrom(),
    to: [to],
    subject,
    html,
    text: text || undefined,
  });

  if (error) {
    const err = new Error(error.message || 'Failed to send email');
    err.cause = error;
    err.statusCode = error.statusCode;
    err.recipient = to;
    throw err;
  }

  return data;
}

/**
 * Always sends one message per recipient so nobody can see another address.
 * @param {{ to: string|string[], subject: string, html: string, text?: string, emailType?: string }} opts
 */
async function sendEmail(opts) {
  const recipients = uniqueRecipients(opts.to);
  if (!recipients.length) {
    const err = new Error('No email recipient');
    err.code = 'NO_RECIPIENT';
    throw err;
  }

  const results = [];
  for (const recipient of recipients) {
    results.push(
      await sendOne({
        to: recipient,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      })
    );
  }
  return results.length === 1 ? results[0] : results;
}

async function sendEmailSafe(opts) {
  const recipients = uniqueRecipients(opts.to);
  if (!recipients.length) {
    console.warn(`[email] SKIP type=${opts.emailType || 'generic'} no recipients`);
    return null;
  }

  let lastOk = null;
  for (const recipient of recipients) {
    try {
      const data = await sendOne({
        to: recipient,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      });
      lastOk = data;
      console.log(
        `[email] OK type=${opts.emailType || 'generic'} to=${recipient} id=${data?.id || 'n/a'} from=${getFrom()}`
      );
      if (opts.emailType) {
        await logEmail({
          emailType: opts.emailType,
          recipient,
          meta: { ok: true, id: data?.id || null, subject: opts.subject },
        });
      }
    } catch (err) {
      console.error(
        `[email] FAIL type=${opts.emailType || 'generic'} to=${recipient} from=${getFrom()}:`,
        err.message || err
      );
      await logEmail({
        emailType: opts.emailType || 'email_failure',
        recipient,
        meta: {
          ok: false,
          error: err.message || String(err),
          subject: opts.subject || null,
          from: getFrom(),
        },
      });
    }
  }

  return lastOk;
}

module.exports = { sendEmail, sendEmailSafe, getFrom };
