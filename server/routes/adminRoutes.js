const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/permissions');
const {
  listEmployees,
  getEmployeeById,
  updateEmployee,
  deactivateEmployee,
  purgeEmployee,
  listDeactivated,
} = require('../controllers/adminController');

const router = express.Router();

router.use(authMiddleware);

// Soft-deleted records review — admin (+ CEO bypass)
router.get('/deactivated', requireRole('admin'), listDeactivated);

// Employee directory / assignment — admin (+ CEO bypass); active only
router.get('/employees', requireRole('admin'), listEmployees);
router.get('/employees/:id', requireRole('admin'), getEmployeeById);
router.put('/employees/:id', requireRole('admin'), updateEmployee);

// Soft-delete — admin (+ CEO bypass)
router.delete('/employees/:id', requireRole('admin'), deactivateEmployee);

// Hard-delete — CEO only; more specific path
router.delete('/employees/:id/purge', requireRole('ceo'), purgeEmployee);

module.exports = router;
