const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/permissions');
const { pettyCashReceiptUpload } = require('../middleware/uploadMiddleware');
const {
  getMyLedger,
  updateMyTotal,
  createMyEntry,
  updateMyEntry,
  deleteMyEntry,
  getMyReceipt,
  exportMyLedger,
  listHolders,
  getHolderLedger,
  getHolderReceipt,
  exportHolderLedger,
} = require('../controllers/pettyCashController');

const router = express.Router();

router.use(authMiddleware);

router.get('/me', getMyLedger);
router.get('/me/export', exportMyLedger);
router.put('/me/total', updateMyTotal);
router.post('/me', pettyCashReceiptUpload, createMyEntry);
router.put('/me/:id', pettyCashReceiptUpload, updateMyEntry);
router.delete('/me/:id', deleteMyEntry);
router.get('/me/:id/receipt', getMyReceipt);

router.get('/holders', requireRole('ceo', 'manager'), listHolders);
router.get('/holders/:userId/export', requireRole('ceo', 'manager'), exportHolderLedger);
router.get('/holders/:userId', requireRole('ceo', 'manager'), getHolderLedger);
router.get(
  '/holders/:userId/entries/:id/receipt',
  requireRole('ceo', 'manager'),
  getHolderReceipt
);

module.exports = router;
