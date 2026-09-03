const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { requireRole, requirePermission, requireCeoOrAnyPermission } = require('../middleware/permissions');
const {
  listEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  updateLowerStaff,
  deleteLowerStaff,
  deactivateEmployee,
  restoreEmployee,
  purgeEmployee,
  listDeactivated,
  listLockedAccounts,
  unlockAccount,
  blockAccount,
  unblockAccount,
  sendProfileAlert,
} = require('../controllers/adminController');
const {
  getPermissionsCatalog,
  listEmployeesForRoleAssign,
  listRoleHolders,
  listHrPeople,
  saveHrPeople,
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
  updateBranch,
  deleteBranch,
} = require('../controllers/branchesController');
const {
  listShifts,
  createShift,
  updateShift,
  deleteShift,
} = require('../controllers/shiftsController');
const {
  adminListOnsite,
  adminGetOnsiteMonth,
  adminManualOnsite,
  adminOverrideOnsite,
  adminDeleteOnsite,
} = require('../controllers/onsiteAttendanceController');
const {
  listMessageRecipients,
  sendAdminMessage,
} = require('../controllers/messagesController');
const { uploadEmploymentForm } = require('../controllers/employmentFormController');
const { employmentFormUpload, lowerStaffUpload } = require('../middleware/uploadMiddleware');
const {
  adminOverview,
  adminManualMark,
  adminSetHours,
  adminEmployeeDays,
  adminDeleteRemoteDay,
} = require('../controllers/attendanceController');

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
  requireCeoOrAnyPermission('accounts:unlock', 'employees:deactivate'),
  listLockedAccounts
);
router.put(
  '/accounts/:userId/unlock',
  requireRole('admin'),
  requirePermission('accounts:unlock'),
  unlockAccount
);
router.put(
  '/accounts/:userId/block',
  requireRole('admin'),
  requirePermission('employees:deactivate'),
  blockAccount
);
router.put(
  '/accounts/:userId/unblock',
  requireRole('admin'),
  requirePermission('employees:deactivate'),
  unblockAccount
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
router.patch(
  '/branches/:id',
  requireRole('admin'),
  requireCeoOrAnyPermission('branches:create', 'hr:add_employee', 'attendance:edit'),
  updateBranch
);

// Shift catalog (HR / CEO)
router.get('/shifts', requireRole('admin'), listShifts);
router.post(
  '/shifts',
  requireRole('admin'),
  requirePermission('hr:add_employee'),
  createShift
);
router.put(
  '/shifts/:id',
  requireRole('admin'),
  requirePermission('hr:add_employee'),
  updateShift
);
router.delete(
  '/shifts/:id',
  requireRole('admin'),
  requirePermission('hr:add_employee'),
  deleteShift
);

// CEO role-assignment helpers (register before /employees/:id)
router.get('/employees-list', requireRole('ceo'), listEmployeesForRoleAssign);
router.get('/permissions-catalog', requireRole('ceo'), getPermissionsCatalog);
router.get('/role-holders', requireRole('ceo'), listRoleHolders);
router.get('/hr-people', requireRole('ceo'), listHrPeople);
router.put('/hr-people', requireRole('ceo'), saveHrPeople);

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
  requireCeoOrAnyPermission('employees:view', 'hr:add_employee'),
  listEmployees
);
router.post(
  '/employees',
  requireRole('admin'),
  requirePermission('hr:add_employee'),
  lowerStaffUpload,
  createEmployee
);
router.put(
  '/employees/:id/lower-staff',
  requireRole('admin'),
  requirePermission('hr:add_employee'),
  lowerStaffUpload,
  updateLowerStaff
);
router.delete(
  '/employees/:id/lower-staff',
  requireRole('admin'),
  requirePermission('hr:add_employee'),
  deleteLowerStaff
);
router.get(
  '/employees/:id',
  requireRole('admin'),
  requireCeoOrAnyPermission('employees:view', 'hr:add_employee'),
  getEmployeeById
);
router.put(
  '/employees/:id',
  requireRole('admin'),
  requireCeoOrAnyPermission('employees:edit', 'hr:add_employee'),
  updateEmployee
);

router.delete(
  '/employees/:id',
  requireRole('admin'),
  requirePermission('employees:deactivate'),
  deactivateEmployee
);

router.put(
  '/employees/:id/restore',
  requireRole('admin'),
  requirePermission('employees:deactivate'),
  restoreEmployee
);

router.post(
  '/employees/:id/profile-alert',
  requireRole('admin'),
  requireCeoOrAnyPermission('messages:send', 'employees:edit'),
  sendProfileAlert
);

router.delete('/employees/:id/purge', requireRole('ceo'), purgeEmployee);

router.get(
  '/attendance',
  requireRole('admin'),
  requireCeoOrAnyPermission(
    'attendance:view',
    'attendance:edit',
    'employees:view',
    'employees:edit'
  ),
  adminOverview
);
router.get(
  '/attendance/:userId/days',
  requireRole('admin'),
  requireCeoOrAnyPermission(
    'attendance:view',
    'attendance:edit',
    'employees:view',
    'employees:edit'
  ),
  adminEmployeeDays
);
router.put(
  '/attendance/:userId/hours',
  requireRole('admin'),
  requirePermission('attendance:edit'),
  adminSetHours
);
router.post(
  '/attendance/:userId/manual',
  requireRole('admin'),
  requirePermission('attendance:edit'),
  adminManualMark
);
router.delete(
  '/attendance/:userId/days/:dateKey',
  requireRole('ceo'),
  adminDeleteRemoteDay
);

router.get(
  '/onsite-attendance',
  requireRole('admin'),
  requireCeoOrAnyPermission(
    'attendance:view',
    'attendance:edit',
    'employees:view',
    'employees:edit',
    'hr:add_employee'
  ),
  adminListOnsite
);
router.get(
  '/onsite-attendance/:userId/month',
  requireRole('admin'),
  requireCeoOrAnyPermission(
    'attendance:view',
    'attendance:edit',
    'employees:view',
    'employees:edit',
    'hr:add_employee'
  ),
  adminGetOnsiteMonth
);
router.post(
  '/onsite-attendance',
  requireRole('admin'),
  requireCeoOrAnyPermission('attendance:edit', 'employees:edit', 'hr:add_employee'),
  adminManualOnsite
);
router.patch(
  '/onsite-attendance/:id',
  requireRole('admin'),
  requireCeoOrAnyPermission('attendance:edit', 'employees:edit', 'hr:add_employee'),
  adminOverrideOnsite
);
router.delete(
  '/onsite-attendance/:id',
  requireRole('ceo'),
  adminDeleteOnsite
);

// Admin → employee messaging
router.get(
  '/messages/recipients',
  requireRole('admin'),
  requirePermission('messages:send'),
  listMessageRecipients
);
router.post(
  '/messages',
  requireRole('admin'),
  requirePermission('messages:send'),
  sendAdminMessage
);

// Admin-only employment form (scanned pages → single PDF)
router.post(
  '/employees/:employeeId/employment-form',
  requireRole('admin'),
  requirePermission('documents:employment_form'),
  employmentFormUpload,
  uploadEmploymentForm
);

module.exports = router;
