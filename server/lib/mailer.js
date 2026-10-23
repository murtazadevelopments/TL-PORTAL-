const nodemailer = require('nodemailer');

let transporter;

function smtpSettings() {
  const host = String(process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '');
  if (!host || !user || !pass) {
    const err = new Error('SMTP_HOST, SMTP_USER, and SMTP_PASS must be set');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }
  if (!Number.isFinite(port) || port <= 0) {
    const err = new Error('SMTP_PORT must be a valid port number');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }
  return { host, port, user, pass };
}

function getFrom() {
  const from = String(process.env.SMTP_FROM || '').trim();
  if (from) return from;
  const user = String(process.env.SMTP_USER || '').trim();
  return user ? `Textured Lab Portal <${user}>` : 'Textured Lab Portal';
}

function getReplyTo() {
  return String(process.env.SMTP_REPLY_TO || '').trim() || undefined;
}

function getTransporter() {
  if (transporter) return transporter;
  const { host, port, user, pass } = smtpSettings();
  const secureEnv = String(process.env.SMTP_SECURE || '').trim().toLowerCase();
  const secure = secureEnv ? ['1', 'true', 'yes'].includes(secureEnv) : port === 465;
  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
  return transporter;
}

/**
 * Send one email over SMTP (Nodemailer).
 * @param {{ to: string|string[], subject: string, html?: string, text?: string, replyTo?: string }} opts
 */
async function sendEmail(opts) {
  const to = opts?.to;
  if (!to || (Array.isArray(to) && !to.length)) {
    const err = new Error('No email recipient');
    err.code = 'NO_RECIPIENT';
    throw err;
  }

  const mail = {
    from: getFrom(),
    to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  };
  const replyTo = opts.replyTo || getReplyTo();
  if (replyTo) mail.replyTo = replyTo;

  const info = await getTransporter().sendMail(mail);
  return { id: info.messageId, ...info };
}

module.exports = { sendEmail, getFrom, getReplyTo };
