/**
 * Permission scopes the CEO can grant to admins.
 * Keys map to features that exist in the app today.
 */
const PERMISSIONS_CATALOG = [
  {
    key: 'employees:view',
    label: 'View employees',
    description: 'List and open employee profiles in the admin panel',
  },
  {
    key: 'employees:edit',
    label: 'Edit employees',
    description: 'Update username, employee ID, status, department, designation, branch, shift, salary, date of joining',
  },
  {
    key: 'employees:deactivate',
    label: 'Deactivate employees',
    description: 'Soft-delete employees (block login; keep records)',
  },
  {
    key: 'documents:view',
    label: 'View documents',
    description: 'Open CNIC images and CV downloads on employee profiles',
  },
  {
    key: 'notifications:signup_recipient',
    label: 'New signup notifications',
    description: 'Receive an email when a new employee signs up',
  },
  {
    key: 'teams:create',
    label: 'Create teams / departments',
    description: 'Add new teams or departments used in the employee Department dropdown',
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
