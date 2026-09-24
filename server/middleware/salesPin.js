const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { isCeoRole } = require('./permissions');
const { ensureSalesTargetsSchema } = require('../utils/ensureSalesTargetsSchema');

function readSalesPin(req) {
  const header = req.get('x-sales-pin') || req.get('X-Sales-Pin') || '';
  const body = req.body?.sales_pin ?? req.body?.salesPin ?? '';
  return String(header || body || '').trim();
}

/**
 * Anyone with sales:targets (including CEO) must send a valid personal sales PIN
 * (header `X-Sales-Pin`). Use 403 (not 401) so the JWT session is not cleared.
 */
function requireSalesPin({ allowCeoBypass = false } = {}) {
  return async function requireSalesPinMiddleware(req, res, next) {
    try {
      await ensureSalesTargetsSchema();

      if (allowCeoBypass && isCeoRole(req.user?.role)) {
        return next();
      }

      const pin = readSalesPin(req);
      if (!/^\d{4,8}$/.test(pin)) {
        return res.status(403).json({
          message: 'Enter your sales PIN to open this dashboard.',
          code: 'SALES_PIN_REQUIRED',
        });
      }

      const { rows } = await pool.query(
        'SELECT sales_pin_hash FROM users WHERE id = $1 LIMIT 1',
        [req.user.id]
      );
      const hash = rows[0]?.sales_pin_hash;
      if (!hash) {
        return res.status(403).json({
          message: 'Set your sales PIN before viewing agent targets.',
          code: 'SALES_PIN_NOT_SET',
        });
      }

      const ok = await bcrypt.compare(pin, hash);
      if (!ok) {
        return res.status(403).json({
          message: 'Invalid sales PIN.',
          code: 'SALES_PIN_INVALID',
        });
      }

      return next();
    } catch (err) {
      console.error('requireSalesPin error:', err);
      return res.status(500).json({ message: 'Server error verifying sales PIN.' });
    }
  };
}

module.exports = { requireSalesPin, readSalesPin };
