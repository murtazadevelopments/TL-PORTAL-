const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { requireRole, requirePermission } = require('../middleware/permissions');
const { requireSalesPin } = require('../middleware/salesPin');
const {
  listSalesTargets,
  setSalesPin,
  upsertSalesTarget,
  getMySalesTarget,
} = require('../controllers/salesTargetsController');

const router = express.Router();

router.use(authMiddleware);

router.get('/me', getMySalesTarget);

router.use(requireRole('admin'));
router.use(requirePermission('sales:targets'));

router.post('/pin', setSalesPin);
router.get('/', requireSalesPin(), listSalesTargets);
router.put('/agents/:userId', requireSalesPin(), upsertSalesTarget);

module.exports = router;
