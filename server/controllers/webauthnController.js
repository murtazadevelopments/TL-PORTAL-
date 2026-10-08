const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { isoBase64URL } = require('@simplewebauthn/server/helpers');
const pool = require('../config/db');
const { attachReadableUrls } = require('../utils/storageUrls');
const { frontendBaseUrl, PUBLIC_FRONTEND_URL } = require('../utils/frontendUrl');
const { recordSuccessfulLogin } = require('../services/loginActivity');
const jwt = require('jsonwebtoken');

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      employee_id: user.employee_id,
      username: user.username,
      email: user.email,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function omitPassword(row) {
  if (!row) return null;
  const { password, salary, ...safe } = row;
  safe.salary_hidden = true;
  return safe;
}

function getWebAuthnConfig(req) {
  const rpName = process.env.WEBAUTHN_RP_NAME || 'Textured Lab Portal';

  const requestOrigin = req.get('origin') || req.get('referer');
  let fromRequest = [];
  let requestHost = null;
  if (requestOrigin) {
    try {
      const u = new URL(requestOrigin);
      fromRequest = [u.origin];
      requestHost = u.hostname;
    } catch {
      /* ignore */
    }
  }

  const isLocal =
    requestHost === 'localhost' ||
    requestHost === '127.0.0.1' ||
    process.env.WEBAUTHN_RP_ID === 'localhost';

  const rpID =
    process.env.WEBAUTHN_RP_ID ||
    (isLocal
      ? 'localhost'
      : (() => {
          try {
            return new URL(frontendBaseUrl()).hostname;
          } catch {
            return 'texturedlab.org';
          }
        })());

  // When the browser is on localhost, force RP ID localhost (override env if needed)
  const effectiveRpID =
    requestHost === 'localhost' || requestHost === '127.0.0.1' ? 'localhost' : rpID;

  const originFromEnv = String(process.env.WEBAUTHN_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const defaults = [
    PUBLIC_FRONTEND_URL,
    'https://www.texturedlab.org',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ];

  const expectedOrigin = [...new Set([...originFromEnv, ...fromRequest, ...defaults])];

  return { rpName, rpID: effectiveRpID, expectedOrigin, expectedRPID: effectiveRpID };
}

async function saveChallenge({ userId, username, challenge, type }) {
  await pool.query(`DELETE FROM webauthn_challenges WHERE expires_at < NOW()`);
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  await pool.query(
    `
      INSERT INTO webauthn_challenges (user_id, username, challenge, type, expires_at)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [userId ?? null, username ?? null, challenge, type, expiresAt]
  );
}

async function consumeChallenge({ userId, username, type }) {
  const params = [type];
  let where = `type = $1 AND expires_at > NOW()`;
  if (userId != null) {
    params.push(userId);
    where += ` AND user_id = $${params.length}`;
  } else if (username) {
    params.push(String(username).trim().toLowerCase());
    where += ` AND username = $${params.length}`;
  } else {
    return null;
  }

  const { rows } = await pool.query(
    `
      SELECT id, challenge
      FROM webauthn_challenges
      WHERE ${where}
      ORDER BY id DESC
      LIMIT 1
    `,
    params
  );
  const row = rows[0];
  if (!row) return null;
  await pool.query(`DELETE FROM webauthn_challenges WHERE id = $1`, [row.id]);
  return row.challenge;
}

async function listUserCredentials(userId) {
  const { rows } = await pool.query(
    `
      SELECT id, credential_id, public_key, counter, device_label, transports, created_at
      FROM webauthn_credentials
      WHERE user_id = $1
      ORDER BY created_at DESC
    `,
    [userId]
  );
  return rows;
}

/**
 * GET /api/auth/webauthn/credentials  (auth)
 */
async function listCredentials(req, res) {
  try {
    const rows = await listUserCredentials(req.user.id);
    return res.json(
      rows.map((r) => ({
        id: r.id,
        device_label: r.device_label,
        created_at: r.created_at,
      }))
    );
  } catch (err) {
    console.error('webauthn listCredentials error:', err);
    return res.status(500).json({ message: 'Failed to list passkeys.' });
  }
}

/**
 * DELETE /api/auth/webauthn/credentials/:id  (auth)
 */
async function deleteCredential(req, res) {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM webauthn_credentials WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) {
      return res.status(404).json({ message: 'Passkey not found.' });
    }
    return res.json({ message: 'Passkey removed.' });
  } catch (err) {
    console.error('webauthn deleteCredential error:', err);
    return res.status(500).json({ message: 'Failed to remove passkey.' });
  }
}

/**
 * GET /api/auth/webauthn/has-credential?username=  (public)
 */
async function hasCredential(req, res) {
  try {
    const username = String(req.query.username || '')
      .trim()
      .toLowerCase();
    if (!username) {
      return res.json({ hasCredential: false });
    }
    const { rows } = await pool.query(
      `
        SELECT 1
        FROM webauthn_credentials c
        JOIN users u ON u.id = c.user_id
        WHERE u.username = $1
          AND u.is_active IS DISTINCT FROM false
        LIMIT 1
      `,
      [username]
    );
    return res.json({ hasCredential: rows.length > 0 });
  } catch (err) {
    console.error('webauthn hasCredential error:', err);
    return res.json({ hasCredential: false });
  }
}

/**
 * POST /api/auth/webauthn/register-options  (auth)
 */
async function registerOptions(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT id, username, name, email FROM users WHERE id = $1 LIMIT 1`,
      [req.user.id]
    );
    const user = rows[0];
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const existing = await listUserCredentials(user.id);
    const { rpName, rpID } = getWebAuthnConfig(req);

    const userID = new Uint8Array(Buffer.from(String(user.id), 'utf8'));

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID,
      userName: user.username,
      userDisplayName: user.name || user.username,
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({
        id: c.credential_id,
        transports: c.transports ? JSON.parse(c.transports) : undefined,
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
        authenticatorAttachment: 'platform',
      },
    });

    await saveChallenge({
      userId: user.id,
      username: user.username,
      challenge: options.challenge,
      type: 'registration',
    });

    return res.json(options);
  } catch (err) {
    console.error('webauthn registerOptions error:', err);
    return res.status(500).json({ message: 'Failed to start passkey registration.' });
  }
}

