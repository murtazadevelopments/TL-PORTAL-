const nodemailer = require('nodemailer');
const { withOutboundTimeout } = require('../utils/hangDiagnostics');

let transporter;
let loggedVerify = false;
let sendChain = Promise.resolve();
let sendCount = 0;
let countDayKey = '';

const RATE_LIMIT_RETRIES = 4;
const RATE_LIMIT_WAIT_MS = 15000;

function env(name) {
  return String(process.env[name] || '').trim();
}

function smtpConfig() {
  const host = env('SMTP_HOST');
  const port = Number(env('SMTP_PORT') || 587);
  const user = env('SMTP_USER');
  const pass = env('SMTP_PASS');
  const from = env('MAIL_FROM') || env('SMTP_FROM');

  if (!host || !user || !pass || !from) {
    const err = new Error('SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and MAIL_FROM must be set');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }
  if (!Number.isFinite(port) || port <= 0) {
    const err = new Error('SMTP_PORT must be a valid port number');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }
  return { host, port, user, pass, from };
}

function getFrom() {
  return env('MAIL_FROM') || env('SMTP_FROM') || 'Textured Lab Portal <noreply@texturedlab.org>';
}

function getReplyTo() {
  return env('SMTP_REPLY_TO') || env('MAIL_REPLY_TO') || undefined;
}

function parseAddress(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(.*)<([^>]+)>\s*$/);
  if (!match) return { email: raw, name: undefined };
  const name = match[1].trim().replace(/^"|"$/g, '');
  return { email: match[2].trim(), name: name || undefined };
}

function mailProvider() {
  return env('BREVO_API_KEY') ? 'brevo-api' : 'smtp';
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

function safeSmtpLog(err) {
  return {
    code: err?.code || null,
    responseCode: err?.responseCode || null,
    message: String(err?.message || 'send failed').slice(0, 180),
  };
}

function getTransporter() {
  if (transporter) return transporter;
  const { host, port, user, pass } = smtpConfig();
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: false,
    requireTLS: true,
    auth: { user, pass },
    family: 4,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    tls: {
      minVersion: 'TLSv1.2',
      servername: host,
    },
  });
  return transporter;
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function bumpDailyCount() {
  const key = todayKey();
  if (key !== countDayKey) {
    countDayKey = key;
    sendCount = 0;
  }
  sendCount += 1;
  const warnAt = Number(env('MAIL_DAILY_WARN'));
  const limit = Number.isFinite(warnAt) && warnAt > 0 ? warnAt : 250;
  if (sendCount === limit + 1 || (sendCount > limit && sendCount % 50 === 0)) {
    console.warn(`[mailer] daily send count ${sendCount} passed MAIL_DAILY_WARN=${limit}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitedError(error) {
  const code = Number(error?.responseCode);
  if (Number.isFinite(code) && code >= 400 && code < 500) return true;
  const text = [error?.code, error?.message].filter(Boolean).join(' ');
  return /451|4\.7\.1|ratelimit|rate limit/i.test(text);
}

function verifyMailer() {
  if (loggedVerify) return;
  loggedVerify = true;
  Promise.resolve()
    .then(() => getTransporter().verify())
    .then(() => {
      console.log('[mailer] Mail transport ready');
    })
    .catch((err) => {
      const safe = safeSmtpLog(err);
      console.error(
        `[mailer] verify failed code=${safe.code || 'n/a'} responseCode=${safe.responseCode || 'n/a'} ${safe.message}`
      );
    });
}

function logMailerStatus() {
  verifyMailer();
}

/**
 * Send one email over SMTP (Nodemailer / Brevo).
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
    text: opts.text || htmlToText(opts.html),
  };
  if (Array.isArray(opts.attachments) && opts.attachments.length) {
    mail.attachments = opts.attachments;
  }
  const replyTo = opts.replyTo || getReplyTo();
  if (replyTo) mail.replyTo = replyTo;

  const run = sendChain.then(() => sendEmailQueued(mail, to, opts.timeoutMs));
  sendChain = run.then(
    () => {},
    () => {}
  );
  return run;
}

async function sendViaBrevoApi(mail, signal) {
  const sender = parseAddress(mail.from);
  const recipients = (Array.isArray(mail.to) ? mail.to : [mail.to]).map((email) => ({
    email: String(email),
  }));
  const body = {
    sender: { email: sender.email, name: sender.name },
    to: recipients,
    subject: mail.subject,
    htmlContent: mail.html || '',
    textContent: mail.text || '',
  };
  if (mail.replyTo) {
    const reply = parseAddress(mail.replyTo);
    body.replyTo = { email: reply.email, name: reply.name };
  }
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': env('BREVO_API_KEY'),
    },
    body: JSON.stringify(body),
    signal,
  });
  const raw = await response.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const messageId = parsed?.messageId || null;
  console.log(
    `[email] provider=brevo-api status=${response.status} messageId=${messageId || 'n/a'}`
  );
  if (!response.ok) {
    const err = new Error(parsed?.message || `Brevo API HTTP ${response.status}`);
    err.code = 'BREVO_API_FAILED';
    err.responseCode = response.status;
    throw err;
  }
  return { id: messageId, provider: 'brevo-api', status: response.status, response: parsed };
}

async function sendEmailQueued(mail, to, timeoutMs) {
  if (mailProvider() === 'brevo-api' && !(mail.attachments && mail.attachments.length)) {
    const info = await withOutboundTimeout(
      'brevo',
      (signal) => sendViaBrevoApi(mail, signal),
      timeoutMs
    );
    bumpDailyCount();
    return info;
  }

  mail.from = smtpConfig().from;
  let lastError;
  for (let attempt = 1; attempt <= RATE_LIMIT_RETRIES; attempt += 1) {
    try {
      const info = await withOutboundTimeout(
        'brevo',
        () => getTransporter().sendMail(mail),
        timeoutMs
      );
      bumpDailyCount();
      console.log(
        `[email] provider=smtp status=${info.responseCode || 'n/a'} messageId=${info.messageId || 'n/a'}`
      );
      return {
        id: info.messageId,
        provider: 'smtp',
        status: info.responseCode || null,
        accepted: info.accepted,
        response: info.response,
      };
    } catch (error) {
      lastError = error;
      const safe = safeSmtpLog(error);
      console.error(
        `[email] send failed code=${safe.code || 'n/a'} responseCode=${safe.responseCode || 'n/a'} ${safe.message}`
      );
      if (!isRateLimitedError(error) || attempt >= RATE_LIMIT_RETRIES) break;
      const waitMs = RATE_LIMIT_WAIT_MS * attempt;
      console.warn(`[email] SMTP 4xx for recipient; retry ${attempt}/${RATE_LIMIT_RETRIES} in ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs);
    }
  }
  const safe = safeSmtpLog(lastError);
  const err = new Error(safe.message || 'Failed to send email');
  err.code = lastError?.code || 'SMTP_SEND_FAILED';
  err.responseCode = lastError?.responseCode;
  err.cause = lastError;
  throw err;
}

const sendMail = sendEmail;

module.exports = {
  getTransporter,
  sendMail,
  sendEmail,
  getFrom,
  getReplyTo,
  mailProvider,
  verifyMailer,
  logMailerStatus,
};
