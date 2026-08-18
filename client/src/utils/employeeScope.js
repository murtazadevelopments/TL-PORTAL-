/** Shared branch labels (users.branch) — keep in sync with server employeeScope. */
export const BRANCH_OPTIONS = ['Head Office', 'Unit', 'Branch', 'Amir Chamber'];

export const DEFAULT_EMPLOYEE_SCOPE = { type: 'all' };

export function normalizeEmployeeScope(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_EMPLOYEE_SCOPE };
  const type = String(raw.type || 'all')
    .trim()
    .toLowerCase();
  if (type === 'branch' || type === 'team') {
    const values = [
      ...new Set(
        (Array.isArray(raw.values) ? raw.values : [])
          .map((v) => String(v || '').trim())
          .filter(Boolean)
      ),
    ];
    // Keep type even with no values yet — UI needs this while the user picks checkboxes
    return { type, values };
  }
  return { ...DEFAULT_EMPLOYEE_SCOPE };
}

export function describeEmployeeScope(scope) {
  const s = normalizeEmployeeScope(scope);
  if (s.type === 'all') return 'All employees';
  if (s.type === 'branch') {
    return s.values.length ? `Branch: ${s.values.join(', ')}` : 'Specific branch (pick at least one)';
  }
  if (s.type === 'team') {
    return s.values.length ? `Team: ${s.values.join(', ')}` : 'Specific team (pick at least one)';
  }
  return 'All employees';
}

export function isScopedEmployeePermission(key) {
  return key === 'employees:view' || key === 'employees:edit';
}
