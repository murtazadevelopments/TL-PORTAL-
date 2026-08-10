const express = require('express');
const { signup, login } = require('../controllers/authController');
const { signupUpload } = require('../middleware/uploadMiddleware');

const router = express.Router();

// Public auth endpoints
router.post('/signup', signupUpload, signup);
router.post('/login', login);

module.exports = router;
