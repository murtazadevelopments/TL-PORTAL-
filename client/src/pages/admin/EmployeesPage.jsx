import { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router';
import api from '../../api/client';
import { canAccessAdmin, hasPermission } from '../../utils/permissions';
import { BRANCH_OPTIONS } from '../../utils/employeeScope';
import { withAuthDocumentUrl } from '../../utils/documentUrls';
import ComposeMessageModal from '../../components/ComposeMessageModal';
import UploadEmploymentFormModal from '../../components/UploadEmploymentFormModal';
import EmploymentFormViewer from '../../components/EmploymentFormViewer';
import CnicProtectedViewer from '../../components/CnicProtectedViewer';
import PhotoLightbox from '../../components/PhotoLightbox';
import {
  missingEmployeePortalFields,
  missingEmployeePortalFieldsUnion,
  profileAlertCooldown,
  photoAlertCooldown,
  profileAlertAction,
  isProfileIncompleteLocked,
  profileAlertCount,
  PROFILE_ALERT_MAX,
  PHOTO_ALERT_SUBJECT,
  PHOTO_ALERT_BODY,
} from '../../utils/profileCompleteness';
import { ADMIN_INCOMPLETE_EVENT } from '../../components/AdminIncompleteGate';
import ClockHourSelect from '../../components/ClockHourSelect';
import DesignationField from '../../components/DesignationField';
import PasswordInput from '../../components/PasswordInput';
import { hoursRangeLabel } from '../../utils/clockHours';
import LowerStaffPayroll from './LowerStaffPayroll';
import './AdminDashboard.css';

const FALLBACK_SHIFT_OPTIONS = ['Evening', 'Night'];

const LAST_JOB_OPTIONS = [
  { value: 'still_employed', label: 'Still employed elsewhere' },
  { value: 'resigned', label: 'Resigned' },
  { value: 'terminated', label: 'Terminated' },
  { value: 'fresh_graduate', label: 'Fresh graduate' },
  { value: 'other', label: 'Other' },
];

const ADMIN_FIELD_LABELS = {
  employee_id: 'Employee ID',
  status: 'Status',
  department: 'Department / Team',
  designation: 'Designation',
  branch: 'Branch',
  shift: 'Shift',
  date_of_joining: 'Date of joining',
};

const EMPTY_EDIT = {
  employee_id: '',
  status: 'inactive',
  department: '',
  designation: '',
  branch: '',
  shift: '',
  date_of_joining: '',
  employment_type: 'onsite',
  work_start_hour: 9,
  work_end_hour: 18,
};

const EMPTY_ADD = {
  username: '',
  name: '',
  email: '',
  password: '',
  contact_number: '',
  address: '',
  employee_id: '',
  status: 'inactive',
  department: '',
  designation: '',
  branch: '',
  shift: '',
  date_of_joining: '',
  employment_type: 'onsite',
  education: '',
  last_job_status: '',
  bank_name: '',
  account_title: '',
  account_number: '',
  iban: '',
};

const EMPTY_FILTERS = {
  status: 'all',
  department: 'all',
  branch: 'all',
  shift: 'all',
};

const EMPTY_LOWER = {
  name: '',
  salary: '',
  branch: '',
  extra1Kind: 'text',
  extra1Label: '',
  extra1Text: '',
  extra2Kind: 'text',
  extra2Label: '',
  extra2Text: '',
};

function lowerFormFromRow(row) {
  return {
    name: row?.name || '',
    salary: row?.salary == null ? '' : String(row.salary),
    branch: row?.branch || '',
    extra1Kind: row?.staff_extra_1_kind === 'file' ? 'file' : 'text',
    extra1Label: row?.staff_extra_1_label || '',
    extra1Text: row?.staff_extra_1_text || '',
    extra2Kind: row?.staff_extra_2_kind === 'file' ? 'file' : 'text',
    extra2Label: row?.staff_extra_2_label || '',
    extra2Text: row?.staff_extra_2_text || '',
  };
}

function parseEmployeeStatusTab(value) {
  const s = String(value || '');
  if (s === 'pending' || s === 'active' || s === 'locked' || s === 'resigned' || s === 'terminated') return s;
  if (s === 'complete' || s === 'incomplete') return s;
  if (s === 'lower-staff' || s === 'subordinate-staff') return 'subordinate-staff';
  return 'all';
}

function extraSlotSummary(row, slot) {
  const kind = row?.[`staff_extra_${slot}_kind`];
  const label = String(row?.[`staff_extra_${slot}_label`] || '').trim();
  const text = String(row?.[`staff_extra_${slot}_text`] || '').trim();
  const url = row?.[`staff_extra_${slot}_url`];
  if (kind === 'file' && (url || label)) return label || 'Document on file';
  if (kind === 'text' && (label || text)) return label || 'Note';
  return null;
}

function useObjectUrl(file) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return undefined;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

function LowerFilePick({
  label,
  hint,
  accept,
  file,
  existingUrl,
  cacheKey,
  imagePreview,
  allowCapture = false,
  onFile,
  onViewCurrent,
}) {
  const uploadId = useId();
  const captureId = useId();
  const [dragOver, setDragOver] = useState(false);
  const objectUrl = useObjectUrl(file);
  const existingHref = onViewCurrent ? null : withAuthDocumentUrl(existingUrl, cacheKey);
  const showImage =
    Boolean(imagePreview) &&
    file &&
    file.type.startsWith('image/') &&
    objectUrl;
  const previewSrc = objectUrl;

  function takeFile(next) {
    if (next) onFile(next);
  }

  function onPick(e) {
    takeFile(e.target.files?.[0]);
    e.target.value = '';
  }

  return (
    <div className="lower-file-field">
      <span className="lower-field-label">{label}</span>
      <div
        className={`lower-file-drop ${dragOver ? 'is-drag' : ''} ${
          file || existingUrl ? 'is-filled' : ''
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          takeFile(e.dataTransfer.files?.[0]);
        }}
      >
        {showImage && previewSrc ? (
          <img className="lower-file-preview" src={previewSrc} alt="" />
        ) : (
          <div className="lower-file-icon" aria-hidden="true">
            ↑
          </div>
        )}
        {allowCapture && (
          <input
            id={captureId}
            className="lower-file-input"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPick}
          />
        )}
        <input
          id={uploadId}
          className="lower-file-input"
          type="file"
          accept={accept}
          onChange={onPick}
        />
        <div className="lower-file-actions">
          {allowCapture && (
            <label htmlFor={captureId} className="lower-file-cta lower-file-cta-capture">
              Capture
            </label>
          )}
          <label htmlFor={uploadId} className="lower-file-cta">
            {file || existingUrl ? 'Replace' : 'Upload'}
          </label>
        </div>
        <p className="lower-file-hint">
          {file
            ? file.name
            : existingUrl
              ? 'On file — capture or upload to replace'
              : hint}
        </p>
        <div className="lower-file-links">
          {onViewCurrent && existingUrl && !file && (
            <button type="button" onClick={onViewCurrent}>
              View
            </button>
          )}
          {existingHref && !file && (
            <a href={existingHref} target="_blank" rel="noreferrer">
              Open current
            </a>
          )}
          {file && (
            <button type="button" onClick={() => onFile(null)}>
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function fullName(row) {
  return row?.name || '—';
}

function statusClass(status) {
  if (status === 'active') return 'active';
  if (status === 'inactive') return 'inactive';
  if (status === 'resigned') return 'resigned';
  if (status === 'terminated') return 'terminated';
  return 'unset';
}

function isAccountLocked(row) {
  return Boolean(row?.locked_at);
}

function isAccountBlocked(row) {
  return Boolean(row?.blocked_at);
}

function isResignedAccount(row) {
  if (!row) return false;
  if (row.resigned_at) return true;
  if (String(row.status || '').trim().toLowerCase() === 'resigned') return true;
  return String(row.blocked_reason || '').trim().toLowerCase() === 'resigned';
}

function isTerminatedAccount(row) {
  if (!row) return false;
  if (row.terminated_at) return true;
  if (String(row.status || '').trim().toLowerCase() === 'terminated') return true;
  return String(row.blocked_reason || '').trim().toLowerCase() === 'terminated';
}

function isClosedAccount(row) {
  return isResignedAccount(row) || isTerminatedAccount(row);
}

function isSignInDisabled(row) {
  return isAccountLocked(row) || isAccountBlocked(row) || isClosedAccount(row);
}

function officeDateValue(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return '';
}

function formatOfficeDate(value) {
  const iso = officeDateValue(value);
  if (!iso) return '';
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString();
}

function todayISODate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const MONTH_OPTIONS = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

function splitOfficeDate(value) {
  const iso = officeDateValue(value) || todayISODate();
  return {
    year: iso.slice(0, 4),
    month: iso.slice(5, 7),
    day: iso.slice(8, 10),
  };
}

function daysInMonth(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return 31;
  return new Date(y, m, 0).getDate();
}

function joinOfficeDate(year, month, day) {
  const maxDay = daysInMonth(year, month);
  const nextDay = String(Math.min(Number(day) || 1, maxDay)).padStart(2, '0');
  return `${year}-${month}-${nextDay}`;
}

function OfficeDateSelect({ id, label, value, onChange, disabled = false }) {
  const parts = splitOfficeDate(value);
  const maxDay = daysInMonth(parts.year, parts.month);
  const thisYear = new Date().getFullYear();
  const years = [];
  for (let year = thisYear + 1; year >= thisYear - 8; year -= 1) years.push(String(year));
  if (!years.includes(parts.year)) years.unshift(parts.year);

  function update(next) {
    onChange(joinOfficeDate(next.year, next.month, next.day));
  }

  return (
    <div className="office-date-field">
      <span className="office-date-label" id={id}>
        {label}
      </span>
      <div className="office-date-row" role="group" aria-labelledby={id}>
        <label className="office-date-part">
          <span>Day</span>
          <select
            value={parts.day}
            disabled={disabled}
            onChange={(e) => update({ ...parts, day: e.target.value.padStart(2, '0') })}
          >
            {Array.from({ length: maxDay }, (_, i) => String(i + 1).padStart(2, '0')).map((day) => (
              <option key={day} value={day}>
                {Number(day)}
              </option>
            ))}
          </select>
        </label>
        <label className="office-date-part office-date-month">
          <span>Month</span>
          <select
            value={parts.month}
            disabled={disabled}
            onChange={(e) => update({ ...parts, month: e.target.value })}
          >
            {MONTH_OPTIONS.map((month) => (
              <option key={month.value} value={month.value}>
                {month.label}
              </option>
            ))}
          </select>
        </label>
        <label className="office-date-part">
          <span>Year</span>
          <select
            value={parts.year}
            disabled={disabled}
            onChange={(e) => update({ ...parts, year: e.target.value })}
          >
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

const EMPTY_EXIT = { row: null, kind: 'resign', lastDay: '', remarks: '', saving: false, error: '' };

function employmentStatusLabel(status) {
  if (status === 'active') return 'active';
  if (status === 'inactive') return 'pending';
  if (status === 'resigned') return 'resigned';
  if (status === 'terminated') return 'terminated';
  return status || 'unset';
}

function isApprovedEmployee(row) {
  return String(row?.status || '').trim().toLowerCase() === 'active';
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function isLowerStaffRow(row) {
  return String(row?.staff_kind || '').toLowerCase() === 'lower';
}

function formatSalaryAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString();
}

function lastJobLabel(value) {
  const found = LAST_JOB_OPTIONS.find((opt) => opt.value === value);
  return found?.label || value || '—';
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function yesNo(value) {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return '—';
}

function DetailFact({ label, children }) {
  const empty =
    children === null ||
    children === undefined ||
    children === '' ||
    children === '—';
  return (
    <p>
      <span className="label">{label}</span>
      <strong>{empty ? '—' : children}</strong>
    </p>
  );
}

function missingAdminFields(row) {
  if (!row || isLowerStaffRow(row)) return [];
  return Object.keys(ADMIN_FIELD_LABELS)
    .filter((key) => key !== 'date_of_joining')
    .filter((key) => isBlank(row[key]));
}

function isIncompleteProfile(row) {
  if (!row || isLowerStaffRow(row) || !isApprovedEmployee(row) || isAccountBlocked(row)) {
    return false;
  }
  return missingAdminFields(row).length > 0 || missingEmployeePortalFields(row).length > 0;
}

function uniqueOptionNames(list, nameKey = 'name') {
  const seen = new Map();
  for (const item of list || []) {
    const name = String(typeof item === 'string' ? item : item?.[nameKey] || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()];
}

function transferKindLabel(kind) {
  if (kind === 'team') return 'Team';
  if (kind === 'shift') return 'Shift';
  if (kind === 'branch') return 'Branch';
  return kind || '';
}

function currentTransferValue(row, kind) {
  if (!row) return '';
  if (kind === 'team') return String(row.department || '').trim();
  if (kind === 'shift') return String(row.shift || '').trim();
  if (kind === 'branch') return String(row.branch || '').trim();
  return '';
}

const EMPTY_TRANSFER = {
  row: null,
  step: 'kind',
  kind: '',
  value: '',
  history: [],
  loading: false,
  saving: false,
  error: '',
};

function isCompleteProfile(row) {
  if (!row || isLowerStaffRow(row) || !isApprovedEmployee(row) || isAccountBlocked(row)) {
    return false;
  }
  return missingAdminFields(row).length === 0 && missingEmployeePortalFields(row).length === 0;
}

function TransferHistoryList({ userId, refreshKey = 0 }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!userId) return undefined;
    let live = true;
    setLoading(true);
    api
      .get(`/api/admin/employees/${userId}/transfers`)
      .then(({ data }) => {
        if (live) setRows(Array.isArray(data?.transfers) ? data.transfers : []);
      })
      .catch(() => {
        if (live) setRows([]);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [userId, refreshKey]);

  if (loading) return <p className="muted">Loading transfer record…</p>;
  if (!rows.length) return <p className="muted">No team, shift, or branch transfers yet.</p>;
  return (
    <ol className="transfer-history">
      {rows.map((item) => (
        <li key={item.id}>
          <strong>{transferKindLabel(item.kind)}</strong>
          <span>
            {item.from_value || 'unset'} → {item.to_value}
          </span>
          <span className="muted">
            {item.created_at ? new Date(item.created_at).toLocaleString() : ''}
            {item.actor_username ? ` · ${item.actor_username}` : ''}
          </span>
        </li>
      ))}
    </ol>
  );
}

function EmployeesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [role, setRole] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [currentUserLabel, setCurrentUserLabel] = useState('');
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [statusTab, setStatusTab] = useState(() => {
    return parseEmployeeStatusTab(searchParams.get('status'));
  });

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editForm, setEditForm] = useState(EMPTY_EDIT);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');

  const [teams, setTeams] = useState([]);
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [teamError, setTeamError] = useState('');

  const [branches, setBranches] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [showAddBranch, setShowAddBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [branchError, setBranchError] = useState('');

  const [unlockingId, setUnlockingId] = useState(null);
  const [blockingId, setBlockingId] = useState(null);
  const [alertingId, setAlertingId] = useState(null);
  const [bulkAlerting, setBulkAlerting] = useState(false);
  const [listNotice, setListNotice] = useState('');
  const [transfer, setTransfer] = useState(EMPTY_TRANSFER);
  const [transferTick, setTransferTick] = useState(0);
  const [exitModal, setExitModal] = useState(EMPTY_EXIT);
  const [photoAlertingId, setPhotoAlertingId] = useState(null);
  const [photoConfirm, setPhotoConfirm] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeRecipient, setComposeRecipient] = useState(null);
  const [composeToast, setComposeToast] = useState('');
  const [employmentFormOpen, setEmploymentFormOpen] = useState(false);
  const [employmentFormViewOpen, setEmploymentFormViewOpen] = useState(false);
  const [cnicView, setCnicView] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_ADD);
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);
  const [lowerForm, setLowerForm] = useState(EMPTY_LOWER);
  const [lowerFormKey, setLowerFormKey] = useState(0);
  const [lowerCnicFront, setLowerCnicFront] = useState(null);
  const [lowerCnicBack, setLowerCnicBack] = useState(null);
  const [lowerExtra1File, setLowerExtra1File] = useState(null);
  const [lowerExtra2File, setLowerExtra2File] = useState(null);
  const [lowerExisting, setLowerExisting] = useState(null);
  const [lowerError, setLowerError] = useState('');
  const [addingLower, setAddingLower] = useState(false);
  const [editingLowerId, setEditingLowerId] = useState(null);
  const [deletingLowerId, setDeletingLowerId] = useState(null);

  useEffect(() => {
    setStatusTab(parseEmployeeStatusTab(searchParams.get('status')));
  }, [searchParams]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let active = true;

    async function verifyAdmin() {
      try {
        const { data } = await api.get('/api/users/me');
        if (!active) return;
        if (!canAccessAdmin(data.role)) {
          navigate('/dashboard', { replace: true });
          return;
        }
        setRole(data.role);
        setPermissions(Array.isArray(data.permissions) ? data.permissions : []);
        setCurrentUserId(data.id ?? null);
        setCurrentUserLabel(data.name || data.username || 'admin');
        // Load list in the same flow so CEO/admin never sit on an empty table
        setLoading(true);
        setListError('');
        const canView =
          hasPermission(data.permissions, 'employees:view', data.role) ||
          hasPermission(data.permissions, 'hr:add_employee', data.role) ||
          hasPermission(data.permissions, 'employees:remote', data.role);
        if (!canView) {
          setEmployees([]);
          setListError(
            'You do not have permission to view employees. Ask the CEO to grant View employees, Remote employees, or Add employees (HR).'
          );
          setLoading(false);
        } else {
        try {
          const { data: employeesData } = await api.get('/api/admin/employees');
          if (!active) return;
          setEmployees(Array.isArray(employeesData) ? employeesData : []);
        } catch (err) {
          if (!active) return;
          if (err.response?.status === 403) {
            setListError(
              err.response?.data?.message ||
                'You do not have permission to view the employee list.'
            );
            return;
          }
          if (err.response?.status === 401) {
            localStorage.removeItem('token');
            navigate('/', { replace: true });
            return;
          }
          setListError(err.response?.data?.message || 'Failed to load employees.');
        } finally {
          if (active) setLoading(false);
        }
        }
      } catch (err) {
        if (!active) return;
        localStorage.removeItem('token');
        navigate('/', { replace: true });
      } finally {
        if (active) setCheckingAuth(false);
      }
    }

    verifyAdmin();
    return () => {
      active = false;
    };
  }, [navigate]);

  async function loadEmployees() {
    setLoading(true);
    setListError('');
    try {
      const { data } = await api.get('/api/admin/employees');
      setEmployees(Array.isArray(data) ? data : []);
    } catch (err) {
      if (err.response?.status === 403) {
        setListError(
          err.response?.data?.message ||
            'You do not have permission to view employees.'
        );
        return;
      }
      if (err.response?.status === 401) {
        localStorage.removeItem('token');
        navigate('/', { replace: true });
        return;
      }
      setListError(err.response?.data?.message || 'Failed to load employees.');
    } finally {
      setLoading(false);
    }
  }

  const canAddEmployees = hasPermission(permissions, 'hr:add_employee', role);
  const canRemoteEmployees = hasPermission(permissions, 'employees:remote', role);
  const canEditOnsiteEmployees =
    hasPermission(permissions, 'employees:edit', role) || canAddEmployees;
  const canEditEmployees = canEditOnsiteEmployees || canRemoteEmployees;
  function canEditEmploymentType(type) {
    return String(type || '').trim().toLowerCase() === 'remote'
      ? canRemoteEmployees
      : canEditOnsiteEmployees;
  }
  const canDeactivateEmployees = hasPermission(
    permissions,
    'employees:deactivate',
    role
  );
  const canViewDocuments = hasPermission(permissions, 'documents:view', role);
  const canUploadEmploymentForm = hasPermission(
    permissions,
    'documents:employment_form',
    role
  );
  const canCreateTeams = hasPermission(permissions, 'teams:create', role);
  const canCreateBranches = hasPermission(permissions, 'branches:create', role);
  const canUnlockAccounts = hasPermission(permissions, 'accounts:unlock', role);
  const canSendMessages = hasPermission(permissions, 'messages:send', role);
  const canSendProfileAlert = canSendMessages || canEditEmployees;

  async function loadTeams() {
    try {
      const { data } = await api.get('/api/admin/teams');
      setTeams(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('Failed to load teams:', err.response?.data?.message || err.message);
    }
  }

  async function loadBranches() {
    try {
      const { data } = await api.get('/api/admin/branches');
      setBranches(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('Failed to load branches:', err.response?.data?.message || err.message);
    }
  }

  async function loadShifts() {
    try {
      const { data } = await api.get('/api/admin/shifts');
      setShifts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('Failed to load shifts:', err.response?.data?.message || err.message);
    }
  }

  async function loadDesignations() {
    try {
      const { data } = await api.get('/api/admin/designations');
      setDesignations(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('Failed to load designations:', err.response?.data?.message || err.message);
    }
  }

  useEffect(() => {
    if (!role) return;
    if (
      canAccessAdmin(role) ||
      hasPermission(permissions, 'employees:view', role) ||
      hasPermission(permissions, 'hr:add_employee', role) ||
      hasPermission(permissions, 'employees:remote', role)
    ) {
      loadTeams();
      loadBranches();
      loadShifts();
      loadDesignations();
    }
  }, [role, permissions]);

  async function handleUnlockAccount(userId) {
    if (!canUnlockAccounts || !userId) return;
    setUnlockingId(userId);
    setSaveError('');
    try {
      await api.put(`/api/admin/accounts/${userId}/unlock`);
      setEmployees((prev) =>
        prev.map((row) =>
          String(row.id) === String(userId)
            ? { ...row, locked_at: null, failed_login_attempts: 0 }
            : row
        )
      );
      setDetail((prev) =>
        prev && String(prev.id) === String(userId)
          ? { ...prev, locked_at: null, failed_login_attempts: 0 }
          : prev
      );
      setSaveSuccess('Account unblocked. They can sign in again.');
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to unblock account.';
      setSaveError(msg);
    } finally {
      setUnlockingId(null);
    }
  }

  async function handleSendProfileAlert(userId, event) {
    event?.stopPropagation?.();
    if (!canSendProfileAlert || !userId) return;
    const target = employees.find((e) => String(e.id) === String(userId)) || detail;
    if (!isApprovedEmployee(target)) {
      setSaveError('Approve this account before sending a profile alert. Pending people cannot sign in yet.');
      return;
    }
    const missing = missingEmployeePortalFieldsUnion(
      target,
      detail && String(detail.id) === String(userId) ? detail : null
    );
    if (!missing.length) {
      setSaveError('This employee has already filled their portal fields.');
      return;
    }
    const action = profileAlertAction(target);
    if (action.locked) {
      setSaveError(
        `This employee already had ${PROFILE_ALERT_MAX} profile alerts. Their portal is limited to incomplete employee fields until they finish.`
      );
      return;
    }
    const cooldown = profileAlertCooldown(target);
    if (cooldown.active) {
      setSaveError(`Alert already sent. You can send another after ${cooldown.remainingLabel}.`);
      return;
    }
    setAlertingId(userId);
    setSaveError('');
    setSaveSuccess('');
    try {
      const { data } = await api.post(`/api/admin/employees/${userId}/profile-alert`);
      const sentAt = data?.profileAlertSentAt || new Date().toISOString();
      applyAccountPatch(userId, {
        profile_alert_at: sentAt,
        profile_alert_sent_at: sentAt,
        profile_alert_count: data?.profileAlertCount,
        profile_incomplete_locked_at: data?.profileIncompleteLockedAt || null,
      });
      setNowMs(Date.now());
      setSaveSuccess(
        data?.message ||
          'Alert sent. Next alert is available after 24 hours.'
      );
    } catch (err) {
      setSaveError(err.response?.data?.message || 'Failed to send profile alert.');
    } finally {
      setAlertingId(null);
    }
  }

  async function handleBulkProfileAlert() {
    if (!canSendProfileAlert || bulkAlerting) return;
    const eligible = portalEmployees.filter((row) => {
      if (!isApprovedEmployee(row) || isAccountBlocked(row)) return false;
      if (!missingEmployeePortalFields(row).length) return false;
      return !profileAlertAction(row, nowMs).disabled;
    });
    if (!eligible.length) {
      setSaveError('No incomplete profiles are ready for an alert. Pending, recently alerted, or locked people are skipped.');
      return;
    }
    const ok = window.confirm(
      `Send a profile alert to ${eligible.length} employee${eligible.length === 1 ? '' : 's'} with incomplete portal fields? This is one click for everyone who can still receive an alert.`
    );
    if (!ok) return;
    setBulkAlerting(true);
    setSaveError('');
    setListNotice('');
    try {
      const { data } = await api.post('/api/admin/employees/profile-alert-bulk');
      const sentAt = data?.updates?.[0]?.profileAlertSentAt || new Date().toISOString();
      const byId = new Map((data?.updates || []).map((row) => [String(row.id), row]));
      setEmployees((prev) =>
        prev.map((row) => {
          const patch = byId.get(String(row.id));
          if (!patch) return row;
          return {
            ...row,
            profile_alert_at: patch.profileAlertSentAt || sentAt,
            profile_alert_sent_at: patch.profileAlertSentAt || sentAt,
            profile_alert_count: patch.profileAlertCount,
            profile_incomplete_locked_at: patch.profileIncompleteLockedAt || null,
          };
        })
      );
      setNowMs(Date.now());
      setListNotice(data?.message || `Alert sent to ${data?.sentCount || eligible.length} incomplete profiles.`);
    } catch (err) {
      setSaveError(err.response?.data?.message || 'Failed to send profile alerts.');
    } finally {
      setBulkAlerting(false);
    }
  }

  async function openTransfer(row, event) {
    event?.stopPropagation?.();
    if (!row?.id || isLowerStaffRow(row) || !canEditEmploymentType(row.employment_type)) return;
    setTransfer({
      ...EMPTY_TRANSFER,
      row,
      loading: true,
    });
    try {
      const { data } = await api.get(`/api/admin/employees/${row.id}/transfers`);
      setTransfer((prev) =>
        prev.row?.id === row.id
          ? { ...prev, history: data?.transfers || [], loading: false }
          : prev
      );
    } catch {
      setTransfer((prev) =>
        prev.row?.id === row.id ? { ...prev, history: [], loading: false } : prev
      );
    }
  }

  function closeTransfer() {
    setTransfer(EMPTY_TRANSFER);
  }

  function transferOptionsForKind(kind) {
    const current = currentTransferValue(transfer.row, kind).toLowerCase();
    const names =
      kind === 'team'
        ? uniqueOptionNames(teams)
        : kind === 'shift'
          ? uniqueOptionNames(shifts)
          : uniqueOptionNames(branches);
    return names.filter((name) => name.toLowerCase() !== current);
  }

  async function submitTransfer() {
    const row = transfer.row;
    const kind = transfer.kind;
    const value = String(transfer.value || '').trim();
    if (!row?.id || !kind || !value || transfer.saving) return;
    setTransfer((prev) => ({ ...prev, saving: true, error: '' }));
    try {
      const { data } = await api.post(`/api/admin/employees/${row.id}/transfer`, { kind, value });
      const patch = data?.employee || {};
      setEmployees((prev) =>
        prev.map((item) => (item.id === row.id ? { ...item, ...patch } : item))
      );
      setDetail((prev) => (prev && prev.id === row.id ? { ...prev, ...patch } : prev));
      setEditForm((prev) =>
        prev && detail && detail.id === row.id
          ? {
              ...prev,
              department: patch.department ?? prev.department,
              shift: patch.shift ?? prev.shift,
              branch: patch.branch ?? prev.branch,
            }
          : prev
      );
      setListNotice(data?.message || `${transferKindLabel(kind)} updated.`);
      setTransferTick((n) => n + 1);
      closeTransfer();
    } catch (err) {
      setTransfer((prev) => ({
        ...prev,
        saving: false,
        error: err.response?.data?.message || 'Could not transfer this employee.',
      }));
    }
  }

  function openPhotoAlertConfirm(row, event) {
    event?.stopPropagation?.();
    if (!canSendProfileAlert || !row?.id || isLowerStaffRow(row)) return;
    const cooldown = photoAlertCooldown(row);
    if (cooldown.active) {
      setSaveError(`Photo alert already sent. You can send another after ${cooldown.remainingLabel}.`);
      return;
    }
    setSaveError('');
    setPhotoConfirm(row);
  }

  async function confirmSendPhotoAlert() {
    const target = photoConfirm;
    if (!target?.id) return;
    setPhotoAlertingId(target.id);
    setSaveError('');
    setSaveSuccess('');
    try {
      const { data } = await api.post(`/api/admin/employees/${target.id}/photo-alert`);
      const sentAt = data?.photoAlertSentAt || new Date().toISOString();
      applyAccountPatch(target.id, {
        photo_alert_sent_at: sentAt,
        photo_alert_seen_count: 0,
        photo_alert_pending: true,
      });
      setNowMs(Date.now());
      setPhotoConfirm(null);
      setSaveSuccess(data?.message || 'Photo alert sent.');
    } catch (err) {
      setSaveError(err.response?.data?.message || 'Failed to send photo alert.');
    } finally {
      setPhotoAlertingId(null);
    }
  }

  async function applyAccountPatch(userId, patch) {
    setEmployees((prev) =>
      prev.map((row) => (String(row.id) === String(userId) ? { ...row, ...patch } : row))
    );
    setDetail((prev) =>
      prev && String(prev.id) === String(userId) ? { ...prev, ...patch } : prev
    );
  }

  async function handleBlockAccount(userId) {
    if (!canDeactivateEmployees || !userId) return;
    const target = employees.find((e) => String(e.id) === String(userId)) || detail;
    const label = target?.name || target?.username || 'this account';
    const ok = window.confirm(
      `Block ${label}? They will be signed out immediately and cannot sign in until you unblock them.`
    );
    if (!ok) return;
    setBlockingId(userId);
    setSaveError('');
    try {
      const { data } = await api.put(`/api/admin/accounts/${userId}/block`);
      const user = data?.user || {};
      await applyAccountPatch(userId, {
        blocked_at: user.blocked_at || new Date().toISOString(),
        blocked_reason: user.blocked_reason || null,
      });
      setSaveSuccess('Account blocked. They are signed out and cannot sign in.');
    } catch (err) {
      setSaveError(err.response?.data?.message || 'Failed to block account.');
    } finally {
      setBlockingId(null);
    }
  }

  async function handleUnblockAccount(userId) {
    if (!canDeactivateEmployees || !userId) return;
    const target = employees.find((e) => String(e.id) === String(userId)) || detail;
    if (isClosedAccount(target)) {
      setSaveError(
        isTerminatedAccount(target)
          ? 'This employee was terminated. The account stays blocked.'
          : 'This employee resigned. The account stays blocked.'
      );
      return;
    }
    setBlockingId(userId);
    setSaveError('');
    try {
      await api.put(`/api/admin/accounts/${userId}/unblock`);
      await applyAccountPatch(userId, { blocked_at: null, blocked_reason: null });
      setSaveSuccess('Account unblocked. They can sign in again.');
    } catch (err) {
      setSaveError(err.response?.data?.message || 'Failed to unblock account.');
    } finally {
      setBlockingId(null);
    }
  }

  function openExit(row, kind, event) {
    event?.stopPropagation?.();
    if (!row?.id) return;
    if (!(canDeactivateEmployees || canEditEmployees)) {
      setSaveError(
        kind === 'terminate'
          ? 'You do not have permission to terminate an employee.'
          : 'You do not have permission to mark an employee resigned.'
      );
      return;
    }
    if (isClosedAccount(row)) return;
    if (String(row.role || '').toLowerCase() === 'ceo') return;
    if (String(row.id) === String(currentUserId)) return;
    setExitModal({
      ...EMPTY_EXIT,
      row,
      kind: kind === 'terminate' ? 'terminate' : 'resign',
      lastDay: todayISODate(),
    });
  }

  function closeExit() {
    if (exitModal.saving) return;
    setExitModal(EMPTY_EXIT);
  }

  async function submitExit() {
    if (!exitModal.row?.id || !(canDeactivateEmployees || canEditEmployees)) return;
    const lastDay = officeDateValue(exitModal.lastDay);
    if (!lastDay) {
      setExitModal((prev) => ({ ...prev, error: 'Last day in office is required.' }));
      return;
    }
    const remarks = String(exitModal.remarks || '').trim();
    if (remarks.length > 500) {
      setExitModal((prev) => ({ ...prev, error: 'Remarks must be 500 characters or fewer.' }));
      return;
    }
    const isTerminate = exitModal.kind === 'terminate';
    const status = isTerminate ? 'terminated' : 'resigned';
    setExitModal((prev) => ({ ...prev, saving: true, error: '' }));
    setSaveError('');
    try {
      const { data } = await api.put(
        `/api/admin/employees/${exitModal.row.id}/${isTerminate ? 'terminate' : 'resign'}`,
        {
          last_day_in_office: lastDay,
          remarks,
        }
      );
      const user = data?.user || {};
      await applyAccountPatch(exitModal.row.id, {
        status: user.status || status,
        blocked_at: user.blocked_at || new Date().toISOString(),
        blocked_reason: user.blocked_reason || status,
        last_day_in_office: user.last_day_in_office || lastDay,
        resigned_at: user.resigned_at || (isTerminate ? null : new Date().toISOString()),
        terminated_at: user.terminated_at || (isTerminate ? new Date().toISOString() : null),
        exit_remarks: user.exit_remarks ?? (remarks || null),
      });
      setEditForm((prev) => ({ ...prev, status }));
      setExitModal(EMPTY_EXIT);
      setSaveSuccess(
        data?.message ||
          (isTerminate
            ? 'Employee marked terminated. The ID is blocked and cannot sign in.'
            : 'Employee marked resigned. The ID is blocked and cannot sign in.')
      );
    } catch (err) {
      setExitModal((prev) => ({
        ...prev,
        saving: false,
        error:
          err.response?.data?.message ||
          (isTerminate ? 'Failed to terminate employee.' : 'Failed to mark employee resigned.'),
      }));
    }
  }

  const portalEmployees = useMemo(
    () => employees.filter((e) => !isLowerStaffRow(e)),
    [employees]
  );
  const lowerStaff = useMemo(
    () => employees.filter((e) => isLowerStaffRow(e)),
    [employees]
  );

  const stats = useMemo(() => {
    const total = portalEmployees.length;
    const active = portalEmployees.filter((e) => e.status === 'active').length;
    const inactive = portalEmployees.filter(
      (e) =>
        e.status !== 'active' &&
        e.status !== 'resigned' &&
        e.status !== 'terminated' &&
        !isClosedAccount(e)
    ).length;
    const pendingId = portalEmployees.filter((e) => isBlank(e.employee_id)).length;
    const locked = portalEmployees.filter(
      (e) => isSignInDisabled(e) && !isClosedAccount(e)
    ).length;
    const resigned = portalEmployees.filter((e) => isResignedAccount(e)).length;
    const terminated = portalEmployees.filter((e) => isTerminatedAccount(e)).length;
    const incomplete = portalEmployees.filter((e) => isIncompleteProfile(e)).length;
    const complete = portalEmployees.filter((e) => isCompleteProfile(e)).length;
    return { total, active, inactive, pendingId, locked, resigned, terminated, complete, incomplete };
  }, [portalEmployees]);

  const departmentOptions = useMemo(() => {
    const seen = new Map();
    for (const t of teams) {
      const name = String(t.name || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, name);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [teams]);

  const branchOptions = useMemo(() => {
    const fromCatalog = branches.map((b) => String(b.name).trim()).filter(Boolean);
    const fromEmployees = employees
      .map((e) => e.branch)
      .filter((d) => d != null && String(d).trim() !== '')
      .map((d) => String(d).trim());
    return [...new Set([...BRANCH_OPTIONS, ...fromCatalog, ...fromEmployees])].sort((a, b) =>
      a.localeCompare(b)
    );
  }, [employees, branches]);

  const shiftOptions = useMemo(() => {
    const fromCatalog = shifts.map((s) => String(s.name).trim()).filter(Boolean);
    const fromEmployees = employees
      .map((e) => e.shift)
      .filter((d) => d != null && String(d).trim() !== '')
      .map((d) => String(d).trim());
    const fallback = fromCatalog.length ? [] : FALLBACK_SHIFT_OPTIONS;
    return [...new Set([...fromCatalog, ...fromEmployees, ...fallback])].sort((a, b) =>
      a.localeCompare(b)
    );
  }, [employees, shifts]);

  const tabCounts = useMemo(() => {
    const active = portalEmployees.filter((e) => e.status === 'active').length;
    const pending = portalEmployees.filter(
      (e) =>
        e.status !== 'active' &&
        e.status !== 'resigned' &&
        e.status !== 'terminated' &&
        !isClosedAccount(e)
    ).length;
    const locked = portalEmployees.filter(
      (e) => isSignInDisabled(e) && !isClosedAccount(e)
    ).length;
    const resigned = portalEmployees.filter((e) => isResignedAccount(e)).length;
    const terminated = portalEmployees.filter((e) => isTerminatedAccount(e)).length;
    const incomplete = portalEmployees.filter((e) => isIncompleteProfile(e)).length;
    const complete = portalEmployees.filter((e) => isCompleteProfile(e)).length;
    return {
      active,
      pending,
      locked,
      resigned,
      terminated,
      complete,
      incomplete,
      lower: lowerStaff.length,
    };
  }, [portalEmployees, lowerStaff]);

  const bulkAlertEligibleCount = useMemo(
    () =>
      portalEmployees.filter((row) => {
        if (!isApprovedEmployee(row) || isAccountBlocked(row)) return false;
        if (!missingEmployeePortalFields(row).length) return false;
        return !profileAlertAction(row, nowMs).disabled;
      }).length,
    [portalEmployees, nowMs]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const source = statusTab === 'subordinate-staff' ? lowerStaff : portalEmployees;

    return source.filter((e) => {
      if (statusTab === 'subordinate-staff') {
        if (!q) return true;
        const extra = `${e.staff_extra_1_label || ''} ${e.staff_extra_1_text || ''} ${e.staff_extra_2_label || ''} ${e.staff_extra_2_text || ''}`;
        return (
          fullName(e).toLowerCase().includes(q) ||
          String(e.branch || '').toLowerCase().includes(q) ||
          extra.toLowerCase().includes(q)
        );
      }
      if (statusTab === 'active' && e.status !== 'active') return false;
      if (
        statusTab === 'pending' &&
        (e.status === 'active' ||
          e.status === 'resigned' ||
          e.status === 'terminated' ||
          isClosedAccount(e))
      ) {
        return false;
      }
      if (statusTab === 'inactive' && e.status !== 'inactive') return false;
      if (statusTab === 'locked' && (!isSignInDisabled(e) || isClosedAccount(e))) return false;
      if (statusTab === 'resigned' && !isResignedAccount(e)) return false;
      if (statusTab === 'terminated' && !isTerminatedAccount(e)) return false;
      if (statusTab === 'complete' && !isCompleteProfile(e)) return false;
      if (
        statusTab === 'incomplete' &&
        (!isApprovedEmployee(e) || isAccountBlocked(e) || !isIncompleteProfile(e))
      ) {
        return false;
      }
      if (
        statusTab !== 'complete' &&
        statusTab !== 'incomplete' &&
        statusTab !== 'resigned' &&
        statusTab !== 'terminated' &&
        filters.status !== 'all' &&
        e.status !== filters.status
      ) {
        return false;
      }
      if (
        filters.department !== 'all' &&
        String(e.department || '').trim().toLowerCase() !== String(filters.department).trim().toLowerCase()
      ) {
        return false;
      }
      if (filters.branch !== 'all' && e.branch !== filters.branch) return false;
      if (filters.shift !== 'all' && e.shift !== filters.shift) return false;

      if (!q) return true;
      const name = fullName(e).toLowerCase();
      const username = String(e.username || '').toLowerCase();
      const empId = String(e.employee_id || '').toLowerCase();
      return name.includes(q) || username.includes(q) || empId.includes(q);
    });
  }, [portalEmployees, lowerStaff, search, filters, statusTab]);

  const selectedListRow = useMemo(
    () => employees.find((e) => String(e.id) === String(selectedId)) || null,
    [employees, selectedId]
  );
  const detailMissingAdmin = useMemo(
    () => missingAdminFields(detail).map((key) => ADMIN_FIELD_LABELS[key]),
    [detail]
  );
  const detailMissingEmployee = useMemo(
    () => missingEmployeePortalFieldsUnion(detail, selectedListRow).map((f) => f.label),
    [detail, selectedListRow]
  );

  function mergeDocumentPresence(primary, fallback) {
    const keys = [
      'profile_picture_on_file',
      'cnic_front_on_file',
      'cnic_back_on_file',
      'cv_on_file',
    ];
    const next = { ...fallback, ...primary };
    for (const key of keys) {
      if (fallback?.[key] === false || primary?.[key] === false) next[key] = false;
      else if (typeof primary?.[key] === 'boolean') next[key] = primary[key];
      else if (typeof fallback?.[key] === 'boolean') next[key] = fallback[key];
    }
    return next;
  }

  async function openDetail(id) {
    const preview = employees.find((e) => String(e.id) === String(id)) || null;
    setSelectedId(id);
    setDetail(preview);
    setDetailLoading(true);
    setSaveError('');
    setSaveSuccess('');
    setFieldErrors({});

    try {
      const { data } = await api.get(`/api/admin/employees/${id}`);
      setDetail(mergeDocumentPresence(data, preview));
      setEditForm({
        employee_id: data.employee_id || '',
        status:
          data.status === 'inactive'
            ? 'inactive'
            : data.status === 'active'
              ? 'active'
              : data.status === 'resigned'
                ? 'resigned'
                : 'inactive',
        department: data.department || '',
        designation: data.designation || '',
        branch: data.branch || '',
        shift: data.shift || '',
        date_of_joining: data.date_of_joining
          ? String(data.date_of_joining).slice(0, 10)
          : '',
        employment_type: data.employment_type === 'remote' ? 'remote' : 'onsite',
        work_start_hour: data.work_start_hour ?? 9,
        work_end_hour: data.work_end_hour ?? 18,
      });
      setShowAddTeam(false);
      setNewTeamName('');
      setTeamError('');
    } catch (err) {
      setSaveError(err.response?.data?.message || 'Failed to load employee details.');
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    const fillId = searchParams.get('fill');
    if (!fillId || checkingAuth) return;
    if (String(selectedId) === String(fillId)) return;
    openDetail(fillId);
  }, [searchParams, checkingAuth, selectedId]);

  function closeDetail() {
    setSelectedId(null);
    setDetail(null);
    setCnicView(null);
    setSaveError('');
    setSaveSuccess('');
    setFieldErrors({});
    setSearchParams((prev) => {
      if (!prev.get('fill')) return prev;
      const next = new URLSearchParams(prev);
      next.delete('fill');
      return next;
    }, { replace: true });
  }

  function handleEditChange(e) {
    const { name, value } = e.target;
    if (name === 'status' && value === 'resigned') {
      if (isResignedAccount(detail) || editForm.status === 'resigned') {
        setEditForm((prev) => ({ ...prev, status: 'resigned' }));
        return;
      }
      openExit(detail, 'resign');
      return;
    }
    if (name === 'status' && value === 'terminated') {
      if (isTerminatedAccount(detail) || editForm.status === 'terminated') {
        setEditForm((prev) => ({ ...prev, status: 'terminated' }));
        return;
      }
      openExit(detail, 'terminate');
      return;
    }
    if (
      name === 'status' &&
      (editForm.status === 'resigned' || editForm.status === 'terminated') &&
      value !== editForm.status
    ) {
      setSaveError(
        editForm.status === 'terminated'
          ? 'This employee was terminated. Status cannot be changed.'
          : 'This employee resigned. Status cannot be changed.'
      );
      return;
    }
    setEditForm((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }

  function handleFilterChange(e) {
    const { name, value } = e.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
  }

  function clearFilters() {
    setSearch('');
    setFilters(EMPTY_FILTERS);
  }

  function validateAdminForm() {
    const errors = {};
    for (const key of Object.keys(ADMIN_FIELD_LABELS)) {
      if (key === 'date_of_joining') continue; // optional
      if (isBlank(editForm[key])) {
        errors[key] = `${ADMIN_FIELD_LABELS[key]} is required.`;
      }
    }
    return errors;
  }

  async function handleCreateTeam(e) {
    e?.preventDefault?.();
    const name = newTeamName.trim();
    if (!name) {
      setTeamError('Enter a team name.');
      return;
    }
    if (!canCreateTeams) {
      setTeamError('You do not have permission to create teams.');
      return;
    }
    setCreatingTeam(true);
    setTeamError('');
    try {
      const { data } = await api.post('/api/admin/teams', { name });
      setTeams((prev) =>
        [...prev, data].sort((a, b) => String(a.name).localeCompare(String(b.name)))
      );
      setEditForm((prev) => ({ ...prev, department: data.name }));
      setFieldErrors((prev) => {
        if (!prev.department) return prev;
        const next = { ...prev };
        delete next.department;
        return next;
      });
      setNewTeamName('');
      setShowAddTeam(false);
    } catch (err) {
      setTeamError(err.response?.data?.message || 'Failed to create team.');
    } finally {
      setCreatingTeam(false);
    }
  }

  async function handleCreateBranch(e) {
    e?.preventDefault?.();
    const name = newBranchName.trim();
    if (!name) {
      setBranchError('Enter a branch name.');
      return;
    }
    if (!canCreateBranches) {
      setBranchError('You do not have permission to create branches.');
      return;
    }
    setCreatingBranch(true);
    setBranchError('');
    try {
      const { data } = await api.post('/api/admin/branches', { name });
      setBranches((prev) =>
        [...prev, data].sort((a, b) => String(a.name).localeCompare(String(b.name)))
      );
      setEditForm((prev) => ({ ...prev, branch: data.name }));
      setFieldErrors((prev) => {
        if (!prev.branch) return prev;
        const next = { ...prev };
        delete next.branch;
        return next;
      });
      setNewBranchName('');
      setShowAddBranch(false);
    } catch (err) {
      setBranchError(err.response?.data?.message || 'Failed to create branch.');
    } finally {
      setCreatingBranch(false);
    }
  }

  async function handleCreateDesignation({ name, tl_dashboard_access }) {
    try {
      const { data } = await api.post('/api/admin/designations', {
        name,
        tl_dashboard_access,
      });
      setDesignations((prev) => {
        const next = prev.some((d) => d.id === data.id)
          ? prev.map((d) => (d.id === data.id ? data : d))
          : [...prev, data];
        return next.sort((a, b) => {
          if (a.tl_dashboard_access !== b.tl_dashboard_access) {
            return a.tl_dashboard_access ? -1 : 1;
          }
          return String(a.name).localeCompare(String(b.name));
        });
      });
      setEditForm((prev) => ({ ...prev, designation: data.name }));
      setAddForm((prev) => ({ ...prev, designation: data.name }));
      setFieldErrors((prev) => {
        if (!prev.designation) return prev;
        const next = { ...prev };
        delete next.designation;
        return next;
      });
    } catch (err) {
      throw new Error(err.response?.data?.message || 'Failed to add designation.');
    }
  }

  async function handleRemoveDesignation(row) {
    try {
      await api.delete(`/api/admin/designations/${row.id}`);
      setDesignations((prev) => prev.filter((d) => d.id !== row.id));
      setEditForm((prev) =>
        prev.designation === row.name ? { ...prev, designation: '' } : prev
      );
      setAddForm((prev) =>
        prev.designation === row.name ? { ...prev, designation: '' } : prev
      );
    } catch (err) {
      throw new Error(err.response?.data?.message || 'Failed to remove designation.');
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!selectedId) return;
    if (!canEditEmploymentType(detail?.employment_type) && !canEditEmploymentType(editForm.employment_type)) {
      setSaveError('You do not have permission to edit this employee.');
      return;
    }

    const errors = validateAdminForm();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setSaveError('All required fields must be filled before saving.');
      setSaveSuccess('');
      return;
    }

    setSaving(true);
    setSaveError('');
    setSaveSuccess('');

    const payload = {
      employee_id: editForm.employee_id.trim(),
      status: editForm.status,
      department: editForm.department.trim(),
      designation: editForm.designation.trim(),
      branch: editForm.branch,
      shift: editForm.shift,
      date_of_joining: editForm.date_of_joining ? editForm.date_of_joining : null,
      employment_type: editForm.employment_type === 'remote' ? 'remote' : 'onsite',
      work_start_hour: Number(editForm.work_start_hour),
      work_end_hour: Number(editForm.work_end_hour),
    };

    try {
      const { data } = await api.put(`/api/admin/employees/${selectedId}`, payload);
      setDetail(data);
      setSaveSuccess('Changes saved.');

      setEmployees((prev) =>
        prev.map((row) =>
          row.id === data.id
            ? {
                ...row,
                employee_id: data.employee_id,
                status: data.status,
                department: data.department,
                designation: data.designation,
                branch: data.branch,
                shift: data.shift,
                date_of_joining: data.date_of_joining,
                employment_type: data.employment_type,
                profile_picture_url: data.profile_picture_url || row.profile_picture_url,
              }
            : row
        )
      );
      window.dispatchEvent(new Event(ADMIN_INCOMPLETE_EVENT));
    } catch (err) {
      setSaveError(err.response?.data?.message || 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  }

  function handleAddChange(e) {
    const { name, value } = e.target;
    setAddForm((prev) => ({
      ...prev,
      [name]: name === 'username' || name === 'email' ? value.toLowerCase() : value,
    }));
  }

  function closeAddModal() {
    if (adding) return;
    setAddOpen(false);
    setAddError('');
    setAddForm(EMPTY_ADD);
  }

  async function handleAddSubmit(e) {
    e.preventDefault();
    if (!canAddEmployees) {
      setAddError('Only HR with Add employees permission can create accounts.');
      return;
    }
    setAdding(true);
    setAddError('');
    const payload = {
      username: addForm.username.trim().toLowerCase(),
      name: addForm.name.trim(),
      email: addForm.email.trim().toLowerCase(),
      password: addForm.password,
      contact_number: addForm.contact_number.trim(),
      address: addForm.address.trim() || undefined,
      employee_id: addForm.employee_id.trim(),
      status: addForm.status,
      department: addForm.department.trim(),
      designation: addForm.designation.trim(),
      branch: addForm.branch,
      shift: addForm.shift,
      date_of_joining: addForm.date_of_joining || null,
      employment_type: addForm.employment_type === 'remote' ? 'remote' : 'onsite',
      education: addForm.education.trim() || undefined,
      last_job_status: addForm.last_job_status || undefined,
      bank_name: addForm.bank_name.trim() || undefined,
      account_title: addForm.account_title.trim() || undefined,
      account_number: addForm.account_number.trim() || undefined,
      iban: addForm.iban.trim() || undefined,
    };
    try {
      const { data } = await api.post('/api/admin/employees', payload);
      setAddOpen(false);
      setAddForm(EMPTY_ADD);
      await loadEmployees();
      window.dispatchEvent(new Event(ADMIN_INCOMPLETE_EVENT));
      if (data?.id) await openDetail(data.id);
    } catch (err) {
      setAddError(err.response?.data?.message || 'Failed to create employee.');
    } finally {
      setAdding(false);
    }
  }

  async function handleAddLowerStaff(e) {
    e.preventDefault();
    if (!canAddEmployees) {
      setLowerError('Only HR can add subordinate staff.');
      return;
    }
    const name = lowerForm.name.trim();
    const salary = Number(lowerForm.salary);
    const branch = lowerForm.branch.trim();
    if (!name) {
      setLowerError('Name is required.');
      return;
    }
    if (!Number.isFinite(salary) || salary <= 0) {
      setLowerError('Salary is required and must be greater than 0.');
      return;
    }
    if (!branch) {
      setLowerError('Branch is required.');
      return;
    }
    setAddingLower(true);
    setLowerError('');
    try {
      const fd = buildLowerStaffFormData();
      if (editingLowerId) {
        await api.put(`/api/admin/employees/${editingLowerId}/lower-staff`, fd);
      } else {
        await api.post('/api/admin/employees', fd);
      }
      resetLowerStaffForm();
      await loadEmployees();
    } catch (err) {
      setLowerError(
        err.response?.data?.message ||
          (editingLowerId ? 'Failed to update subordinate staff.' : 'Failed to add subordinate staff.')
      );
    } finally {
      setAddingLower(false);
    }
  }

  function buildLowerStaffFormData() {
    const fd = new FormData();
    fd.append('staff_kind', 'lower');
    fd.append('name', lowerForm.name.trim());
    fd.append('salary', String(lowerForm.salary).trim());
    fd.append('branch', lowerForm.branch.trim());
    fd.append('extra_1_kind', lowerForm.extra1Kind);
    fd.append('extra_1_label', lowerForm.extra1Label.trim());
    fd.append('extra_1_text', lowerForm.extra1Text);
    fd.append('extra_2_kind', lowerForm.extra2Kind);
    fd.append('extra_2_label', lowerForm.extra2Label.trim());
    fd.append('extra_2_text', lowerForm.extra2Text);
    if (lowerCnicFront) fd.append('cnic_front', lowerCnicFront);
    if (lowerCnicBack) fd.append('cnic_back', lowerCnicBack);
    if (lowerForm.extra1Kind === 'file' && lowerExtra1File) {
      fd.append('extra_1_file', lowerExtra1File);
    }
    if (lowerForm.extra2Kind === 'file' && lowerExtra2File) {
      fd.append('extra_2_file', lowerExtra2File);
    }
    return fd;
  }

  function resetLowerStaffForm() {
    setLowerForm(EMPTY_LOWER);
    setLowerCnicFront(null);
    setLowerCnicBack(null);
    setLowerExtra1File(null);
    setLowerExtra2File(null);
    setLowerExisting(null);
    setEditingLowerId(null);
    setLowerFormKey((n) => n + 1);
  }

  async function startEditLowerStaff(row) {
    setLowerError('');
    setEditingLowerId(row.id);
    setLowerForm(lowerFormFromRow(row));
    setLowerCnicFront(null);
    setLowerCnicBack(null);
    setLowerExtra1File(null);
    setLowerExtra2File(null);
    setLowerExisting(row);
    setLowerFormKey((n) => n + 1);
    try {
      const { data } = await api.get(`/api/admin/employees/${row.id}`);
      setLowerForm(lowerFormFromRow(data));
      setLowerExisting(data);
    } catch (err) {
      setLowerError(err.response?.data?.message || 'Could not load this record for editing.');
    }
  }

  function cancelEditLowerStaff() {
    resetLowerStaffForm();
    setLowerError('');
  }

  async function handleDeleteLowerStaff(row) {
    const label = fullName(row);
    if (!window.confirm(`Delete ${label} from subordinate staff? This cannot be undone.`)) {
      return false;
    }
    setDeletingLowerId(row.id);
    setLowerError('');
    try {
      await api.delete(`/api/admin/employees/${row.id}/lower-staff`);
      if (editingLowerId === row.id) cancelEditLowerStaff();
      await loadEmployees();
      return true;
    } catch (err) {
      setLowerError(err.response?.data?.message || 'Failed to delete subordinate staff.');
      return false;
    } finally {
      setDeletingLowerId(null);
    }
  }

  if (checkingAuth) {
    return (
      <div className="admin-page page-panel">
        <div className="admin-loading">
          <div className="spinner" />
          Checking admin access…
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="admin-page page-panel">
        <div className="admin-toolbar" style={{ marginTop: 0 }}>
          <div>
            <h1>Employees</h1>
            <p className="muted" style={{ margin: 0 }}>
              Directory, filters, and employee admin fields
            </p>
          </div>
          {canAddEmployees && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setAddError('');
                setAddForm(EMPTY_ADD);
                setAddOpen(true);
              }}
            >
              Add employee
            </button>
          )}
        </div>

        <section className="stat-grid">
          <article className="stat-card">
            <span className="stat-label">Total Employees</span>
            <span className="stat-value">{stats.total}</span>
          </article>
          <article className="stat-card active">
            <span className="stat-label">Active</span>
            <span className="stat-value">{stats.active}</span>
          </article>
          <article className="stat-card">
            <span className="stat-label">Pending Approval</span>
            <span className="stat-value">{stats.inactive}</span>
          </article>
          <article className="stat-card">
            <span className="stat-label">Pending Employee ID</span>
            <span className="stat-value">{stats.pendingId}</span>
          </article>
          <article className="stat-card">
            <span className="stat-label">Blocked Accounts</span>
            <span className="stat-value">{stats.locked}</span>
          </article>
          <article
            className="stat-card active"
            role="button"
            tabIndex={0}
            onClick={() => {
              setStatusTab('complete');
              setSearchParams({ status: 'complete' });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setStatusTab('complete');
                setSearchParams({ status: 'complete' });
              }
            }}
          >
            <span className="stat-label">Completed Profiles</span>
            <span className="stat-value">{stats.complete}</span>
          </article>
          <article
            className="stat-card warn"
            role="button"
            tabIndex={0}
            onClick={() => {
              setStatusTab('incomplete');
              setSearchParams({ status: 'incomplete' });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setStatusTab('incomplete');
                setSearchParams({ status: 'incomplete' });
              }
            }}
          >
            <span className="stat-label">Incomplete Profiles</span>
            <span className="stat-value">{stats.incomplete}</span>
          </article>
        </section>

        <div className="status-tabs">
          <button
            type="button"
            className={`status-tab ${statusTab === 'all' ? 'active' : ''}`}
            onClick={() => {
              setStatusTab('all');
              setSearchParams({});
            }}
          >
            All <span className="tab-badge">{portalEmployees.length}</span>
          </button>
          <button
            type="button"
            className={`status-tab ${statusTab === 'complete' ? 'active' : ''}`}
            onClick={() => {
              setStatusTab('complete');
              setSearchParams({ status: 'complete' });
            }}
          >
            Completed profiles <span className="tab-badge">{tabCounts.complete}</span>
          </button>
          <button
            type="button"
            className={`status-tab ${statusTab === 'incomplete' ? 'active' : ''}`}
            onClick={() => {
              setStatusTab('incomplete');
              setSearchParams({ status: 'incomplete' });
            }}
          >
            Incomplete profiles <span className="tab-badge">{tabCounts.incomplete}</span>
          </button>
          <button
            type="button"
            className={`status-tab ${statusTab === 'active' ? 'active' : ''}`}
            onClick={() => {
              setStatusTab('active');
              setSearchParams({ status: 'active' });
            }}
          >
            Active <span className="tab-badge">{tabCounts.active}</span>
          </button>
          <button
            type="button"
            className={`status-tab ${statusTab === 'pending' ? 'active' : ''}`}
            onClick={() => {
              setStatusTab('pending');
              setSearchParams({ status: 'pending' });
            }}
          >
            Pending Approval <span className="tab-badge">{tabCounts.pending}</span>
          </button>
          <button
            type="button"
            className={`status-tab ${statusTab === 'locked' ? 'active' : ''}`}
            onClick={() => {
              setStatusTab('locked');
              setSearchParams({ status: 'locked' });
            }}
          >
            Blocked <span className="tab-badge">{tabCounts.locked}</span>
          </button>
          <button
            type="button"
            className={`status-tab ${statusTab === 'resigned' ? 'active' : ''}`}
            onClick={() => {
              setStatusTab('resigned');
              setSearchParams({ status: 'resigned' });
            }}
          >
            Resigned <span className="tab-badge">{tabCounts.resigned}</span>
          </button>
          <button
            type="button"
            className={`status-tab ${statusTab === 'terminated' ? 'active' : ''}`}
            onClick={() => {
              setStatusTab('terminated');
              setSearchParams({ status: 'terminated' });
            }}
          >
            Terminated <span className="tab-badge">{tabCounts.terminated}</span>
          </button>
          {canAddEmployees && (
            <button
              type="button"
              className={`status-tab ${statusTab === 'subordinate-staff' ? 'active' : ''}`}
              onClick={() => {
                setStatusTab('subordinate-staff');
                setSearchParams({ status: 'subordinate-staff' });
              }}
            >
              Subordinate Staff <span className="tab-badge">{tabCounts.lower}</span>
            </button>
          )}
        </div>

        {statusTab !== 'subordinate-staff' && (
        <div className="admin-toolbar filters-toolbar">
          <input
            className="admin-search"
            type="search"
            placeholder="Search by name, username, or employee ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <select
            className="filter-select"
            name="status"
            value={filters.status}
            onChange={handleFilterChange}
            aria-label="Filter by status"
          >
            <option value="all">Status: All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive / Pending</option>
            <option value="resigned">Resigned</option>
            <option value="terminated">Terminated</option>
          </select>

          <select
            className="filter-select"
            name="department"
            value={filters.department}
            onChange={handleFilterChange}
            aria-label="Filter by team"
          >
            <option value="all">Team: All</option>
            {departmentOptions.map((dep) => (
              <option key={dep} value={dep}>
                {dep}
              </option>
            ))}
          </select>

          <select
            className="filter-select"
            name="branch"
            value={filters.branch}
            onChange={handleFilterChange}
            aria-label="Filter by branch"
          >
            <option value="all">Branch: All</option>
            {branchOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>

          <select
            className="filter-select"
            name="shift"
            value={filters.shift}
            onChange={handleFilterChange}
            aria-label="Filter by shift"
          >
            <option value="all">Shift: All</option>
            {shiftOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>

          <button type="button" className="btn btn-ghost" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
        )}

        {statusTab === 'incomplete' && canSendProfileAlert && (
          <div className="bulk-alert-bar">
            <div>
              <strong>Incomplete profiles: {tabCounts.incomplete}</strong>
              <p className="muted" style={{ margin: '0.2rem 0 0' }}>
                One alert goes to every approved employee who still has portal fields to fill.
                Pending, recently alerted, and 3-alert-limit people are skipped.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary bulk-alert-btn"
              disabled={bulkAlerting || bulkAlertEligibleCount <= 0}
              title={
                bulkAlertEligibleCount <= 0
                  ? 'No incomplete profiles are ready for an alert right now.'
                  : `Alert ${bulkAlertEligibleCount} incomplete profiles`
              }
              onClick={handleBulkProfileAlert}
            >
              {bulkAlerting
                ? 'Sending…'
                : `Alert all incomplete (${bulkAlertEligibleCount})`}
            </button>
          </div>
        )}
        {listNotice && <p className="success">{listNotice}</p>}
        {saveError && !selectedId && <p className="error">{saveError}</p>}

        {statusTab === 'subordinate-staff' && canAddEmployees && (
          (editingLowerId ? (node) => createPortal(node, document.body) : (node) => node)(
          <div
            className={
              editingLowerId
                ? 'modal-backdrop modal-backdrop-stack lower-staff-portal lower-staff-edit-overlay'
                : undefined
            }
            onClick={
              editingLowerId && !addingLower ? () => cancelEditLowerStaff() : undefined
            }
          >
            <div
              className={
                editingLowerId ? 'modal-panel modal-panel-center lower-staff-edit-modal' : undefined
              }
              onClick={editingLowerId ? (e) => e.stopPropagation() : undefined}
              role={editingLowerId ? 'dialog' : undefined}
              aria-modal={editingLowerId ? true : undefined}
              aria-label={editingLowerId ? 'Edit subordinate staff' : undefined}
            >
          <form
            key={lowerFormKey}
            className="lower-staff-form"
            onSubmit={handleAddLowerStaff}
          >
            <div className="lower-staff-form-head">
              <div>
                <p className="lower-staff-kicker">Payroll only</p>
                <h2>
                  {editingLowerId ? `Edit ${lowerForm.name || 'subordinate staff'}` : 'Add subordinate staff'}
                </h2>
                <p>
                  Name, salary, and branch are required. CNIC and extra info are optional if you
                  need more on file.
                </p>
              </div>
              {editingLowerId && <span className="lower-staff-editing-pill">Editing</span>}
            </div>

            <section className="lower-staff-section">
              <h3>Details</h3>
              <div className="lower-staff-fields">
                <label className="lower-field">
                  <span className="lower-field-label">
                    Name <span className="req-star">*</span>
                  </span>
                  <input
                    type="text"
                    value={lowerForm.name}
                    onChange={(e) => setLowerForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Full name"
                    required
                  />
                </label>
                <label className="lower-field">
                  <span className="lower-field-label">
                    Salary <span className="req-star">*</span>
                  </span>
                  <input
                    type="number"
                    value={lowerForm.salary}
                    onChange={(e) => setLowerForm((f) => ({ ...f, salary: e.target.value }))}
                    placeholder="Amount"
                    min="1"
                    step="1"
                    required
                  />
                </label>
                <label className="lower-field">
                  <span className="lower-field-label">
                    Branch <span className="req-star">*</span>
                  </span>
                  <select
                    value={lowerForm.branch}
                    onChange={(e) => setLowerForm((f) => ({ ...f, branch: e.target.value }))}
                    required
                  >
                    <option value="">Select branch</option>
                    {branchOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className="lower-staff-section">
              <h3>CNIC</h3>
              <p className="lower-staff-section-note">
                On a phone, tap Capture to take the photo. Upload still works from the gallery or
                desktop.
              </p>
              <div className="lower-cnic-grid">
                <LowerFilePick
                  label="Front"
                  hint="Capture on mobile or upload an image"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  file={lowerCnicFront}
                  existingUrl={lowerExisting?.cnic_front_url}
                  cacheKey={lowerExisting?.updated_at || lowerExisting?.id}
                  imagePreview
                  allowCapture
                  onFile={setLowerCnicFront}
                  onViewCurrent={
                    lowerExisting?.id && lowerExisting?.cnic_front_url
                      ? () =>
                          setCnicView({
                            userId: lowerExisting.id,
                            docType: 'cnic_front',
                            title: 'CNIC front',
                            subject: lowerExisting.name,
                          })
                      : undefined
                  }
                />
                <LowerFilePick
                  label="Back"
                  hint="Capture on mobile or upload an image"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  file={lowerCnicBack}
                  existingUrl={lowerExisting?.cnic_back_url}
                  cacheKey={lowerExisting?.updated_at || lowerExisting?.id}
                  imagePreview
                  allowCapture
                  onFile={setLowerCnicBack}
                  onViewCurrent={
                    lowerExisting?.id && lowerExisting?.cnic_back_url
                      ? () =>
                          setCnicView({
                            userId: lowerExisting.id,
                            docType: 'cnic_back',
                            title: 'CNIC back',
                            subject: lowerExisting.name,
                          })
                      : undefined
                  }
                />
              </div>
            </section>

            <section className="lower-staff-section">
              <h3>Extra information</h3>
              <p className="lower-staff-section-note">
                Two optional slots. Use text for a labeled note, or upload a document.
              </p>
              <div className="lower-extra-slots">
                {[
                  {
                    slot: 1,
                    kind: lowerForm.extra1Kind,
                    label: lowerForm.extra1Label,
                    text: lowerForm.extra1Text,
                    file: lowerExtra1File,
                    setFile: setLowerExtra1File,
                    existingUrl: lowerExisting?.staff_extra_1_url,
                    kindKey: 'extra1Kind',
                    labelKey: 'extra1Label',
                    textKey: 'extra1Text',
                  },
                  {
                    slot: 2,
                    kind: lowerForm.extra2Kind,
                    label: lowerForm.extra2Label,
                    text: lowerForm.extra2Text,
                    file: lowerExtra2File,
                    setFile: setLowerExtra2File,
                    existingUrl: lowerExisting?.staff_extra_2_url,
                    kindKey: 'extra2Kind',
                    labelKey: 'extra2Label',
                    textKey: 'extra2Text',
                  },
                ].map((slot) => (
                  <div className="lower-extra-card" key={slot.slot}>
                    <div className="lower-extra-card-head">
                      <span>Slot {slot.slot}</span>
                      <div
                        className="lower-extra-kinds"
                        role="tablist"
                        aria-label={`Extra info ${slot.slot} type`}
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={slot.kind === 'text'}
                          className={`lower-extra-kind ${slot.kind === 'text' ? 'active' : ''}`}
                          onClick={() => setLowerForm((f) => ({ ...f, [slot.kindKey]: 'text' }))}
                        >
                          Text
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={slot.kind === 'file'}
                          className={`lower-extra-kind ${slot.kind === 'file' ? 'active' : ''}`}
                          onClick={() => setLowerForm((f) => ({ ...f, [slot.kindKey]: 'file' }))}
                        >
                          Document
                        </button>
                      </div>
                    </div>
                    <label className="lower-field">
                      <span className="lower-field-label">Label</span>
                      <input
                        type="text"
                        value={slot.label}
                        onChange={(e) =>
                          setLowerForm((f) => ({ ...f, [slot.labelKey]: e.target.value }))
                        }
                        placeholder="e.g. License, contract, notes"
                      />
                    </label>
                    {slot.kind === 'text' ? (
                      <label className="lower-field">
                        <span className="lower-field-label">Text</span>
                        <textarea
                          rows={4}
                          value={slot.text}
                          onChange={(e) =>
                            setLowerForm((f) => ({ ...f, [slot.textKey]: e.target.value }))
                          }
                          placeholder="Any other information to keep on this record"
                        />
                      </label>
                    ) : (
                      <LowerFilePick
                        label="Document"
                        hint="Capture a photo on mobile, or upload an image or PDF"
                        accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                        file={slot.file}
                        existingUrl={slot.existingUrl}
                        cacheKey={lowerExisting?.updated_at || lowerExisting?.id}
                        imagePreview
                        allowCapture
                        onFile={slot.setFile}
                      />
                    )}
                  </div>
                ))}
              </div>
            </section>

            <div className="lower-staff-actions">
              <button type="submit" className="btn btn-primary" disabled={addingLower}>
                {addingLower
                  ? editingLowerId
                    ? 'Saving…'
                    : 'Adding…'
                  : editingLowerId
                    ? 'Save changes'
                    : 'Add subordinate staff'}
              </button>
              {editingLowerId && (
                <button type="button" className="btn btn-ghost" onClick={cancelEditLowerStaff}>
                  Cancel
                </button>
              )}
              {lowerError && <p className="error">{lowerError}</p>}
            </div>
          </form>
            </div>
          </div>
          )
        )}

        <div className="table-shell">
          {loading && (
            <div className="admin-loading">
              <div className="spinner" />
              Loading employees…
            </div>
          )}

          {!loading && listError && <div className="admin-empty error">{listError}</div>}

          {!loading && !listError && filtered.length === 0 && (
            <div className="admin-empty">
              {statusTab === 'subordinate-staff'
                ? 'No subordinate staff yet. Add a record above.'
                : statusTab === 'complete'
                  ? 'No completed profiles yet.'
                  : statusTab === 'incomplete'
                    ? 'No incomplete profiles.'
                    : statusTab === 'resigned'
                      ? 'No resigned employees.'
                    : statusTab === 'terminated'
                      ? 'No terminated employees.'
                : employees.length === 0
                  ? 'No employees found yet.'
                  : 'No employees match your search or filters.'}
            </div>
          )}

          {!loading && !listError && filtered.length > 0 && statusTab !== 'subordinate-staff' && (
            <table className="admin-table">
              <thead>
                <tr>
                  {canSendProfileAlert &&
                    statusTab !== 'pending' &&
                    statusTab !== 'incomplete' &&
                    statusTab !== 'complete' && <th>Alert</th>}
                  <th>Photo</th>
                  <th>Full Name</th>
                  <th>Username</th>
                  <th>Employee ID</th>
                  <th>Department</th>
                  <th>Designation</th>
                  <th>Branch</th>
                  <th>Shift</th>
                  <th>Status</th>
                  {statusTab === 'incomplete' && <th>Alerts</th>}
                  {canEditEmployees && <th>Transfer</th>}
                  {canDeactivateEmployees && <th>Exit</th>}
                  {canSendMessages && <th>Message</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const missingAdmin = missingAdminFields(row);
                  const missingEmployee = missingEmployeePortalFields(row);
                  const incomplete = missingAdmin.length > 0 || missingEmployee.length > 0;
                  const alertAction = profileAlertAction(row, nowMs);
                  const alertCooldown = alertAction.cooldown;
                  return (
                    <tr key={row.id} onClick={() => openDetail(row.id)}>
                      {canSendProfileAlert &&
                        statusTab !== 'pending' &&
                        statusTab !== 'incomplete' &&
                        statusTab !== 'complete' && (
                        <td className="cell-alert">
                          {isApprovedEmployee(row) && missingEmployee.length > 0 ? (
                            <button
                              type="button"
                              className="btn btn-ghost alert-row-btn"
                              title={
                                alertAction.locked
                                  ? `Portal limited after ${PROFILE_ALERT_MAX} alerts until they complete employee fields`
                                  : alertCooldown.active
                                  ? `Already sent. Try again in ${alertCooldown.remainingLabel}`
                                  : `Ask them to fill: ${missingEmployee.map((f) => f.label).join(', ')}`
                              }
                              aria-label={
                                alertAction.locked
                                  ? `Profile limited after ${PROFILE_ALERT_MAX} alerts`
                                  : alertCooldown.active
                                  ? `Alert available in ${alertCooldown.remainingLabel}`
                                  : `Alert ${fullName(row)} to complete portal fields`
                              }
                              disabled={alertingId === row.id || alertAction.disabled}
                              onClick={(e) => handleSendProfileAlert(row.id, e)}
                            >
                              {alertingId === row.id ? '…' : alertAction.label}
                            </button>
                          ) : (
                            <span className="muted-cell">—</span>
                          )}
                        </td>
                      )}
                      <td>
                        {row.profile_picture_url ? (
                          <button
                            type="button"
                            className="photo-open-btn"
                            aria-label={`View photo of ${fullName(row)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPhotoPreview({
                                src: withAuthDocumentUrl(
                                  row.profile_picture_url,
                                  row.updated_at || row.id
                                ),
                                alt: fullName(row),
                              });
                            }}
                          >
                            <img
                              className="thumb"
                              src={withAuthDocumentUrl(
                                row.profile_picture_url,
                                row.updated_at || row.id
                              )}
                              alt=""
                            />
                          </button>
                        ) : (
                          <div className="thumb">
                            {(row.name || '?').charAt(0).toUpperCase()}
                          </div>
                        )}
                      </td>
                      <td className="cell-name">
                        <span className="name-with-badge">
                          {fullName(row)}
                          {incomplete && (
                            <span
                              className="warn-badge"
                              title={[
                                missingEmployee.length
                                  ? `Employee portal: ${missingEmployee.map((f) => f.label).join(', ')}`
                                  : '',
                                missingAdmin.length
                                  ? `Admin assign: ${missingAdmin.map((k) => ADMIN_FIELD_LABELS[k]).join(', ')}`
                                  : '',
                              ]
                                .filter(Boolean)
                                .join(' | ')}
                              aria-label="Incomplete profile fields"
                            >
                              !
                            </span>
                          )}
                        </span>
                      </td>
                      <td>{row.username || '—'}</td>
                      <td>
                        {row.employee_id ? (
                          row.employee_id
                        ) : (
                          <span className="muted-cell">Not assigned</span>
                        )}
                      </td>
                      <td>{row.department || '—'}</td>
                      <td>{row.designation || '—'}</td>
                      <td>{row.branch || '—'}</td>
                      <td>{row.shift || '—'}</td>
                      <td>
                        <div className="status-stack">
                          <span className={`status-pill ${statusClass(row.status)}`}>
                            {employmentStatusLabel(row.status)}
                          </span>
                          {isTerminatedAccount(row) ? (
                            <span
                              className="status-pill terminated"
                              title={
                                formatOfficeDate(row.last_day_in_office)
                                  ? `Last day in office ${formatOfficeDate(row.last_day_in_office)}`
                                  : 'Terminated — ID blocked'
                              }
                            >
                              terminated
                            </span>
                          ) : isResignedAccount(row) ? (
                            <span
                              className="status-pill resigned"
                              title={
                                formatOfficeDate(row.last_day_in_office)
                                  ? `Last day in office ${formatOfficeDate(row.last_day_in_office)}`
                                  : 'Resigned — ID blocked'
                              }
                            >
                              resigned
                            </span>
                          ) : isAccountBlocked(row) ? (
                            <span
                              className="status-pill locked"
                              title={
                                row.blocked_at
                                  ? `Admin blocked since ${new Date(row.blocked_at).toLocaleString()}`
                                  : 'Account blocked'
                              }
                            >
                              blocked
                            </span>
                          ) : null}
                          {isAccountLocked(row) && (
                            <span
                              className="status-pill locked"
                              title={
                                row.locked_at
                                  ? `Locked since ${new Date(row.locked_at).toLocaleString()}`
                                  : 'Account locked'
                              }
                            >
                              locked
                            </span>
                          )}
                          {isProfileIncompleteLocked(row) && (
                            <span
                              className="status-pill locked"
                              title={`Limited to incomplete employee fields after ${PROFILE_ALERT_MAX} alerts`}
                            >
                              profile limited
                            </span>
                          )}
                        </div>
                        {canUnlockAccounts && isAccountLocked(row) && (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{
                              marginTop: '0.35rem',
                              padding: '0.25rem 0.55rem',
                              fontSize: '0.8rem',
                            }}
                            disabled={unlockingId === row.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUnlockAccount(row.id);
                            }}
                          >
                            {unlockingId === row.id ? '…' : 'Unlock'}
                          </button>
                        )}
                        {canDeactivateEmployees &&
                          isAccountBlocked(row) &&
                          !isClosedAccount(row) &&
                          String(row.id) !== String(currentUserId) && (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{
                              marginTop: '0.35rem',
                              padding: '0.25rem 0.55rem',
                              fontSize: '0.8rem',
                            }}
                            disabled={blockingId === row.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUnblockAccount(row.id);
                            }}
                          >
                            {blockingId === row.id ? '…' : 'Unblock'}
                          </button>
                        )}
                        {isClosedAccount(row) && formatOfficeDate(row.last_day_in_office) && (
                          <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.78rem' }}>
                            Last day {formatOfficeDate(row.last_day_in_office)}
                          </p>
                        )}
                      </td>
                      {statusTab === 'incomplete' && (
                        <td>
                          <span
                            className={`alert-count-pill${
                              profileAlertCount(row) >= PROFILE_ALERT_MAX ? ' is-max' : ''
                            }`}
                            title={`${profileAlertCount(row)} of ${PROFILE_ALERT_MAX} profile alerts sent`}
                          >
                            {profileAlertCount(row)}/{PROFILE_ALERT_MAX}
                          </span>
                        </td>
                      )}
                      {canEditEmployees && (
                        <td>
                          {canEditEmploymentType(row.employment_type) && !isClosedAccount(row) ? (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              title={`Transfer ${fullName(row)}`}
                              onClick={(e) => openTransfer(row, e)}
                            >
                              Transfer
                            </button>
                          ) : (
                            <span className="muted-cell">—</span>
                          )}
                        </td>
                      )}
                      {canDeactivateEmployees && (
                        <td>
                          {isTerminatedAccount(row) ? (
                            <span className="muted-cell">Terminated</span>
                          ) : isResignedAccount(row) ? (
                            <span className="muted-cell">Resigned</span>
                          ) : String(row.role || '').toLowerCase() === 'ceo' ||
                            String(row.id) === String(currentUserId) ? (
                            <span className="muted-cell">—</span>
                          ) : (
                            <div className="exit-actions">
                              <button
                                type="button"
                                className="btn btn-ghost"
                                title={`Mark ${fullName(row)} resigned`}
                                onClick={(e) => openExit(row, 'resign', e)}
                              >
                                Resign
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                title={`Terminate ${fullName(row)}`}
                                onClick={(e) => openExit(row, 'terminate', e)}
                              >
                                Terminate
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                      {canSendMessages && (
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost msg-row-btn"
                            title={`Message ${fullName(row)}`}
                            aria-label={`Message ${fullName(row)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setComposeRecipient(row);
                              setComposeOpen(true);
                              setComposeToast('');
                            }}
                          >
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              aria-hidden="true"
                            >
                              <path
                                d="M4 6h16v10H7l-3 3V6z"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

          {!loading && !listError && filtered.length > 0 && statusTab === 'subordinate-staff' && (
            <LowerStaffPayroll
              employees={filtered}
              canManage={canAddEmployees}
              extraSlotSummary={extraSlotSummary}
              fullName={fullName}
              formatSalaryAmount={formatSalaryAmount}
              onEdit={startEditLowerStaff}
              onCancelEdit={cancelEditLowerStaff}
              onDelete={handleDeleteLowerStaff}
              editingId={editingLowerId}
              deletingId={deletingLowerId}
            />
          )}
      </div>

      {composeToast && <p className="success">{composeToast}</p>}

      <PhotoLightbox
        open={Boolean(photoPreview?.src)}
        src={photoPreview?.src}
        alt={photoPreview?.alt}
        onClose={() => setPhotoPreview(null)}
      />

      <CnicProtectedViewer
        open={Boolean(cnicView)}
        userId={cnicView?.userId}
        docType={cnicView?.docType}
        title={cnicView?.title}
        viewerLabel={currentUserLabel}
        subjectLabel={cnicView?.subject}
        onClose={() => setCnicView(null)}
      />

      <ComposeMessageModal
        open={composeOpen}
        initialRecipient={composeRecipient}
        onClose={() => {
          setComposeOpen(false);
          setComposeRecipient(null);
        }}
        onSuccess={(payload) => {
          const warn = payload?.emailError ? ` — ${payload.emailError}` : '';
          setComposeToast((payload?.message || 'Message sent.') + warn);
        }}
      />

      {photoConfirm && (
        <div
          className="modal-backdrop modal-backdrop-stack"
          onClick={() => !photoAlertingId && setPhotoConfirm(null)}
        >
          <aside
            className="modal-panel modal-panel-center"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Confirm photo alert"
          >
            <div className="modal-header">
              <div>
                <h2>Send photo alert?</h2>
                <p className="muted" style={{ margin: 0 }}>
                  This message will be sent from your admin account to {fullName(photoConfirm)}.
                </p>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setPhotoConfirm(null)}
                aria-label="Close"
                disabled={Boolean(photoAlertingId)}
              >
                ×
              </button>
            </div>
            <p className="muted" style={{ margin: '0 0 0.45rem' }}>
              Subject: {PHOTO_ALERT_SUBJECT}
            </p>
            <blockquote className="photo-alert-preview">{PHOTO_ALERT_BODY}</blockquote>
            {saveError && <p className="error">{saveError}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setPhotoConfirm(null)}
                disabled={Boolean(photoAlertingId)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={confirmSendPhotoAlert}
                disabled={Boolean(photoAlertingId)}
              >
                {photoAlertingId ? 'Sending…' : 'Send alert'}
              </button>
            </div>
          </aside>
        </div>
      )}

      {selectedId && (
        <div className="modal-backdrop" onClick={closeDetail}>
          <aside
            className="modal-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Employee details"
          >
            <div className="modal-header">
              <div>
                <h2>Employee details</h2>
                <p className="muted" style={{ margin: 0 }}>
                  Review documents and update admin fields
                </p>
              </div>
              <div className="modal-header-actions">
                {canSendProfileAlert &&
                  isApprovedEmployee(detail) &&
                  detailMissingEmployee.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost alert-row-btn"
                    title={
                      profileAlertAction(detail, nowMs).locked
                        ? `Portal limited after ${PROFILE_ALERT_MAX} alerts until they complete employee fields`
                        : profileAlertAction(detail, nowMs).cooldown.active
                        ? `Already sent. Try again in ${profileAlertAction(detail, nowMs).cooldown.remainingLabel}`
                        : `Ask them to fill: ${detailMissingEmployee.join(', ')}`
                    }
                    disabled={
                      alertingId === detail.id || profileAlertAction(detail, nowMs).disabled
                    }
                    onClick={(e) => handleSendProfileAlert(detail.id, e)}
                  >
                    {alertingId === detail.id
                      ? 'Sending…'
                      : profileAlertAction(detail, nowMs).label}
                  </button>
                )}
                {canEditEmploymentType(detail.employment_type) && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={(e) => openTransfer(detail, e)}
                  >
                    Transfer
                  </button>
                )}
                <button type="button" className="icon-btn" onClick={closeDetail} aria-label="Close">
                  ×
                </button>
              </div>
            </div>

            {detailLoading && (
              <div className="admin-loading">
                <div className="spinner" />
                Loading profile…
              </div>
            )}

            {!detailLoading && detail && (
              <>
                {(detailMissingEmployee.length > 0 || detailMissingAdmin.length > 0) && (
                  <div
                    className={`alert-banner admin-incomplete${detailMissingAdmin.length ? ' admin-force' : ''}`}
                    role="alert"
                  >
                    <div>
                      <strong>
                        {detailMissingAdmin.length
                          ? 'Admin fields still missing for this employee.'
                          : 'This employee still has incomplete portal fields.'}
                      </strong>
                      {detailMissingEmployee.length > 0 && (
                        <p className="muted" style={{ margin: '0.35rem 0 0' }}>
                          Employee fills in portal: {detailMissingEmployee.join(', ')}
                        </p>
                      )}
                      {detailMissingAdmin.length > 0 && (
                        <p style={{ margin: '0.35rem 0 0' }}>
                          You must assign: {detailMissingAdmin.join(', ')}
                        </p>
                      )}
                      {profileAlertAction(detail, nowMs).cooldown.active &&
                        isApprovedEmployee(detail) &&
                        !profileAlertAction(detail, nowMs).locked && (
                        <p className="muted" style={{ margin: '0.35rem 0 0' }}>
                          Next alert available in {profileAlertAction(detail, nowMs).cooldown.remainingLabel}.
                        </p>
                      )}
                      {profileAlertAction(detail, nowMs).locked && (
                        <p className="muted" style={{ margin: '0.35rem 0 0' }}>
                          {PROFILE_ALERT_MAX} alerts sent. Their portal is limited to incomplete employee fields until they finish.
                        </p>
                      )}
                    </div>
                    {canSendProfileAlert &&
                      isApprovedEmployee(detail) &&
                      detailMissingEmployee.length > 0 && (
                      <button
                        type="button"
                        className="btn btn-ghost alert-row-btn"
                        disabled={
                          alertingId === detail.id ||
                          profileAlertAction(detail, nowMs).disabled
                        }
                        onClick={(e) => handleSendProfileAlert(detail.id, e)}
                      >
                        {alertingId === detail.id
                          ? 'Sending…'
                          : profileAlertAction(detail, nowMs).label}
                      </button>
                    )}
                  </div>
                )}

                <div className="detail-hero">
                  {detail.profile_picture_url ? (
                    <button
                      type="button"
                      className="photo-open-btn"
                      aria-label={`View photo of ${fullName(detail)}`}
                      onClick={() =>
                        setPhotoPreview({
                          src: withAuthDocumentUrl(
                            detail.profile_picture_url,
                            detail.updated_at || detail.id
                          ),
                          alt: fullName(detail),
                        })
                      }
                    >
                      <img
                        className="thumb large"
                        src={withAuthDocumentUrl(
                          detail.profile_picture_url,
                          detail.updated_at || detail.id
                        )}
                        alt=""
                      />
                    </button>
                  ) : (
                    <div className="thumb large">
                      {(detail.name || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <strong style={{ color: 'var(--text-h)', fontSize: '1.1rem' }}>
                      {fullName(detail)}
                    </strong>
                    <div className="muted" style={{ margin: 0 }}>
                      @{detail.username}
                    </div>
                    {canSendProfileAlert && !isLowerStaffRow(detail) && (
                      <button
                        type="button"
                        className="btn btn-ghost alert-row-btn"
                        style={{ marginTop: '0.65rem' }}
                        title="Ask them to upload a clear face photo"
                        disabled={
                          photoAlertingId === detail.id ||
                          photoAlertCooldown(detail, nowMs).active
                        }
                        onClick={(e) => openPhotoAlertConfirm(detail, e)}
                      >
                        {photoAlertingId === detail.id
                          ? 'Sending…'
                          : photoAlertCooldown(detail, nowMs).active
                            ? `Photo wait ${photoAlertCooldown(detail, nowMs).remainingLabel}`
                            : 'Alert photo'}
                      </button>
                    )}
                    <div className="status-stack" style={{ marginTop: '0.45rem' }}>
                      <span className={`status-pill ${statusClass(detail.status)}`}>
                        {employmentStatusLabel(detail.status)}
                      </span>
                      {isTerminatedAccount(detail) ? (
                        <span className="status-pill terminated">terminated</span>
                      ) : isResignedAccount(detail) ? (
                        <span className="status-pill resigned">resigned</span>
                      ) : isAccountBlocked(detail) ? (
                        <span className="status-pill locked">blocked</span>
                      ) : null}
                      {isAccountLocked(detail) && (
                        <span className="status-pill locked">
                          locked
                          {detail.failed_login_attempts
                            ? ` · ${detail.failed_login_attempts} attempts`
                            : ''}
                        </span>
                      )}
                      {isProfileIncompleteLocked(detail) && (
                        <span className="status-pill locked">profile limited</span>
                      )}
                      {!isSignInDisabled(detail) && (
                        <span className="status-pill active">login ok</span>
                      )}
                    </div>
                    {isTerminatedAccount(detail) && (
                      <p className="muted" style={{ marginTop: '0.55rem', fontSize: '0.85rem' }}>
                        Terminated
                        {formatOfficeDate(detail.last_day_in_office)
                          ? ` · last day in office ${formatOfficeDate(detail.last_day_in_office)}`
                          : ''}
                        . This ID is blocked and cannot sign in.
                      </p>
                    )}
                    {isResignedAccount(detail) && (
                      <p className="muted" style={{ marginTop: '0.55rem', fontSize: '0.85rem' }}>
                        Resigned
                        {formatOfficeDate(detail.last_day_in_office)
                          ? ` · last day in office ${formatOfficeDate(detail.last_day_in_office)}`
                          : ''}
                        . This ID is blocked and cannot sign in.
                      </p>
                    )}
                    {detail.exit_remarks && isClosedAccount(detail) && (
                      <p className="muted" style={{ marginTop: '0.4rem', fontSize: '0.85rem' }}>
                        Remarks: {detail.exit_remarks}
                      </p>
                    )}
                    {isAccountBlocked(detail) && !isClosedAccount(detail) && (
                      <div
                        style={{
                          marginTop: '0.55rem',
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '0.5rem',
                          alignItems: 'center',
                        }}
                      >
                        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                          Admin blocked{' '}
                          {detail.blocked_at
                            ? new Date(detail.blocked_at).toLocaleString()
                            : ''}
                          {detail.blocked_reason ? ` · ${detail.blocked_reason}` : ''}
                        </p>
                        {canDeactivateEmployees && (
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={blockingId === detail.id}
                            onClick={() => handleUnblockAccount(detail.id)}
                          >
                            {blockingId === detail.id ? 'Unblocking…' : 'Unblock'}
                          </button>
                        )}
                      </div>
                    )}
                    {isAccountLocked(detail) && (
                      <div
                        style={{
                          marginTop: '0.55rem',
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '0.5rem',
                          alignItems: 'center',
                        }}
                      >
                        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                          Locked after failed logins{' '}
                          {detail.locked_at
                            ? new Date(detail.locked_at).toLocaleString()
                            : ''}
                        </p>
                        {canUnlockAccounts && (
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={unlockingId === detail.id}
                            onClick={() => handleUnlockAccount(detail.id)}
                          >
                            {unlockingId === detail.id ? 'Unlocking…' : 'Unlock'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="detail-subsection">
                  <h3>Personal information</h3>
                  <div className="detail-grid">
                    <DetailFact label="Full name">{fullName(detail)}</DetailFact>
                    <DetailFact label="Username">{detail.username}</DetailFact>
                    <DetailFact label="Role">{detail.role}</DetailFact>
                    <DetailFact label="Date of birth">
                      {formatOfficeDate(detail.date_of_birth)}
                    </DetailFact>
                    <DetailFact label="CNIC">{detail.cnic_number}</DetailFact>
                    <DetailFact label="Education">{detail.education}</DetailFact>
                    <DetailFact label="Last job status">
                      {lastJobLabel(detail.last_job_status)}
                    </DetailFact>
                    <DetailFact label="Email">{detail.email}</DetailFact>
                    <DetailFact label="Contact">{detail.contact_number}</DetailFact>
                    <DetailFact label="Address">{detail.address}</DetailFact>
                    <DetailFact label="Reference person">
                      {detail.reference_person_name}
                    </DetailFact>
                    <DetailFact label="Emergency contact name">
                      {detail.emergency_contact_name}
                    </DetailFact>
                    <DetailFact label="Emergency contact number">
                      {detail.emergency_contact_number}
                    </DetailFact>
                  </div>
                </div>

                <div className="detail-subsection">
                  <h3>Employment</h3>
                  <div className="detail-grid">
                    <DetailFact label="Employee ID">{detail.employee_id}</DetailFact>
                    <DetailFact label="Status">
                      {employmentStatusLabel(detail.status)}
                    </DetailFact>
                    <DetailFact label="Employment type">
                      {detail.employment_type === 'onsite'
                        ? 'Onsite'
                        : detail.employment_type === 'remote'
                          ? 'Remote'
                          : detail.employment_type}
                    </DetailFact>
                    <DetailFact label="Team">{detail.department}</DetailFact>
                    <DetailFact label="Designation">{detail.designation}</DetailFact>
                    <DetailFact label="Branch">{detail.branch}</DetailFact>
                    <DetailFact label="Shift">{detail.shift}</DetailFact>
                    <DetailFact label="Date of joining">
                      {formatOfficeDate(detail.date_of_joining)}
                    </DetailFact>
                    <DetailFact label="Salary">
                      {detail.salary_hidden ? 'Hidden' : formatSalaryAmount(detail.salary)}
                    </DetailFact>
                    <DetailFact label="Work hours">
                      {hoursRangeLabel(detail.work_start_hour, detail.work_end_hour) ||
                        (detail.work_start_hour != null || detail.work_end_hour != null
                          ? `${detail.work_start_hour ?? '—'}–${detail.work_end_hour ?? '—'}`
                          : '')}
                    </DetailFact>
                    <DetailFact label="Attendance">
                      {detail.attendance_enabled === false ? 'Off' : 'On'}
                    </DetailFact>
                    <DetailFact label="Flexible hours">
                      {yesNo(Boolean(detail.flexible_hours))}
                    </DetailFact>
                    <DetailFact label="Remote checks">
                      {detail.remote_check_count == null ? '' : detail.remote_check_count}
                    </DetailFact>
                    <DetailFact label="Last day in office">
                      {formatOfficeDate(detail.last_day_in_office)}
                    </DetailFact>
                    <DetailFact label="Resigned at">
                      {detail.resigned_at ? formatDateTime(detail.resigned_at) : ''}
                    </DetailFact>
                    <DetailFact label="Terminated at">
                      {detail.terminated_at ? formatDateTime(detail.terminated_at) : ''}
                    </DetailFact>
                    <DetailFact label="Exit remarks">
                      {detail.exit_remarks || ''}
                    </DetailFact>
                    <DetailFact label="Account created">
                      {detail.date_joined
                        ? new Date(detail.date_joined).toLocaleDateString()
                        : ''}
                    </DetailFact>
                    <DetailFact label="Last updated">
                      {detail.updated_at ? formatDateTime(detail.updated_at) : ''}
                    </DetailFact>
                    <DetailFact label="Profile alerts">
                      {`${profileAlertCount(detail)}/${PROFILE_ALERT_MAX}`}
                    </DetailFact>
                    <DetailFact label="Login blocked">
                      {isAccountBlocked(detail)
                        ? `${yesNo(true)}${detail.blocked_reason ? ` · ${detail.blocked_reason}` : ''}`
                        : 'No'}
                    </DetailFact>
                  </div>
                </div>

                <div className="detail-subsection">
                <h3>Documents</h3>
                {!canViewDocuments || detail.documents_redacted ? (
                  <p className="muted">
                    Document access is restricted for your admin role (needs documents:view).
                  </p>
                ) : (
                  <>
                <div className="doc-row">
                  <button
                    type="button"
                    className="doc-preview"
                    disabled={!detail.cnic_front_on_file}
                    onClick={() => {
                      if (!detail.cnic_front_on_file) return;
                      setCnicView({
                        userId: detail.id,
                        docType: 'cnic_front',
                        title: 'CNIC front',
                        subject: detail.name,
                      });
                    }}
                  >
                    <span>
                      {detail.cnic_front_on_file ? 'On file' : 'No CNIC front'}
                    </span>
                    <span>CNIC front</span>
                    <span className="muted" style={{ fontSize: '0.8rem' }}>
                      {detail.cnic_front_on_file ? 'Screenshots restricted' : 'Not uploaded'}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="doc-preview"
                    disabled={!detail.cnic_back_on_file}
                    onClick={() => {
                      if (!detail.cnic_back_on_file) return;
                      setCnicView({
                        userId: detail.id,
                        docType: 'cnic_back',
                        title: 'CNIC back',
                        subject: detail.name,
                      });
                    }}
                  >
                    <span>
                      {detail.cnic_back_on_file ? 'On file' : 'No CNIC back'}
                    </span>
                    <span>CNIC back</span>
                    <span className="muted" style={{ fontSize: '0.8rem' }}>
                      {detail.cnic_back_on_file ? 'Screenshots restricted' : 'Not uploaded'}
                    </span>
                  </button>
                </div>
                {detail.cv_url ? (
                  <a
                    className="cv-link"
                    href={withAuthDocumentUrl(detail.cv_url, detail.updated_at || detail.id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download CV (PDF)
                  </a>
                ) : (
                  <p className="muted">No CV uploaded.</p>
                )}
                {detail.employment_form_url ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEmploymentFormViewOpen(true);
                      }}
                    >
                      View employment form
                    </button>
                    <a
                      className="cv-link"
                      href={withAuthDocumentUrl(
                        detail.employment_form_url,
                        detail.updated_at || detail.id
                      )}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Download PDF
                    </a>
                  </div>
                ) : (
                  <p className="muted">No employment form uploaded.</p>
                )}
                {canUploadEmploymentForm && (
                <div
                  style={{
                    marginTop: '0.75rem',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.5rem',
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={Boolean(detail.employment_form_url)}
                    title={
                      detail.employment_form_url
                        ? 'A form is already on file. Use Change to replace it.'
                        : undefined
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      setEmploymentFormOpen(true);
                    }}
                  >
                    Upload Employment Form
                  </button>
                  {detail.employment_form_url && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEmploymentFormOpen(true);
                      }}
                    >
                      Change Employment Form
                    </button>
                  )}
                </div>
                )}
                  </>
                )}

                </div>

                <div className="detail-subsection">
                <h3>Bank details</h3>
                <div className="detail-grid">
                  <DetailFact label="Bank name">{detail.bank_name}</DetailFact>
                  <DetailFact label="Account title">{detail.account_title}</DetailFact>
                  <DetailFact label="IBAN">{detail.iban}</DetailFact>
                  <DetailFact label="Account number">{detail.account_number}</DetailFact>
                </div>
                </div>

                {(detail.staff_extra_1_label ||
                  detail.staff_extra_1_text ||
                  extraSlotSummary(detail, 1) ||
                  detail.staff_extra_2_label ||
                  detail.staff_extra_2_text ||
                  extraSlotSummary(detail, 2)) && (
                  <div className="detail-subsection">
                    <h3>Extra information</h3>
                    <div className="detail-grid">
                      <DetailFact label={detail.staff_extra_1_label || 'Extra 1'}>
                        {detail.staff_extra_1_text || extraSlotSummary(detail, 1)}
                      </DetailFact>
                      <DetailFact label={detail.staff_extra_2_label || 'Extra 2'}>
                        {detail.staff_extra_2_text || extraSlotSummary(detail, 2)}
                      </DetailFact>
                    </div>
                  </div>
                )}

                <div className="detail-subsection">
                <h3>Transfer record</h3>
                <TransferHistoryList userId={detail.id} refreshKey={transferTick} />
                </div>

                <div className="detail-subsection">
                <h3>Admin fields</h3>
                {!canEditEmploymentType(detail.employment_type) && (
                  <p className="muted" style={{ marginBottom: '0.75rem' }}>
                    You can view this profile but cannot edit admin fields.
                  </p>
                )}
                <form className="edit-box" onSubmit={handleSave} noValidate>
                  <fieldset disabled={!canEditEmploymentType(detail.employment_type)}>
                  <label className={fieldErrors.employee_id ? 'has-error' : ''}>
                    Employee ID <span className="req-star" aria-hidden="true">*</span>
                    <input
                      type="text"
                      name="employee_id"
                      value={editForm.employee_id}
                      onChange={handleEditChange}
                      placeholder="e.g. EMP-001"
                      required
                      aria-required="true"
                    />
                    {fieldErrors.employee_id && (
                      <span className="field-error">{fieldErrors.employee_id}</span>
                    )}
                  </label>

                  <label className={fieldErrors.status ? 'has-error' : ''}>
                    Status
                    <select name="status" value={editForm.status} onChange={handleEditChange}>
                      <option value="">Select status</option>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive / Pending Approval</option>
                      <option value="resigned">Resigned</option>
                      <option value="terminated">Terminated</option>
                    </select>
                    {fieldErrors.status && (
                      <span className="field-error">{fieldErrors.status}</span>
                    )}
                  </label>

                  <div className="field-with-action">
                    <label className={fieldErrors.department ? 'has-error' : ''}>
                      Department / Team
                      <select
                        name="department"
                        value={editForm.department}
                        onChange={handleEditChange}
                      >
                        <option value="">Select team</option>
                        {teams.map((t) => (
                          <option key={t.id} value={t.name}>
                            {t.name}
                          </option>
                        ))}
                        {editForm.department &&
                          !teams.some((t) => t.name === editForm.department) && (
                            <option value={editForm.department}>
                              {editForm.department} (legacy)
                            </option>
                          )}
                      </select>
                      {fieldErrors.department && (
                        <span className="field-error">{fieldErrors.department}</span>
                      )}
                    </label>

                    {canCreateTeams && canEditEmployees && (
                      <div>
                        {!showAddTeam ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ padding: '0.35rem 0.65rem', fontSize: '0.85rem' }}
                            onClick={() => {
                              setShowAddTeam(true);
                              setTeamError('');
                            }}
                          >
                            + Add New Team
                          </button>
                        ) : (
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: '0.5rem',
                              alignItems: 'center',
                            }}
                          >
                            <input
                              type="text"
                              value={newTeamName}
                              onChange={(e) => setNewTeamName(e.target.value)}
                              placeholder="New team name"
                              style={{ flex: '1 1 160px', minWidth: 0 }}
                              disabled={creatingTeam}
                            />
                            <button
                              type="button"
                              className="btn btn-primary"
                              style={{ padding: '0.35rem 0.75rem' }}
                              disabled={creatingTeam}
                              onClick={handleCreateTeam}
                            >
                              {creatingTeam ? 'Adding…' : 'Add'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ padding: '0.35rem 0.65rem' }}
                              disabled={creatingTeam}
                              onClick={() => {
                                setShowAddTeam(false);
                                setNewTeamName('');
                                setTeamError('');
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                        {teamError && (
                          <p className="error" style={{ margin: '0.35rem 0 0' }}>
                            {teamError}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <DesignationField
                    name="designation"
                    value={editForm.designation}
                    onChange={handleEditChange}
                    designations={designations}
                    canManage={canEditEmployees}
                    error={fieldErrors.designation}
                    onCreated={handleCreateDesignation}
                    onRemoved={handleRemoveDesignation}
                  />

                  <label className={fieldErrors.date_of_joining ? 'has-error' : ''}>
                    Date of joining
                    <input
                      type="date"
                      name="date_of_joining"
                      value={editForm.date_of_joining}
                      onChange={handleEditChange}
                    />
                    {fieldErrors.date_of_joining && (
                      <span className="field-error">{fieldErrors.date_of_joining}</span>
                    )}
                  </label>

                  <label className={fieldErrors.branch ? 'has-error' : ''}>
                    Branch
                    <select name="branch" value={editForm.branch} onChange={handleEditChange}>
                      <option value="">Select branch</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.name}>
                          {b.name}
                        </option>
                      ))}
                      {editForm.branch &&
                        !branches.some((b) => b.name === editForm.branch) && (
                          <option value={editForm.branch}>
                            {editForm.branch} (legacy)
                          </option>
                        )}
                    </select>
                    {fieldErrors.branch && (
                      <span className="field-error">{fieldErrors.branch}</span>
                    )}
                  </label>

                  {canCreateBranches && canEditEmployees && (
                    <div style={{ marginTop: '-0.35rem', marginBottom: '0.75rem' }}>
                      {!showAddBranch ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: '0.35rem 0.65rem', fontSize: '0.85rem' }}
                          onClick={() => {
                            setShowAddBranch(true);
                            setBranchError('');
                          }}
                        >
                          + Add New Branch
                        </button>
                      ) : (
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '0.5rem',
                            alignItems: 'center',
                          }}
                        >
                          <input
                            type="text"
                            value={newBranchName}
                            onChange={(e) => setNewBranchName(e.target.value)}
                            placeholder="New branch name"
                            style={{ flex: '1 1 160px', minWidth: 0 }}
                            disabled={creatingBranch}
                          />
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={creatingBranch}
                            onClick={handleCreateBranch}
                          >
                            {creatingBranch ? 'Adding…' : 'Add'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={creatingBranch}
                            onClick={() => {
                              setShowAddBranch(false);
                              setNewBranchName('');
                              setBranchError('');
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                      {branchError && <p className="error">{branchError}</p>}
                    </div>
                  )}

                  <label>
                    Employment type
                    <select
                      name="employment_type"
                      value={editForm.employment_type}
                      onChange={handleEditChange}
                    >
                      {(canEditOnsiteEmployees || editForm.employment_type === 'onsite') && (
                        <option value="onsite">Onsite</option>
                      )}
                      {(canRemoteEmployees || editForm.employment_type === 'remote') && (
                        <option value="remote">Remote</option>
                      )}
                    </select>
                  </label>
                  {editForm.employment_type === 'remote' && (
                    <>
                      <ClockHourSelect
                        label="Work start time"
                        value={editForm.work_start_hour ?? 9}
                        onChange={(hour) =>
                          setEditForm((prev) => ({ ...prev, work_start_hour: hour }))
                        }
                      />
                      <ClockHourSelect
                        label="Work end time"
                        value={editForm.work_end_hour ?? 18}
                        isEnd
                        onChange={(hour) =>
                          setEditForm((prev) => ({ ...prev, work_end_hour: hour }))
                        }
                      />
                    </>
                  )}

                  <label className={fieldErrors.shift ? 'has-error' : ''}>
                    Shift
                    <select name="shift" value={editForm.shift} onChange={handleEditChange}>
                      <option value="">Select shift</option>
                      {shiftOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                    {fieldErrors.shift && (
                      <span className="field-error">{fieldErrors.shift}</span>
                    )}
                  </label>
                  </fieldset>

                  {saveError && <p className="error">{saveError}</p>}
                  {saveSuccess && <p className="success">{saveSuccess}</p>}

                  <div className="modal-actions">
                    <button type="button" className="btn btn-ghost" onClick={closeDetail}>
                      Close
                    </button>
                    {canSendMessages && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => {
                          setComposeRecipient(detail);
                          setComposeOpen(true);
                          setComposeToast('');
                        }}
                      >
                        Message
                      </button>
                    )}
                    {canSendProfileAlert &&
                      isApprovedEmployee(detail) &&
                      detailMissingEmployee.length > 0 && (
                      <button
                        type="button"
                        className="btn btn-ghost alert-row-btn"
                        disabled={
                          alertingId === detail.id ||
                          saving ||
                          deactivating ||
                          profileAlertAction(detail, nowMs).disabled
                        }
                        onClick={(e) => handleSendProfileAlert(detail.id, e)}
                      >
                        {alertingId === detail.id
                          ? 'Sending…'
                          : profileAlertAction(detail, nowMs).label}
                      </button>
                    )}
                    {canUnlockAccounts && isAccountLocked(detail) && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={unlockingId === detail.id || saving || deactivating}
                        onClick={() => handleUnlockAccount(detail.id)}
                      >
                        {unlockingId === detail.id ? 'Unlocking…' : 'Unlock login'}
                      </button>
                    )}
                    {canDeactivateEmployees &&
                      isAccountBlocked(detail) &&
                      !isClosedAccount(detail) &&
                      String(detail.id) !== String(currentUserId) && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={blockingId === detail.id || saving || deactivating}
                        onClick={() => handleUnblockAccount(detail.id)}
                      >
                        {blockingId === detail.id ? 'Unblocking…' : 'Unblock account'}
                      </button>
                    )}
                    {canDeactivateEmployees &&
                      !isAccountBlocked(detail) &&
                      !isClosedAccount(detail) &&
                      String(detail.role || '').toLowerCase() !== 'ceo' &&
                      String(detail.id) !== String(currentUserId) && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={blockingId === detail.id || saving || deactivating}
                        onClick={() => handleBlockAccount(detail.id)}
                      >
                        {blockingId === detail.id ? 'Blocking…' : 'Block'}
                      </button>
                    )}
                    {canDeactivateEmployees &&
                      !isClosedAccount(detail) &&
                      String(detail.role || '').toLowerCase() !== 'ceo' &&
                      String(detail.id) !== String(currentUserId) && (
                      <>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={saving || deactivating}
                        onClick={() => openExit(detail, 'resign')}
                      >
                        Resign
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={saving || deactivating}
                        onClick={() => openExit(detail, 'terminate')}
                      >
                        Terminate
                      </button>
                      </>
                    )}
                    {canDeactivateEmployees &&
                      String(detail.role || '').toLowerCase() !== 'ceo' && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={deactivating || saving}
                      onClick={async () => {
                        const label = detail.name || detail.username || 'this employee';
                        const ok = window.confirm(
                          `Deactivate ${label}? They will disappear from the active list and cannot sign in. This can be reviewed under deactivated records; permanent purge is CEO-only.`
                        );
                        if (!ok) return;
                        setDeactivating(true);
                        setSaveError('');
                        try {
                          await api.delete(`/api/admin/employees/${selectedId}`);
                          setEmployees((prev) => prev.filter((e) => e.id !== selectedId));
                          closeDetail();
                        } catch (err) {
                          setSaveError(
                            err.response?.data?.message ||
                              err.response?.data?.error ||
                              'Failed to deactivate employee.'
                          );
                        } finally {
                          setDeactivating(false);
                        }
                      }}
                    >
                      {deactivating ? 'Deactivating…' : 'Deactivate'}
                    </button>
                    )}
                    {canEditEmploymentType(detail.employment_type) && (
                    <button type="submit" className="btn btn-primary" disabled={saving}>
                      {saving ? 'Saving…' : 'Save Changes'}
                    </button>
                    )}
                  </div>
                </form>
                </div>
              </>
            )}
          </aside>
        </div>
      )}

      {transfer.row && (
        <div className="modal-backdrop modal-backdrop-stack" onClick={closeTransfer}>
          <div
            className="modal-panel modal-panel-center transfer-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="transfer-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2 id="transfer-title">Transfer {fullName(transfer.row)}</h2>
                <p className="muted" style={{ margin: 0 }}>
                  Choose one option, then pick the new assignment.
                </p>
              </div>
              <button type="button" className="icon-btn" onClick={closeTransfer} aria-label="Close">
                ×
              </button>
            </div>
            {transfer.step === 'kind' ? (
              <div className="transfer-kind-grid">
                {['team', 'shift', 'branch'].map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className="transfer-kind-btn"
                    onClick={() =>
                      setTransfer((prev) => ({
                        ...prev,
                        step: 'pick',
                        kind,
                        value: '',
                        error: '',
                      }))
                    }
                  >
                    <strong>{transferKindLabel(kind)} transfer</strong>
                    <span>
                      Current:{' '}
                      {currentTransferValue(transfer.row, kind) || 'not assigned'}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="transfer-pick">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() =>
                    setTransfer((prev) => ({ ...prev, step: 'kind', kind: '', value: '', error: '' }))
                  }
                >
                  Back
                </button>
                <p>
                  {transferKindLabel(transfer.kind)} transfer for{' '}
                  <strong>{fullName(transfer.row)}</strong>
                </p>
                <label>
                  New {transferKindLabel(transfer.kind).toLowerCase()}
                  <select
                    value={transfer.value}
                    onChange={(e) => setTransfer((prev) => ({ ...prev, value: e.target.value }))}
                  >
                    <option value="">Select {transferKindLabel(transfer.kind).toLowerCase()}</option>
                    {transferOptionsForKind(transfer.kind).map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                {!transferOptionsForKind(transfer.kind).length && (
                  <p className="muted">No other {transferKindLabel(transfer.kind).toLowerCase()}s are available.</p>
                )}
                {transfer.error && <p className="error">{transfer.error}</p>}
                <div className="modal-actions">
                  <button type="button" className="btn btn-ghost" onClick={closeTransfer}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!transfer.value || transfer.saving}
                    onClick={submitTransfer}
                  >
                    {transfer.saving ? 'Transferring…' : `Move to ${transfer.value || '…'}`}
                  </button>
                </div>
              </div>
            )}
            <div className="transfer-history-block">
              <h3>Transfer record</h3>
              {transfer.loading ? (
                <p className="muted">Loading…</p>
              ) : transfer.history.length ? (
                <ol className="transfer-history">
                  {transfer.history.map((item) => (
                    <li key={item.id}>
                      <strong>{transferKindLabel(item.kind)}</strong>
                      <span>
                        {item.from_value || 'unset'} → {item.to_value}
                      </span>
                      <span className="muted">
                        {item.created_at ? new Date(item.created_at).toLocaleString() : ''}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted">No transfers recorded yet.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {exitModal.row && (
        <div className="modal-backdrop modal-backdrop-stack" onClick={closeExit}>
          <form
            className="modal-panel modal-panel-center transfer-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="exit-title"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              submitExit();
            }}
          >
            <div className="modal-header">
              <div>
                <h2 id="exit-title">
                  {exitModal.kind === 'terminate'
                    ? `Terminate ${fullName(exitModal.row)}`
                    : `Mark ${fullName(exitModal.row)} resigned`}
                </h2>
                <p className="muted" style={{ margin: 0 }}>
                  {exitModal.kind === 'terminate'
                    ? 'Enter their last day in office. After that this ID is blocked with reason terminated and they cannot sign in. Remarks are optional.'
                    : 'Enter their last day in office. After that this ID is blocked with reason resigned and they cannot sign in. Remarks are optional.'}
                </p>
              </div>
              <button type="button" className="icon-btn" onClick={closeExit} aria-label="Close">
                ×
              </button>
            </div>
            <OfficeDateSelect
              id="exit-last-day"
              label="Last day in office"
              value={exitModal.lastDay}
              disabled={exitModal.saving}
              onChange={(lastDay) => setExitModal((prev) => ({ ...prev, lastDay, error: '' }))}
            />
            <label className="exit-remarks-field">
              Remarks (optional)
              <textarea
                rows={4}
                maxLength={500}
                value={exitModal.remarks}
                disabled={exitModal.saving}
                placeholder="Add a note if needed"
                onChange={(e) =>
                  setExitModal((prev) => ({ ...prev, remarks: e.target.value, error: '' }))
                }
              />
              <span className="muted" style={{ fontSize: '0.78rem' }}>
                {String(exitModal.remarks || '').length}/500
              </span>
            </label>
            {exitModal.error && <p className="error">{exitModal.error}</p>}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={closeExit} disabled={exitModal.saving}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={exitModal.saving || !exitModal.lastDay}
              >
                {exitModal.saving
                  ? 'Saving…'
                  : exitModal.kind === 'terminate'
                    ? 'Confirm terminate and block ID'
                    : 'Confirm resign and block ID'}
              </button>
            </div>
          </form>
        </div>
      )}

      <UploadEmploymentFormModal
        open={employmentFormOpen}
        employee={detail}
        onClose={() => setEmploymentFormOpen(false)}
        onSuccess={() => {
          setComposeToast('Employment form PDF saved.');
          if (detail?.id) openDetail(detail.id);
        }}
      />

      <EmploymentFormViewer
        open={employmentFormViewOpen && Boolean(detail?.employment_form_url)}
        src={detail?.employment_form_url}
        title={`${detail?.name || 'Employee'} — employment form`}
        onClose={() => setEmploymentFormViewOpen(false)}
      />

      {addOpen && (
        <div className="modal-backdrop modal-backdrop-stack" onClick={closeAddModal} role="presentation">
          <div
            className="modal-panel modal-panel-center add-employee-panel"
            role="dialog"
            aria-labelledby="add-employee-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="add-employee-title">Add employee</h2>
              <button type="button" className="icon-btn" onClick={closeAddModal} aria-label="Close">
                ×
              </button>
            </div>
            <p className="muted" style={{ margin: '0 1.25rem 0.5rem' }}>
              HR only. Creates a portal login and fills their job details.
            </p>
            <form className="edit-box add-employee-form" onSubmit={handleAddSubmit}>
              <div className="add-employee-grid">
                <label>
                  Username <span className="req-star" aria-hidden="true">*</span>
                  <input
                    name="username"
                    value={addForm.username}
                    onChange={handleAddChange}
                    required
                    minLength={3}
                    maxLength={30}
                    autoComplete="off"
                    data-input-kind="username"
                  />
                </label>
                <label>
                  Full name <span className="req-star" aria-hidden="true">*</span>
                  <input
                    name="name"
                    value={addForm.name}
                    onChange={handleAddChange}
                    required
                    data-input-kind="text"
                  />
                </label>
                <label>
                  Email <span className="req-star" aria-hidden="true">*</span>
                  <input
                    type="email"
                    name="email"
                    value={addForm.email}
                    onChange={handleAddChange}
                    required
                    autoComplete="off"
                    data-input-kind="email"
                  />
                </label>
                <PasswordInput
                  name="password"
                  label="Temporary password"
                  requiredMark
                  value={addForm.password}
                  onChange={handleAddChange}
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
                <label>
                  Contact number <span className="req-star" aria-hidden="true">*</span>
                  <input
                    name="contact_number"
                    value={addForm.contact_number}
                    onChange={handleAddChange}
                    required
                    inputMode="numeric"
                    data-input-kind="integer"
                  />
                </label>
                <label>
                  Address
                  <input name="address" value={addForm.address} onChange={handleAddChange} />
                </label>
                <label>
                  Employee ID <span className="req-star" aria-hidden="true">*</span>
                  <input
                    name="employee_id"
                    value={addForm.employee_id}
                    onChange={handleAddChange}
                    required
                    placeholder="e.g. EMP-001"
                  />
                </label>
                <label>
                  Status
                  <select name="status" value={addForm.status} onChange={handleAddChange}>
                    <option value="inactive">Inactive / Pending</option>
                    <option value="active">Active</option>
                  </select>
                </label>
                <label>
                  Department / Team <span className="req-star" aria-hidden="true">*</span>
                  <select name="department" value={addForm.department} onChange={handleAddChange} required>
                    <option value="">Select team</option>
                    {departmentOptions.map((dep) => (
                      <option key={dep} value={dep}>
                        {dep}
                      </option>
                    ))}
                  </select>
                </label>
                <DesignationField
                  name="designation"
                  value={addForm.designation}
                  onChange={handleAddChange}
                  required
                  designations={designations}
                  canManage={canAddEmployees}
                  onCreated={handleCreateDesignation}
                  onRemoved={handleRemoveDesignation}
                />
                <label>
                  Branch <span className="req-star" aria-hidden="true">*</span>
                  <select name="branch" value={addForm.branch} onChange={handleAddChange} required>
                    <option value="">Select branch</option>
                    {branchOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Shift <span className="req-star" aria-hidden="true">*</span>
                  <select name="shift" value={addForm.shift} onChange={handleAddChange} required>
                    <option value="">Select shift</option>
                    {shiftOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Work location
                  <select
                    name="employment_type"
                    value={addForm.employment_type}
                    onChange={handleAddChange}
                  >
                    <option value="onsite">Onsite</option>
                    {canRemoteEmployees && <option value="remote">Remote</option>}
                  </select>
                </label>
                <label>
                  Date of joining
                  <input
                    type="date"
                    name="date_of_joining"
                    value={addForm.date_of_joining}
                    onChange={handleAddChange}
                  />
                </label>
                <label>
                  Education
                  <input name="education" value={addForm.education} onChange={handleAddChange} />
                </label>
                <label>
                  Last job status
                  <select
                    name="last_job_status"
                    value={addForm.last_job_status}
                    onChange={handleAddChange}
                  >
                    <option value="">Optional</option>
                    {LAST_JOB_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Bank name
                  <input
                    name="bank_name"
                    value={addForm.bank_name}
                    onChange={handleAddChange}
                    data-input-kind="text"
                  />
                </label>
                <label>
                  Account title
                  <input
                    name="account_title"
                    value={addForm.account_title}
                    onChange={handleAddChange}
                    data-input-kind="text"
                  />
                </label>
                <label>
                  Account number
                  <input
                    name="account_number"
                    value={addForm.account_number}
                    onChange={handleAddChange}
                    inputMode="numeric"
                    data-input-kind="integer"
                  />
                </label>
                <label>
                  IBAN
                  <input name="iban" value={addForm.iban} onChange={handleAddChange} />
                </label>
              </div>
              {addError && <p className="error">{addError}</p>}
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={closeAddModal} disabled={adding}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={adding}>
                  {adding ? 'Creating…' : 'Create employee'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export default EmployeesPage;
