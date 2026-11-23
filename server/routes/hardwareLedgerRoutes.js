const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const {
  listVendors,
  createVendor,
  getVendor,
  deleteVendor,
  createRecord,
  updateRecord,
  deleteRecord,
  getVendorStatement,
  getLedgerStatement,
} = require('../controllers/hardwareLedgerController');

const router = express.Router();

router.use(authMiddleware);

router.get('/statement', getLedgerStatement);
router.get('/vendors', listVendors);
router.post('/vendors', createVendor);
router.get('/vendors/:vendorId/statement', getVendorStatement);
router.get('/vendors/:vendorId', getVendor);
router.delete('/vendors/:vendorId', deleteVendor);
router.post('/vendors/:vendorId/records', createRecord);
router.put('/vendors/:vendorId/records/:recordId', updateRecord);
router.delete('/vendors/:vendorId/records/:recordId', deleteRecord);

module.exports = router;
