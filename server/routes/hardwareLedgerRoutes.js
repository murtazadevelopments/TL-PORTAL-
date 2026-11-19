const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const {
  listVendors,
  createVendor,
  getVendor,
  createRecord,
  updateRecord,
  deleteRecord,
} = require('../controllers/hardwareLedgerController');

const router = express.Router();

router.use(authMiddleware);

router.get('/vendors', listVendors);
router.post('/vendors', createVendor);
router.get('/vendors/:vendorId', getVendor);
router.post('/vendors/:vendorId/records', createRecord);
router.put('/vendors/:vendorId/records/:recordId', updateRecord);
router.delete('/vendors/:vendorId/records/:recordId', deleteRecord);

module.exports = router;
