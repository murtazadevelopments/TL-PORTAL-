const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const {
  listMyMessages,
  unreadCount,
  markMessageRead,
  streamMessageImage,
} = require('../controllers/messagesController');

const router = express.Router();

router.use(authMiddleware);

router.get('/unread-count', unreadCount);
router.get('/:id/image', streamMessageImage);
router.get('/', listMyMessages);
router.patch('/:id/read', markMessageRead);

module.exports = router;
