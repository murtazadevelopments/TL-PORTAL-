const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { profilePictureUpload } = require('../middleware/uploadMiddleware');
const { getMe, updateMe, updateProfilePicture } = require('../controllers/userController');

const router = express.Router();

router.use(authMiddleware);

router.get('/me', getMe);
router.put('/me', updateMe);
router.put('/me/avatar', profilePictureUpload, updateProfilePicture);

module.exports = router;
