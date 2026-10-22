const express = require('express');
const { documentAuth, streamDocument } = require('../controllers/documentsController');
const { streamFaceCheckCapture } = require('../controllers/attendanceController');

const router = express.Router();

router.get('/face-checks/:captureId', documentAuth, streamFaceCheckCapture);
router.get('/:userId/:docType', documentAuth, streamDocument);

module.exports = router;
