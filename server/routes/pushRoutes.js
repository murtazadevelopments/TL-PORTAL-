const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const {
  getPublicKey,
  getStatus,
  subscribe,
  unsubscribe,
  setPreferences,
} = require('../controllers/pushController');

const router = express.Router();

// Public key can be fetched after login (auth) — keep auth for consistency
router.use(authMiddleware);

router.get('/vapid-public-key', getPublicKey);
router.get('/status', getStatus);
router.post('/subscribe', subscribe);
router.delete('/subscribe', unsubscribe);
router.put('/preferences', setPreferences);

module.exports = router;
