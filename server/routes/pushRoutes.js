const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const {
  getPublicKey,
  getStatus,
  subscribe,
  unsubscribe,
  deleteSubscription,
  setPreferences,
} = require('../controllers/pushController');

const router = express.Router();

// Public key can be fetched after login (auth) — keep auth for consistency
router.use(authMiddleware);

router.get('/public-key', getPublicKey);
router.get('/vapid-public-key', getPublicKey); // legacy alias
router.get('/status', getStatus);
router.post('/subscribe', subscribe);
router.delete('/subscribe', unsubscribe);
router.delete('/subscription', deleteSubscription);
router.put('/preferences', setPreferences);

module.exports = router;
