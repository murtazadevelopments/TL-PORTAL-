const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/permissions');
const { assignRole } = require('../controllers/rolesController');

const router = express.Router();

router.use(authMiddleware);

router.post('/assign', requireRole('ceo', 'manager'), assignRole);

module.exports = router;
