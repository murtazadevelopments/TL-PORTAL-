const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');
const { ImapFlow } = require('imapflow');
let transporter;
let loggedStatus = false;
let lastLocalSendAt = 0;
let sendChain = Promise.resolve();

const SEND_GAP_MS = 12000;
const RATE_LIMIT_RETRIES = 4;
const RATE_LIMIT_WAIT_MS = 25000;

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

function getReplyTo() {
  return firstEnv(['SMTP_REPLY_TO', 'MAIL_REPLY_TO']) || undefined;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitedError(error) {
  const text = [error?.code, error?.response, error?.responseCode, error?.message]
    .filter(Boolean)
    .join(' ');
  return /451|4\.7\.1|ratelimit|rate limit|EMESSAGE/i.test(text) && /451|4\.7\.1|ratelimit|rate limit/i.test(text);
}

async function withSmtpSlot(work) {
  const wait = lastLocalSendAt + SEND_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  try {
    return await work();
  } finally {
    lastLocalSendAt = Date.now();
  }
}

async function saveToSent(mail) {
  const raw = await new MailComposer(mail).compile().build();
  const { user, pass } = smtpSettings();
  const client = new ImapFlow({
    host: 'imap.hostinger.com',
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });
  try {
    await client.connect();
    await client.append('INBOX.Sent', raw, ['\\Seen']);
  } finally {
    await client.logout();
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

  const html = opts.html;
  const text = opts.text || htmlToText(html);
  const mail = {
    from: getFrom(),
    to,
    subject: opts.subject,
    html,
    text,
  };
  const replyTo = opts.replyTo || getReplyTo();
  if (replyTo) mail.replyTo = replyTo;

  const run = sendChain.then(() => sendEmailQueued(mail, to));
  sendChain = run.then(
    () => {},
    () => {}
  );
  return run;
}

async function sendEmailQueued(mail, to) {
  let lastError;
  for (let attempt = 1; attempt <= RATE_LIMIT_RETRIES; attempt += 1) {
    try {
      const info = await withSmtpSlot(() => getTransporter().sendMail(mail));
      console.log('[email] sent', {
        to,
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
      });
      saveToSent(mail).catch((err) => {
        console.error('[email] save-to-sent failed', err.message || err);
      });
      return { id: info.messageId, accepted: info.accepted, response: info.response, ...info };
    } catch (error) {
      lastError = error;
      if (!isRateLimitedError(error) || attempt >= RATE_LIMIT_RETRIES) break;
      const waitMs = RATE_LIMIT_WAIT_MS * attempt;
      console.warn(
        `[email] Hostinger rate limit for ${to}; retry ${attempt}/${RATE_LIMIT_RETRIES} in ${Math.round(waitMs / 1000)}s`
      );
      await sleep(waitMs);
    }
  }
  const detail = [lastError?.code, lastError?.response, lastError?.message]
    .filter(Boolean)
    .join(' — ');
  const err = new Error(detail || 'Failed to send email');
  err.code = lastError?.code || 'SMTP_SEND_FAILED';
  err.cause = lastError;
  throw err;
}

module.exports = { sendEmail, getFrom, getReplyTo, logMailerStatus };
