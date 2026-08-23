const jwt = require('jsonwebtoken');
const { rejectIfAccountDisabled } = require('../utils/accountStatus');

/**
 * Protects routes by verifying Authorization: Bearer <token>.
 * Re-checks live account status so deactivate/block takes effect immediately.
 * Attaches decoded payload to req.user → { id, email, role }.
 */
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  const token = authHeader.slice(7);

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }

  try {
    const denied = await rejectIfAccountDisabled(req.user.id, res);
    if (denied) return;
    return next();
  } catch (err) {
    console.error('authMiddleware account gate:', err);
    return res.status(500).json({ message: 'Server error verifying account.' });
  }
}

module.exports = authMiddleware;
