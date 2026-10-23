const { logEmail } = require('./notificationSettings');
const { sendEmail: sendViaSmtp, getFrom } = require('../lib/mailer');

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

function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/(div|h1|h2|h3|tr|li)>/gi, '\n')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function sendOne({ to, subject, html, text }) {
  try {
    return await sendViaSmtp({
      to,
      subject,
      html,
      text: text || htmlToText(html),
    });
  } catch (error) {
    const err = new Error(error.message || 'Failed to send email');
    err.cause = error;
    err.code = error.code;
    err.recipient = to;
    throw err;
  }
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
