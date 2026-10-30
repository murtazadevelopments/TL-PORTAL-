/**
 * Node test: keyToB64u round-trip against a reference base64url encoder.
 * Run: node scripts/test-keyToB64u.mjs
 */
import { keyToB64u, urlBase64ToUint8Array, applicationServerKeyMatches } from '../src/utils/pushKeyCodec.js';

function referenceBase64Url(bytes) {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Random 65-byte buffer (uncompressed P-256 public key length).
const buf = new Uint8Array(65);
for (let i = 0; i < buf.length; i += 1) buf[i] = Math.floor(Math.random() * 256);
buf[0] = 0x04;

const encoded = keyToB64u(buf);
const expected = referenceBase64Url(buf);
assert(encoded === expected, `keyToB64u mismatch:\n  got  ${encoded}\n  want ${expected}`);

const roundTrip = urlBase64ToUint8Array(encoded);
assert(roundTrip.length === buf.length, `round-trip length ${roundTrip.length} !== ${buf.length}`);
for (let i = 0; i < buf.length; i += 1) {
  assert(roundTrip[i] === buf[i], `byte ${i}: ${roundTrip[i]} !== ${buf[i]}`);
}
assert(keyToB64u(roundTrip) === encoded, 'keyToB64u(roundTrip) !== encoded');

// Empty / missing subscription key must not force a mismatch.
assert(
  applicationServerKeyMatches({ options: {} }, encoded) === true,
  'missing applicationServerKey should match'
);
assert(
  applicationServerKeyMatches({ options: { applicationServerKey: buf.buffer } }, encoded) === true,
  'matching key should match'
);
assert(
  applicationServerKeyMatches({ options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer } }, encoded) ===
    false,
  'different key should not match'
);

console.log('OK keyToB64u: 65-byte round-trip + compare helpers passed');
