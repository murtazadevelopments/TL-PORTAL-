const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/permissions');
const { assignRole } = require('../controllers/rolesController');

const router = express.Router();

router.use(authMiddleware);

// CEO only (CEO also bypasses inside requireRole for any future roles routes)
router.post('/assign', requireRole('ceo'), assignRole);

module.exports = router;
