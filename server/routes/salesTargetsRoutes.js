const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { requireCeoExclusive } = require('../middleware/permissions');
const { requireSalesPin } = require('../middleware/salesPin');
const {
  listSalesTargets,
  listSalesProgress,
  setSalesPin,
  requestSalesPinOtp,
  verifySalesPinOtp,
  upsertSalesTarget,
  resetSalesTarget,
  getMySalesTarget,
  getAgentDailyTargets,
  upsertAgentDailyTargets,
  getMyDailyTargets,
} = require('../controllers/salesTargetsController');

const router = express.Router();

router.use(authMiddleware);

router.get('/me', getMySalesTarget);
router.get('/me/days', getMyDailyTargets);

// Sales Targets board is CEO-only (managers inherit every other CEO capability).
router.use(requireCeoExclusive('Sales targets are available to the CEO only.'));

router.post('/pin', setSalesPin);
router.post('/pin/otp', requestSalesPinOtp);
router.post('/pin/otp/verify', verifySalesPinOtp);
router.get('/', requireSalesPin(), listSalesTargets);
router.get('/agents/:userId/days', requireSalesPin(), getAgentDailyTargets);
router.put('/agents/:userId/days', requireSalesPin(), upsertAgentDailyTargets);
router.put('/agents/:userId', requireSalesPin(), upsertSalesTarget);
router.delete('/agents/:userId', requireSalesPin(), resetSalesTarget);

module.exports = router;
