const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { getMe, updateMe } = require('../controllers/userController');

const router = express.Router();

// Protected profile routes (extend later with team / directory modules)
router.use(authMiddleware);

router.get('/me', getMe);
router.put('/me', updateMe);

module.exports = router;
