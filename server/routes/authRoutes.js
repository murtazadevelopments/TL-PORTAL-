const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const {
  signup,
  login,
  forgotUsername,
  forgotPassword,
  resetPassword,
  changePassword,
} = require('../controllers/authController');
const { signupUpload } = require('../middleware/uploadMiddleware');

const router = express.Router();

router.post('/signup', signupUpload, signup);
router.post('/login', login);
router.post('/forgot-username', forgotUsername);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/change-password', authMiddleware, changePassword);

module.exports = router;
