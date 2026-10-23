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
  const user = firstEnv([
    'SMTP_USER',
    'SMTP_USERNAME',
    'MAIL_USER',
    'MAIL_USERNAME',
    'EMAIL_USER',
  ]);
  const pass = firstEnv([
    'SMTP_PASS',
    'SMTP_PASSWORD',
    'MAIL_PASS',
    'MAIL_PASSWORD',
    'EMAIL_PASS',
    'EMAIL_PASSWORD',
  ]);

  let host = firstEnv(['SMTP_HOST', 'MAIL_HOST', 'EMAIL_HOST']);
  if (!host || host === 'smtp.example.com') host = 'smtp.hostinger.com';
  const port = Number(firstEnv(['SMTP_PORT', 'MAIL_PORT', 'EMAIL_PORT']) || 465);

  if (!user || !pass) {
    const err = new Error('SMTP_USER and SMTP_PASS must be set (Hostinger mailbox login)');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }
  if (!Number.isFinite(port) || port <= 0) {
    const err = new Error('SMTP_PORT must be a valid port number');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }
  return { host, port, user, pass, via: 'hostinger' };
}

function getFrom() {
  const from = firstEnv(['SMTP_FROM', 'MAIL_FROM', 'EMAIL_FROM']);
  if (from) return from;
  const user = firstEnv(['SMTP_USER', 'SMTP_USERNAME', 'MAIL_USER', 'MAIL_USERNAME', 'EMAIL_USER']);
  return user ? `"Textured Lab Portal" <${user}>` : 'Textured Lab Portal';
}

function getBcc() {
  return firstEnv(['SMTP_BCC']) || firstEnv(['SMTP_USER', 'SMTP_USERNAME', 'MAIL_USER']) || '';
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
 * @param {{ to: string|string[], subject: string, html?: string, text?: string, replyTo?: string, skipBcc?: boolean }} opts
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

  const bcc = opts.skipBcc ? '' : getBcc();
  const toList = (Array.isArray(to) ? to : [to]).map((email) => String(email).trim().toLowerCase());
  if (bcc && !toList.includes(bcc.toLowerCase())) {
    mail.bcc = bcc;
  }

  try {
    const info = await getTransporter().sendMail(mail);
    console.log('[email] sent', {
      to,
      bcc: mail.bcc || null,
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response,
    });
    return { id: info.messageId, accepted: info.accepted, response: info.response, ...info };
  } catch (error) {
    const detail = [error.code, error.response, error.message].filter(Boolean).join(' — ');
    const err = new Error(detail || 'Failed to send email');
    err.code = error.code || 'SMTP_SEND_FAILED';
    err.cause = error;
    throw err;
  }
}

module.exports = { sendEmail, getFrom, getReplyTo, getBcc, logMailerStatus };
