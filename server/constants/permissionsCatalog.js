/**
 * Permission scopes the CEO can grant to admins.
 * Keys map to features that exist in the app today.
 */
const PERMISSIONS_CATALOG = [
  {
    key: 'employees:view',
    label: 'View employees',
    description:
      'List and open employee profiles (scope: all employees, a branch, or a team)',
  },
  {
    key: 'employees:edit',
    label: 'Edit employees',
    description:
      'Update employee ID, status, department, designation, branch, shift, date of joining (scope: all, a branch, or a team). Does not include salary.',
  },
  {
    key: 'employees:salary',
    label: 'View employee salary',
    description:
      'See and update salary on employee profiles. Assign only to the person who should handle pay. Employees always see their own salary.',
  },
  {
    key: 'hr:followup',
    label: 'HR assignee',
    description:
      'Named HR person: see every incomplete employee profile and follow up until details are filled',
  },
  {
    key: 'attendance:view',
    label: 'View attendance',
    description:
      'See remote employee attendance records, hours, and daily history (scope: all, a branch, or a team)',
  },
  {
    key: 'attendance:edit',
    label: 'Edit attendance',
    description:
      'Set working hours, mark present/late/absent/leave, and override hourly check-ins (scope: all, branch, or team)',
  },
  {
    key: 'employees:deactivate',
    label: 'Deactivate employees',
    description:
      'Soft-delete employees and immediately end their session (keep records). Also block/unblock accounts so they cannot sign in.',
  },
  {
    key: 'documents:view',
    label: 'View documents',
    description: 'View/download CV and employment forms on employee profiles',
  },
  {
    key: 'documents:employment_form',
    label: 'Upload employment forms',
    description:
      'Scan and upload employment form PDFs onto employee profiles (assign only to the person who handles this)',
  },
  {
    key: 'notifications:signup_recipient',
    label: 'New signup notifications',
    description: 'Receive an email when a new employee signs up',
  },
  {
    key: 'teams:create',
    label: 'Manage teams / departments',
    description: 'Add or delete teams/departments used in the employee Department dropdown',
  },
  {
    key: 'branches:create',
    label: 'Manage branches',
    description: 'Add or delete offices/branches used in employee and admin assignment dropdowns',
  },
  {
    key: 'accounts:unlock',
    label: 'Unlock locked accounts',
    description:
      'View and unlock accounts locked after too many failed login attempts (does not override an admin block)',
  },
  {
    key: 'messages:send',
    label: 'Send messages',
    description: 'Compose portal and/or email messages to employees from the admin panel',
  },
];

const PERMISSION_KEYS = new Set(PERMISSIONS_CATALOG.map((p) => p.key));

function normalizePermissionKeys(input) {
  if (!Array.isArray(input)) return [];
  const unique = [];
  const seen = new Set();
  for (const raw of input) {
    const key = String(raw || '').trim();
    if (!key || !PERMISSION_KEYS.has(key) || seen.has(key)) continue;
    seen.add(key);
    unique.push(key);
  }
  return unique;
}

module.exports = {
  PERMISSIONS_CATALOG,
  PERMISSION_KEYS,
  normalizePermissionKeys,
};
