const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const {
  getEnrollment,
  saveEnrollment,
  getMyAttendance,
  getMyHistory,
  checkIn,
} = require('../controllers/attendanceController');

const router = express.Router();

router.use(authMiddleware);

router.get('/enrollment', getEnrollment);
router.post('/enrollment', saveEnrollment);
router.get('/me', getMyAttendance);
router.get('/history', getMyHistory);
router.post('/check-in', checkIn);

module.exports = router;
