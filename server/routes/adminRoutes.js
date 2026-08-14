const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { requireRole, requirePermission } = require('../middleware/permissions');
const {
  listEmployees,
  getEmployeeById,
  updateEmployee,
  deactivateEmployee,
  purgeEmployee,
  listDeactivated,
} = require('../controllers/adminController');
const {
  getPermissionsCatalog,
  listEmployeesForRoleAssign,
  listRoleHolders,
} = require('../controllers/rolesController');

const router = express.Router();

router.use(authMiddleware);

// Soft-deleted records review
router.get(
  '/deactivated',
  requireRole('admin'),
  requirePermission('employees:deactivate'),
  listDeactivated
);

// CEO role-assignment helpers (register before /employees/:id)
router.get('/employees-list', requireRole('ceo'), listEmployeesForRoleAssign);
router.get('/permissions-catalog', requireRole('ceo'), getPermissionsCatalog);
router.get('/role-holders', requireRole('ceo'), listRoleHolders);

// Employee directory — scoped by admin_permissions
router.get(
  '/employees',
  requireRole('admin'),
  requirePermission('employees:view'),
  listEmployees
);
router.get(
  '/employees/:id',
  requireRole('admin'),
  requirePermission('employees:view'),
  getEmployeeById
);
router.put(
  '/employees/:id',
  requireRole('admin'),
  requirePermission('employees:edit'),
  updateEmployee
);

router.delete(
  '/employees/:id',
  requireRole('admin'),
  requirePermission('employees:deactivate'),
  deactivateEmployee
);

router.delete('/employees/:id/purge', requireRole('ceo'), purgeEmployee);

module.exports = router;
