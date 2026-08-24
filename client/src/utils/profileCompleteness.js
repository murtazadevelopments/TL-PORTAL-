export const EMPLOYEE_PORTAL_FIELDS = [
  { key: 'reference_person_name', label: 'Reference person' },
  { key: 'emergency_contact_name', label: 'Emergency contact name' },
  { key: 'emergency_contact_number', label: 'Emergency contact number' },
  { key: 'bank_name', label: 'Bank name' },
  { key: 'account_title', label: 'Account title' },
  { key: 'iban', label: 'IBAN' },
  { key: 'account_number', label: 'Account number' },
];

export const ADMIN_ASSIGN_FIELDS = [
  { key: 'employee_id', label: 'Employee ID' },
  { key: 'status', label: 'Status' },
  { key: 'department', label: 'Department / Team' },
  { key: 'designation', label: 'Designation' },
  { key: 'branch', label: 'Branch' },
  { key: 'shift', label: 'Shift' },
  { key: 'salary', label: 'Salary' },
];

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function isSalaryMissing(value) {
  if (isBlank(value)) return true;
  const n = Number(value);
  return !Number.isFinite(n) || n <= 0;
}

export function missingEmployeePortalFields(row) {
  if (!row) return [];
  return EMPLOYEE_PORTAL_FIELDS.filter((field) => isBlank(row[field.key]));
}

export function missingAdminAssignFields(row) {
  if (!row) return [];
  return ADMIN_ASSIGN_FIELDS.filter((field) =>
    field.key === 'salary' ? isSalaryMissing(row[field.key]) : isBlank(row[field.key])
  );
}

export const PROFILE_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function lastProfileAlertAt(row) {
  return row?.profile_alert_sent_at || row?.profile_alert_at || null;
}

function formatCooldownRemaining(ms) {
  if (ms <= 0) return '';
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const minutes = Math.ceil((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (hours >= 1) {
    return minutes > 0 && hours < 24 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${Math.max(1, minutes)}m`;
}

export function profileAlertCooldown(row, now = Date.now()) {
  const sentAt = lastProfileAlertAt(row);
  if (!sentAt) {
    return { active: false, remainingMs: 0, remainingLabel: '', retryAt: null };
  }
  const sentMs = new Date(sentAt).getTime();
  if (!Number.isFinite(sentMs)) {
    return { active: false, remainingMs: 0, remainingLabel: '', retryAt: null };
  }
  const remainingMs = sentMs + PROFILE_ALERT_COOLDOWN_MS - now;
  if (remainingMs <= 0) {
    return { active: false, remainingMs: 0, remainingLabel: '', retryAt: null };
  }
  return {
    active: true,
    remainingMs,
    remainingLabel: formatCooldownRemaining(remainingMs),
    retryAt: new Date(sentMs + PROFILE_ALERT_COOLDOWN_MS),
  };
}