/**
 * POST /api/auth/webauthn/register-verify  (auth)
 * body: { response, device_label? }
 */
async function registerVerify(req, res) {
  try {
    const attestation = req.body?.response || req.body;
    const deviceLabel =
      String(req.body?.device_label || '').trim() ||
      req.get('user-agent')?.slice(0, 120) ||
      'This device';

    const expectedChallenge = await consumeChallenge({
      userId: req.user.id,
      type: 'registration',
    });
    if (!expectedChallenge) {
      return res.status(400).json({ message: 'Registration challenge expired. Try again.' });
    }

    const { expectedOrigin, expectedRPID } = getWebAuthnConfig(req);

    const verification = await verifyRegistrationResponse({
      response: attestation,
      expectedChallenge,
      expectedOrigin,
      expectedRPID,
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ message: 'Passkey registration could not be verified.' });
    }

    const { credential } = verification.registrationInfo;
    const credentialId = credential.id;
    const publicKey = isoBase64URL.fromBuffer(credential.publicKey);
    const counter = credential.counter ?? 0;
    const transports = attestation?.response?.transports
      ? JSON.stringify(attestation.response.transports)
      : null;

    await pool.query(
      `
        INSERT INTO webauthn_credentials (
          user_id, credential_id, public_key, counter, device_label, transports
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [req.user.id, credentialId, publicKey, counter, deviceLabel, transports]
    );

    return res.status(201).json({
      message: 'Face/Fingerprint login enabled for this device.',
      device_label: deviceLabel,
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'This passkey is already registered.' });
    }
    console.error('webauthn registerVerify error:', err);
    return res.status(400).json({
      message: err.message || 'Failed to verify passkey registration.',
    });
  }
}

/**
 * POST /api/auth/webauthn/login-options  (public)  { username }
 */
async function loginOptions(req, res) {
  try {
    const username = String(req.body?.username || '')
      .trim()
      .toLowerCase();
    if (!username) {
      return res.status(400).json({ message: 'Username is required.' });
    }

    const { rows: users } = await pool.query(
      `SELECT id, username, is_active, blocked_at, status, role FROM users WHERE username = $1 LIMIT 1`,
      [username]
    );
    const user = users[0];
    // Generic: don't reveal whether user exists
    if (!user || user.is_active === false || user.blocked_at) {
      return res.status(404).json({
        message: 'No Face/Fingerprint login is set up for this username on this account.',
      });
    }

    const creds = await listUserCredentials(user.id);
    if (!creds.length) {
      return res.status(404).json({
        message: 'No Face/Fingerprint login is set up for this username. Enable it from your dashboard after signing in.',
      });
    }

    const { rpID } = getWebAuthnConfig(req);
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: creds.map((c) => {
        let transports;
        try {
          transports = c.transports ? JSON.parse(c.transports) : undefined;
        } catch {
          transports = undefined;
        }
        const platformOnly = Array.isArray(transports)
          ? transports.filter((t) => t === 'internal')
          : [];
        return {
          id: c.credential_id,
          transports: platformOnly.length ? platformOnly : ['internal'],
        };
      }),
      userVerification: 'preferred',
    });
    // SimpleWebAuthn does not forward this yet; Chrome uses it to skip the phone QR.
    options.hints = ['client-device'];

    await saveChallenge({
      userId: user.id,
      username: user.username,
      challenge: options.challenge,
      type: 'authentication',
    });

    return res.json(options);
  } catch (err) {
    console.error('webauthn loginOptions error:', err);
    return res.status(500).json({ message: 'Failed to start biometric login.' });
  }
}

/**
 * POST /api/auth/webauthn/login-verify  (public)  { username, response }
 */
async function loginVerify(req, res) {
  try {
    const username = String(req.body?.username || '')
      .trim()
      .toLowerCase();
    const assertion = req.body?.response || req.body;
    if (!username || !assertion) {
      return res.status(400).json({ message: 'Username and authenticator response are required.' });
    }

    const { rows: users } = await pool.query(`SELECT * FROM users WHERE username = $1 LIMIT 1`, [
      username,
    ]);
    const user = users[0];
    if (!user) {
      return res.status(401).json({ message: 'Biometric login failed.' });
    }
    if (user.is_active === false) {
      return res.status(403).json({
        message: 'This account has been deactivated. Contact an administrator.',
        code: 'ACCOUNT_DEACTIVATED',
      });
    }
    if (user.blocked_at) {
      return res.status(403).json({
        message: 'This account has been blocked. Contact an administrator.',
        code: 'ACCOUNT_BLOCKED',
      });
    }
    if (user.locked_at) {
      return res.status(403).json({
        message:
          'Account locked due to too many failed attempts. Contact your admin.',
        code: 'ACCOUNT_LOCKED',
        accountLocked: true,
      });
    }
    const accountStatus = String(user.status || '')
      .trim()
      .toLowerCase();
    const role = String(user.role || '')
      .trim()
      .toLowerCase();
    if (role === 'employee' && accountStatus !== 'active') {
      return res.status(403).json({
        message: 'Your account is pending admin approval.',
        pendingApproval: true,
      });
    }

    const expectedChallenge = await consumeChallenge({
      userId: user.id,
      username: user.username,
      type: 'authentication',
    });
    if (!expectedChallenge) {
      return res.status(400).json({ message: 'Login challenge expired. Try again.' });
    }

    const credentialId = assertion.id || assertion.rawId;
    const { rows: credRows } = await pool.query(
      `
        SELECT *
        FROM webauthn_credentials
        WHERE user_id = $1 AND credential_id = $2
        LIMIT 1
      `,
      [user.id, credentialId]
    );
    const stored = credRows[0];
    if (!stored) {
      return res.status(401).json({ message: 'Unknown passkey for this account.' });
    }

    const { expectedOrigin, expectedRPID } = getWebAuthnConfig(req);

    const verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge,
      expectedOrigin,
      expectedRPID,
      requireUserVerification: false,
      credential: {
        id: stored.credential_id,
        publicKey: isoBase64URL.toBuffer(stored.public_key),
        counter: Number(stored.counter) || 0,
        transports: stored.transports ? JSON.parse(stored.transports) : undefined,
      },
    });

    if (!verification.verified) {
      return res.status(401).json({ message: 'Biometric login failed.' });
    }

    const newCounter = verification.authenticationInfo?.newCounter;
    if (typeof newCounter === 'number') {
      await pool.query(`UPDATE webauthn_credentials SET counter = $1 WHERE id = $2`, [
        newCounter,
        stored.id,
      ]);
    }

    if ((Number(user.failed_login_attempts) || 0) > 0 || user.locked_at) {
      await pool.query(
        `
          UPDATE users
          SET failed_login_attempts = 0, locked_at = NULL, updated_at = NOW()
          WHERE id = $1
        `,
        [user.id]
      );
    }

    const safeUser = await attachReadableUrls(omitPassword(user));
    void recordSuccessfulLogin(req, user);
    return res.json({
      token: signToken(user),
      user: safeUser,
    });
  } catch (err) {
    console.error('webauthn loginVerify error:', err);
    return res.status(401).json({
      message: err.message || 'Biometric login failed.',
    });
  }
}

module.exports = {
  listCredentials,
  deleteCredential,
  hasCredential,
  registerOptions,
  registerVerify,
  loginOptions,
  loginVerify,
};
