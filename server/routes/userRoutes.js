const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
// express.json used on CV JSON route (higher limit than global 2mb)
const {
  profilePictureUpload,
  documentUpload,
} = require('../middleware/uploadMiddleware');
const {
  getMe,
  updateMe,
  updateProfilePicture,
  updateDocuments,
  updateCvBase64,
  ackExamCongrats,
  ackPhotoAlertSeen,
} = require('../controllers/userController');

const router = express.Router();

router.use(authMiddleware);

router.get('/me', getMe);
router.put('/me', updateMe);
router.post('/me/exam-congrats/ack', ackExamCongrats);
router.post('/me/photo-alert/seen', ackPhotoAlertSeen);
router.put('/me/avatar', profilePictureUpload, updateProfilePicture);
router.put('/me/documents', documentUpload, updateDocuments);
router.post('/me/documents', documentUpload, updateDocuments);
// JSON CV upload — Hostinger/WAF often returns bare 403 on multipart PDF PUT.
router.post('/me/documents/cv', express.json({ limit: '12mb' }), updateCvBase64);

module.exports = router;
