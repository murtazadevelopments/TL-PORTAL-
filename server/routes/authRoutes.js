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
const {
  listCredentials,
  deleteCredential,
  hasCredential,
  registerOptions,
  registerVerify,
  loginOptions,
  loginVerify,
} = require('../controllers/webauthnController');
const { signupUpload } = require('../middleware/uploadMiddleware');

const router = express.Router();

router.post('/signup', signupUpload, signup);
router.post('/login', login);
router.post('/forgot-username', forgotUsername);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/change-password', authMiddleware, changePassword);

// WebAuthn / biometric (optional)
router.get('/webauthn/has-credential', hasCredential);
router.get('/webauthn/credentials', authMiddleware, listCredentials);
router.delete('/webauthn/credentials/:id', authMiddleware, deleteCredential);
router.post('/webauthn/register-options', authMiddleware, registerOptions);
router.post('/webauthn/register-verify', authMiddleware, registerVerify);
router.post('/webauthn/login-options', loginOptions);
router.post('/webauthn/login-verify', loginVerify);

module.exports = router;
