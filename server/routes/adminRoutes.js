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
  listLockedAccounts,
  unlockAccount,
} = require('../controllers/adminController');
const {
  getPermissionsCatalog,
  listEmployeesForRoleAssign,
  listRoleHolders,
} = require('../controllers/rolesController');
const {
  getNotificationSettings,
  updateNotificationSettings,
} = require('../controllers/notificationSettingsController');
const { listLoginLogs } = require('../controllers/loginLogsController');
const { listTeams, createTeam, deleteTeam } = require('../controllers/teamsController');
const {
  listBranches,
  createBranch,
  deleteBranch,
} = require('../controllers/branchesController');

const router = express.Router();

router.use(authMiddleware);

// Soft-deleted records review
router.get(
  '/deactivated',
  requireRole('admin'),
  requirePermission('employees:deactivate'),
  listDeactivated
);

// Locked accounts (failed login lockout)
router.get(
  '/locked-accounts',
  requireRole('admin'),
  requirePermission('accounts:unlock'),
  listLockedAccounts
);
router.put(
  '/accounts/:userId/unlock',
  requireRole('admin'),
  requirePermission('accounts:unlock'),
  unlockAccount
);

// Teams / departments catalog
router.get('/teams', requireRole('admin'), listTeams);
router.post(
  '/teams',
  requireRole('admin'),
  requirePermission('teams:create'),
  createTeam
);
router.delete(
  '/teams/:id',
  requireRole('admin'),
  requirePermission('teams:create'),
  deleteTeam
);

// Branches catalog
router.get('/branches', requireRole('admin'), listBranches);
router.post(
  '/branches',
  requireRole('admin'),
  requirePermission('branches:create'),
  createBranch
);
router.delete(
  '/branches/:id',
  requireRole('admin'),
  requirePermission('branches:create'),
  deleteBranch
);

// CEO role-assignment helpers (register before /employees/:id)
router.get('/employees-list', requireRole('ceo'), listEmployeesForRoleAssign);
router.get('/permissions-catalog', requireRole('ceo'), getPermissionsCatalog);
router.get('/role-holders', requireRole('ceo'), listRoleHolders);

// CEO login activity
router.get('/login-logs', requireRole('ceo'), listLoginLogs);

// Optional API for notification_settings (UI removed — recipients come from permission)
router.get(
  '/notification-settings',
  requireRole('admin'),
  requirePermission('notifications:signup_recipient'),
  getNotificationSettings
);
router.put(
  '/notification-settings',
  requireRole('admin'),
  requirePermission('notifications:signup_recipient'),
  updateNotificationSettings
);

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
