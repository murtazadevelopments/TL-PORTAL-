const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/permissions');
const { requireTPin } = require('../middleware/tPin');
const {
  getAccess,
  listCategories,
  listAssignableUsers,
  setTPin,
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

// CEO: set / change T-Pin (password or current pin — no requireTPin here)
router.post('/t-pin', requireRole('ceo'), setTPin);

router.get('/assignable-users', requireRole('ceo'), listAssignableUsers);

// Primary CEO write path: edit locally, then one Save + T-Pin
router.post('/save', requireRole('ceo'), requireTPin, saveSection);

// Granular mutations still available (also T-Pin gated)
router.post('/categories', requireRole('ceo'), requireTPin, createCategory);
router.put('/categories/:id', requireRole('ceo'), requireTPin, updateCategory);
router.delete('/categories/:id', requireRole('ceo'), requireTPin, deleteCategory);

router.post('/categories/:id/items', requireRole('ceo'), requireTPin, createItem);
router.put('/items/:itemId', requireRole('ceo'), requireTPin, updateItem);
router.delete('/items/:itemId', requireRole('ceo'), requireTPin, deleteItem);

router.put(
  '/categories/:id/assignments',
  requireRole('ceo'),
  requireTPin,
  setAssignments
);

module.exports = router;
