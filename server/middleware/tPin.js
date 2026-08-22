const bcrypt = require('bcryptjs');
const pool = require('../config/db');

/**
 * Require a valid CEO T-Pin on the request body (`t_pin` or `tPin`).
 * Must run after auth + requireRole('ceo').
 */
async function requireTPin(req, res, next) {
  try {
    const raw = req.body?.t_pin ?? req.body?.tPin ?? '';
    const pin = String(raw).trim();

    if (!/^\d{4,8}$/.test(pin)) {
      return res.status(400).json({
        message: 'T-Pin is required (4–8 digits) to perform this action.',
        code: 'TPIN_REQUIRED',
      });
    }

    const { rows } = await pool.query(
      'SELECT t_pin_hash FROM users WHERE id = $1 LIMIT 1',
      [req.user.id]
    );
    const hash = rows[0]?.t_pin_hash;
    if (!hash) {
      return res.status(403).json({
        message: 'Set your T-Pin before managing the Team Leader Dashboard.',
        code: 'TPIN_NOT_SET',
      });
    }

    const ok = await bcrypt.compare(pin, hash);
    if (!ok) {
      return res.status(401).json({
        message: 'Invalid T-Pin.',
        code: 'TPIN_INVALID',
      });
    }

    return next();
  } catch (err) {
    console.error('requireTPin error:', err);
    return res.status(500).json({ message: 'Server error verifying T-Pin.' });
  }
}

module.exports = { requireTPin };
