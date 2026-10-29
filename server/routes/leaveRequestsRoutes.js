const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const {
  createLeaveRequest,
  listMyLeaveRequests,
  listLeaveRequests,
  streamPrescription,
  approveLeaveRequest,
  rejectLeaveRequest,
} = require('../controllers/leaveRequestsController');
const { leavePrescriptionUpload } = require('../middleware/uploadMiddleware');

const router = express.Router();

router.use(authMiddleware);

router.get('/mine', listMyLeaveRequests);
router.get('/', listLeaveRequests);
router.post('/', leavePrescriptionUpload, createLeaveRequest);
router.get('/:id/prescription', streamPrescription);
router.post('/:id/approve', approveLeaveRequest);
router.post('/:id/reject', rejectLeaveRequest);

module.exports = router;
