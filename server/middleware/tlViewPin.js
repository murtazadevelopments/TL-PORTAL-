const bcrypt = require('bcryptjs');
const pool = require('../config/db');

let columnsReady = false;
async function ensureViewPinColumns() {
  if (columnsReady) return;
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tl_view_pin_hash TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tl_view_pin_otp_hash TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tl_view_pin_otp_expires_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tl_view_pin_change_until TIMESTAMPTZ`);
  columnsReady = true;
}

function readTlViewPin(req) {
  const header = req.get('x-tl-view-pin') || req.get('X-Tl-View-Pin') || '';
  const body = req.body?.tl_view_pin ?? req.body?.view_pin ?? req.body?.viewPin ?? '';
  return String(header || body || '').trim();
}

/**
 * Anyone opening the Team Leader Dashboard must send a valid unlock PIN
 * (header `X-Tl-View-Pin`). Use 403 (not 401) so the JWT session is not cleared.
 */
function requireTlViewPin() {
  return async function requireTlViewPinMiddleware(req, res, next) {
    try {
      await ensureViewPinColumns();

      const { rows } = await pool.query(
        'SELECT role, tl_view_pin_hash FROM users WHERE id = $1 LIMIT 1',
        [req.user.id]
      );
      const row = rows[0];
      if (!row) {
        return res.status(404).json({ message: 'User not found.' });
      }
      req.user.role = row.role;

      const pin = readTlViewPin(req);
      if (!/^\d{4,8}$/.test(pin)) {
        return res.status(403).json({
          message: 'Enter your PIN to open this dashboard.',
          code: 'TL_VIEW_PIN_REQUIRED',
        });
      }

      const hash = row.tl_view_pin_hash;
      if (!hash) {
        return res.status(403).json({
          message: 'Set your PIN before opening this dashboard.',
          code: 'TL_VIEW_PIN_NOT_SET',
        });
      }

      const ok = await bcrypt.compare(pin, hash);
      if (!ok) {
        return res.status(403).json({
          message: 'Invalid PIN.',
          code: 'TL_VIEW_PIN_INVALID',
        });
      }

      return next();
    } catch (err) {
      console.error('requireTlViewPin error:', err);
      return res.status(500).json({ message: 'Server error verifying dashboard PIN.' });
    }
  };
}

module.exports = { requireTlViewPin, readTlViewPin };
