const express = require('express');
const { documentAuth, streamDocument } = require('../controllers/documentsController');

const router = express.Router();

router.get('/:userId/:docType', documentAuth, streamDocument);

module.exports = router;
