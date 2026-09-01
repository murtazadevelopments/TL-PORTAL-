const EMPLOYEE_PORTAL_FIELDS = [
  { key: 'reference_person_name', label: 'Reference person' },
  { key: 'emergency_contact_name', label: 'Emergency contact name' },
  { key: 'emergency_contact_number', label: 'Emergency contact number' },
  { key: 'bank_name', label: 'Bank name' },
  { key: 'account_title', label: 'Account title' },
  { key: 'iban', label: 'IBAN' },
  { key: 'account_number', label: 'Account number' },
  { key: 'profile_picture_url', presenceKey: 'profile_picture_on_file', label: 'Profile photo', document: true },
  { key: 'cnic_front_url', presenceKey: 'cnic_front_on_file', label: 'CNIC front', document: true },
  { key: 'cnic_back_url', presenceKey: 'cnic_back_on_file', label: 'CNIC back', document: true },
  { key: 'cv_url', presenceKey: 'cv_on_file', label: 'CV', document: true },
];

const ADMIN_ASSIGN_FIELDS = [
  { key: 'employee_id', label: 'Employee ID' },
  { key: 'status', label: 'Status' },
  { key: 'department', label: 'Department / Team' },
  { key: 'designation', label: 'Designation' },
  { key: 'branch', label: 'Branch' },
  { key: 'shift', label: 'Shift' },
];

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function isPortalFieldMissing(row, field) {
  if (field.presenceKey != null && typeof row[field.presenceKey] === 'boolean') {
    return row[field.presenceKey] !== true;
  }
  return isBlank(row[field.key]);
}

function missingFromCatalog(row, catalog) {
  if (!row) return [];
  return catalog.filter((field) => isPortalFieldMissing(row, field));
}

function withDocumentPresence(row) {
  if (!row) return row;
  return {
    ...row,
    profile_picture_on_file: Boolean(row.profile_picture_url),
    cnic_front_on_file: Boolean(row.cnic_front_url),
    cnic_back_on_file: Boolean(row.cnic_back_url),
    cv_on_file: Boolean(row.cv_url),
  };
}

function missingEmployeePortalFields(row) {
  if (String(row?.staff_kind || '').toLowerCase() === 'lower') return [];
  return missingFromCatalog(row, EMPLOYEE_PORTAL_FIELDS);
}

function missingAdminAssignFields(row) {
  if (String(row?.staff_kind || '').toLowerCase() === 'lower') return [];
  return missingFromCatalog(row, ADMIN_ASSIGN_FIELDS);
}

function formatFieldList(fields) {
  return fields.map((f) => f.label).join(', ');
}

const PROFILE_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

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

function profileAlertCooldown(row, now = Date.now()) {
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

let profileAlertColumnsReady = false;

async function ensureProfileAlertColumns() {
  if (profileAlertColumnsReady) return;
  const pool = require('../config/db');
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_alert_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_alert_fields TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_alert_sent_at TIMESTAMPTZ;
    UPDATE users
    SET profile_alert_sent_at = profile_alert_at
    WHERE profile_alert_sent_at IS NULL
      AND profile_alert_at IS NOT NULL;
  `);
  profileAlertColumnsReady = true;
}

function parseAlertFields(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

module.exports = {
  EMPLOYEE_PORTAL_FIELDS,
  ADMIN_ASSIGN_FIELDS,
  isBlank,
  missingEmployeePortalFields,
  missingAdminAssignFields,
  withDocumentPresence,
  formatFieldList,
  ensureProfileAlertColumns,
  parseAlertFields,
  PROFILE_ALERT_COOLDOWN_MS,
  profileAlertCooldown,
};
