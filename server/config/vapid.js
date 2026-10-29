/**
 * Strict Web Push VAPID setup. Private key is the source of truth; a mismatched
 * public key fails the process instead of silently "repairing".
 */
const crypto = require('crypto');

function cleanEnvKey(value) {
  return String(value || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\s+/g, '');
}

function b64UrlToBuffer(value) {
  const pad = '='.repeat((4 - (value.length % 4)) % 4);
  const b64 = (value + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

function bufferToB64Url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function loadWebPush() {
  try {
    return require('web-push');
  } catch (err) {
    throw new Error(
      `[vapid] web-push package missing — run npm install in server/ (${err.message || err})`
    );
  }
}

const privateKey = cleanEnvKey(process.env.VAPID_PRIVATE_KEY);
if (!privateKey) {
  throw new Error(
    'VAPID_PRIVATE_KEY is required. Generate a pair with: npx web-push generate-vapid-keys'
  );
}

let privBuf;
try {
  privBuf = b64UrlToBuffer(privateKey);
} catch (err) {
  throw new Error(
    `VAPID_PRIVATE_KEY is not valid base64url (${err.message || err}). Regenerate with: npx web-push generate-vapid-keys`
  );
}
if (privBuf.length !== 32) {
  throw new Error(
    `VAPID_PRIVATE_KEY must decode to 32 bytes (got ${privBuf.length}). Regenerate with: npx web-push generate-vapid-keys`
  );
}

let derivedPubBuf;
try {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(privBuf);
  derivedPubBuf = ecdh.getPublicKey();
} catch (err) {
  throw new Error(
    `VAPID_PRIVATE_KEY is not a valid P-256 private key (${err.message || err}). Regenerate with: npx web-push generate-vapid-keys`
  );
}

const publicKey = bufferToB64Url(derivedPubBuf);

const envPublicKey = cleanEnvKey(process.env.VAPID_PUBLIC_KEY);
if (envPublicKey && envPublicKey !== publicKey) {
  throw new Error(
    'VAPID_PUBLIC_KEY does not match VAPID_PRIVATE_KEY. Regenerate both with: npx web-push generate-vapid-keys'
  );
}

const subject = String(process.env.VAPID_SUBJECT || '')
  .trim()
  .replace(/^['"]|['"]$/g, '');
if (!subject || (!/^mailto:/i.test(subject) && !/^https:\/\//i.test(subject))) {
  throw new Error(
    'VAPID_SUBJECT must start with mailto: or https:// (example: mailto:admin@texturedlab.org)'
  );
}

const webpush = loadWebPush();
webpush.setVapidDetails(subject, publicKey, privateKey);

console.log(`[vapid] VAPID OK (public key ${publicKey.length} chars)`);

module.exports = {
  publicKey,
  subject,
  webpush,
};
