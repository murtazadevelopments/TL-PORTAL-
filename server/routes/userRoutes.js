const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const {
  profilePictureUpload,
  documentUpload,
} = require('../middleware/uploadMiddleware');
const {
  getMe,
  updateMe,
  updateProfilePicture,
  updateDocuments,
} = require('../controllers/userController');

const router = express.Router();

router.use(authMiddleware);

router.get('/me', getMe);
router.put('/me', updateMe);
router.put('/me/avatar', profilePictureUpload, updateProfilePicture);
router.put('/me/documents', documentUpload, updateDocuments);

module.exports = router;
