const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/permissions');
const { requireTPin } = require('../middleware/tPin');
const {
  getAccess,
  listCategories,
  listAssignableUsers,
  setTPin,
  requestTPinOtp,
  verifyTPinOtp,
  createCategory,
  updateCategory,
  deleteCategory,
  createItem,
  updateItem,
  deleteItem,
  setAssignments,
  saveSection,
} = require('../controllers/tlDashboardController');

const router = express.Router();

router.use(authMiddleware);

router.get('/access', getAccess);
router.get('/', listCategories);

// CEO/manager: set / change T-Pin (password, current pin, or email OTP)
router.post('/t-pin/otp', requireRole('ceo', 'manager'), requestTPinOtp);
router.post('/t-pin/otp/verify', requireRole('ceo', 'manager'), verifyTPinOtp);
router.post('/t-pin', requireRole('ceo', 'manager'), setTPin);

router.get('/assignable-users', requireRole('ceo', 'manager'), listAssignableUsers);

// Primary write path: edit locally, then one Save + T-Pin
router.post('/save', requireRole('ceo', 'manager'), requireTPin, saveSection);

// Granular mutations still available (also T-Pin gated)
router.post('/categories', requireRole('ceo', 'manager'), requireTPin, createCategory);
router.put('/categories/:id', requireRole('ceo', 'manager'), requireTPin, updateCategory);
router.delete('/categories/:id', requireRole('ceo', 'manager'), requireTPin, deleteCategory);

router.post('/categories/:id/items', requireRole('ceo', 'manager'), requireTPin, createItem);
router.put('/items/:itemId', requireRole('ceo', 'manager'), requireTPin, updateItem);
router.delete('/items/:itemId', requireRole('ceo', 'manager'), requireTPin, deleteItem);

router.put(
  '/categories/:id/assignments',
  requireRole('ceo', 'manager'),
  requireTPin,
  setAssignments
);

module.exports = router;
