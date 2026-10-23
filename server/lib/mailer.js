const nodemailer = require('nodemailer');

let transporter;
let loggedStatus = false;

function unquote(value) {
  const s = String(value || '').trim();
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function firstEnv(keys) {
  for (const key of keys) {
    const value = unquote(process.env[key]);
    if (value) return value;
  }
  return '';
}

function smtpSettings() {
  const mailboxUser = firstEnv([
    'SMTP_USER',
    'SMTP_USERNAME',
    'MAIL_USER',
    'MAIL_USERNAME',
    'EMAIL_USER',
  ]);
  const mailboxPass = firstEnv([
    'SMTP_PASS',
    'SMTP_PASSWORD',
    'MAIL_PASS',
    'MAIL_PASSWORD',
    'EMAIL_PASS',
    'EMAIL_PASSWORD',
  ]);
  const resendKey = firstEnv(['RESEND_API_KEY']);

  let host = firstEnv(['SMTP_HOST', 'MAIL_HOST', 'EMAIL_HOST']);
  const portRaw = firstEnv(['SMTP_PORT', 'MAIL_PORT', 'EMAIL_PORT']);

  if (mailboxUser && mailboxPass) {
    if (!host || host === 'smtp.example.com') host = 'smtp.hostinger.com';
    const port = Number(portRaw || 465);
    if (!Number.isFinite(port) || port <= 0) {
      const err = new Error('SMTP_PORT must be a valid port number');
      err.code = 'SMTP_NOT_CONFIGURED';
      throw err;
    }
    return { host, port, user: mailboxUser, pass: mailboxPass, via: 'mailbox' };
  }

  // Hostinger still has RESEND_API_KEY from before the SDK removal.
  // Nodemailer can send over Resend's SMTP with that key as the password.
  if (resendKey) {
    if (!host || host === 'smtp.example.com' || host === 'smtp.hostinger.com') {
      host = 'smtp.resend.com';
    }
    const port = Number(portRaw || 465);
    return { host, port, user: 'resend', pass: resendKey, via: 'resend-smtp' };
  }

  const err = new Error(
    'Set SMTP_USER + SMTP_PASS (Hostinger mailbox) or keep RESEND_API_KEY for smtp.resend.com'
  );
  err.code = 'SMTP_NOT_CONFIGURED';
  throw err;
}

function getFrom() {
  const from = firstEnv(['SMTP_FROM', 'MAIL_FROM', 'EMAIL_FROM', 'RESEND_FROM']);
  if (from) return from;
  const user = firstEnv(['SMTP_USER', 'SMTP_USERNAME', 'MAIL_USER', 'MAIL_USERNAME', 'EMAIL_USER']);
  return user ? `Textured Lab Portal <${user}>` : 'Textured Lab Portal';
}

function getReplyTo() {
  return firstEnv(['SMTP_REPLY_TO', 'MAIL_REPLY_TO']) || undefined;
}

function transportOptions({ host, port, user, pass }) {
  const secureEnv = firstEnv(['SMTP_SECURE', 'MAIL_SECURE']).toLowerCase();
  const secure = secureEnv
    ? ['1', 'true', 'yes'].includes(secureEnv)
    : port === 465;
  return {
    host,
    port,
    secure,
    requireTLS: !secure,
    auth: { user, pass },
    family: 4,
    name: 'texturedlab.org',
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    tls: {
      minVersion: 'TLSv1.2',
      servername: host,
    },
  };
}

function getTransporter() {
  if (transporter) return transporter;
  const settings = smtpSettings();
  transporter = nodemailer.createTransport(transportOptions(settings));
  return transporter;
}

function logMailerStatus() {
  if (loggedStatus) return;
  loggedStatus = true;
  try {
    const { host, port, user, via } = smtpSettings();
    console.log(
      `[mailer] SMTP ready via=${via || 'smtp'} host=${host} port=${port} user=${user} from=${getFrom()}`
    );
  } catch (err) {
    console.error(`[mailer] ${err.message}. Emails will not send until Hostinger env is set.`);
  }
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

  try {
    const info = await getTransporter().sendMail(mail);
    return { id: info.messageId, accepted: info.accepted, response: info.response, ...info };
  } catch (error) {
    const detail = [error.code, error.response, error.message].filter(Boolean).join(' — ');
    const err = new Error(detail || 'Failed to send email');
    err.code = error.code || 'SMTP_SEND_FAILED';
    err.cause = error;
    throw err;
  }
}

module.exports = { sendEmail, getFrom, getReplyTo, logMailerStatus };
