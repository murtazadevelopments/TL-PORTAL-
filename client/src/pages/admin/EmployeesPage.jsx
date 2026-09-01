import { useEffect, useId, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import api from '../../api/client';
import { canAccessAdmin, hasPermission } from '../../utils/permissions';
import { BRANCH_OPTIONS } from '../../utils/employeeScope';
import { withAuthDocumentUrl } from '../../utils/documentUrls';
import ComposeMessageModal from '../../components/ComposeMessageModal';
import UploadEmploymentFormModal from '../../components/UploadEmploymentFormModal';
import CnicProtectedViewer from '../../components/CnicProtectedViewer';
import { missingEmployeePortalFields, profileAlertCooldown } from '../../utils/profileCompleteness';
import { ADMIN_INCOMPLETE_EVENT } from '../../components/AdminIncompleteGate';
import ClockHourSelect from '../../components/ClockHourSelect';
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
  if (s === 'pending' || s === 'active' || s === 'locked') return s;
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
  return 'unset';
}

function isAccountLocked(row) {
  return Boolean(row?.locked_at);
}

function isAccountBlocked(row) {
  return Boolean(row?.blocked_at);
}

function isSignInDisabled(row) {
  return isAccountLocked(row) || isAccountBlocked(row);
}

function employmentStatusLabel(status) {
  if (status === 'active') return 'active';
  if (status === 'inactive') return 'pending';
  return status || 'unset';
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

function missingAdminFields(row) {
  if (!row || isLowerStaffRow(row)) return [];
  return Object.keys(ADMIN_FIELD_LABELS)
    .filter((key) => key !== 'date_of_joining')
    .filter((key) => isBlank(row[key]));
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
  const [showAddBranch, setShowAddBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [branchError, setBranchError] = useState('');

  const [unlockingId, setUnlockingId] = useState(null);
  const [blockingId, setBlockingId] = useState(null);
  const [alertingId, setAlertingId] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeRecipient, setComposeRecipient] = useState(null);
  const [composeToast, setComposeToast] = useState('');
  const [employmentFormOpen, setEmploymentFormOpen] = useState(false);
  const [cnicView, setCnicView] = useState(null);
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
          hasPermission(data.permissions, 'hr:add_employee', data.role);
        if (!canView) {
          setEmployees([]);
          setListError(
            'You do not have permission to view employees. Ask the CEO to grant Add employees (HR) or View employees.'
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
  const canEditEmployees =
    hasPermission(permissions, 'employees:edit', role) || canAddEmployees;
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

  useEffect(() => {
    if (!role) return;
    if (
      canAccessAdmin(role) ||
      hasPermission(permissions, 'employees:view', role) ||
      hasPermission(permissions, 'hr:add_employee', role)
    ) {
      loadTeams();
      loadBranches();
      loadShifts();
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
    const missing = missingEmployeePortalFields(target);
    if (!missing.length) {
      setSaveError('This employee has already filled their portal fields.');
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
    const inactive = portalEmployees.filter((e) => e.status !== 'active').length;
    const pendingId = portalEmployees.filter((e) => isBlank(e.employee_id)).length;
    const locked = portalEmployees.filter((e) => isSignInDisabled(e)).length;
    return { total, active, inactive, pendingId, locked };
  }, [portalEmployees]);

  const departmentOptions = useMemo(() => {
    const fromTeams = teams.map((t) => String(t.name).trim()).filter(Boolean);
    const fromEmployees = employees
      .map((e) => e.department)
      .filter((d) => d != null && String(d).trim() !== '')
      .map((d) => String(d).trim());
    return [...new Set([...fromTeams, ...fromEmployees])].sort((a, b) =>
      a.localeCompare(b)
    );
  }, [employees, teams]);

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
    const pending = portalEmployees.filter((e) => e.status !== 'active').length;
    const locked = portalEmployees.filter((e) => isSignInDisabled(e)).length;
    return { active, pending, locked, lower: lowerStaff.length };
  }, [portalEmployees, lowerStaff]);

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
      if (statusTab === 'pending' && e.status === 'active') return false;
      if (statusTab === 'inactive' && e.status !== 'inactive') return false;
      if (statusTab === 'locked' && !isSignInDisabled(e)) return false;

      if (filters.status !== 'all' && e.status !== filters.status) return false;
      if (
        filters.department !== 'all' &&
        String(e.department || '').trim() !== filters.department
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

  const detailMissingAdmin = useMemo(
    () => missingAdminFields(detail).map((key) => ADMIN_FIELD_LABELS[key]),
    [detail]
  );
  const detailMissingEmployee = useMemo(
    () => missingEmployeePortalFields(detail).map((f) => f.label),
    [detail]
  );

  async function openDetail(id) {
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    setSaveError('');
    setSaveSuccess('');
    setFieldErrors({});

    try {
      const { data } = await api.get(`/api/admin/employees/${id}`);
      setDetail(data);
      setEditForm({
        employee_id: data.employee_id || '',
        status: data.status === 'inactive' ? 'inactive' : data.status === 'active' ? 'active' : 'inactive',
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

  async function handleSave(e) {
    e.preventDefault();
    if (!selectedId) return;
    if (!canEditEmployees) {
      setSaveError('You do not have permission to edit employees.');
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
      return;
    }
    setDeletingLowerId(row.id);
    setLowerError('');
    try {
      await api.delete(`/api/admin/employees/${row.id}/lower-staff`);
      if (editingLowerId === row.id) cancelEditLowerStaff();
      await loadEmployees();
    } catch (err) {
      setLowerError(err.response?.data?.message || 'Failed to delete subordinate staff.');
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
          </select>

          <select
            className="filter-select"
            name="department"
            value={filters.department}
            onChange={handleFilterChange}
            aria-label="Filter by department"
          >
            <option value="all">Department: All</option>
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

        {statusTab === 'subordinate-staff' && canAddEmployees && (
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
                : employees.length === 0
                  ? 'No employees found yet.'
                  : 'No employees match your search or filters.'}
            </div>
          )}

          {!loading && !listError && filtered.length > 0 && statusTab === 'subordinate-staff' && (
            <table className="admin-table lower-staff-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Branch</th>
                  <th>Salary</th>
                  <th>CNIC</th>
                  <th>Extra info</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const extraBits = [extraSlotSummary(row, 1), extraSlotSummary(row, 2)].filter(
                    Boolean
                  );
                  return (
                    <tr
                      key={row.id}
                      className={editingLowerId === row.id ? 'lower-staff-row-editing' : undefined}
                    >
                      <td className="cell-name">{fullName(row)}</td>
                      <td>{row.branch || '—'}</td>
                      <td>{formatSalaryAmount(row.salary)}</td>
                      <td>
                        {row.cnic_front_url || row.cnic_back_url ? (
                          <span className="lower-pill-row">
                            {row.cnic_front_url && <span className="lower-pill">Front</span>}
                            {row.cnic_back_url && <span className="lower-pill">Back</span>}
                          </span>
                        ) : (
                          <span className="muted-cell">None</span>
                        )}
                      </td>
                      <td>
                        {extraBits.length ? (
                          <span className="lower-pill-row">
                            {extraBits.map((bit, i) => (
                              <span className="lower-pill lower-pill-cyan" key={`${i}-${bit}`}>
                                {bit}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="muted-cell">None</span>
                        )}
                      </td>
                      <td className="col-actions">
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={deletingLowerId === row.id}
                            onClick={() => startEditLowerStaff(row)}
                          >
                            {editingLowerId === row.id ? 'Editing' : 'Edit'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger"
                            disabled={deletingLowerId === row.id}
                            onClick={() => handleDeleteLowerStaff(row)}
                          >
                            {deletingLowerId === row.id ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {!loading && !listError && filtered.length > 0 && statusTab !== 'subordinate-staff' && (
            <table className="admin-table">
              <thead>
                <tr>
                  {canSendProfileAlert && <th>Alert</th>}
                  <th>Photo</th>
                  <th>Full Name</th>
                  <th>Username</th>
                  <th>Employee ID</th>
                  <th>Department</th>
                  <th>Designation</th>
                  <th>Branch</th>
                  <th>Shift</th>
                  <th>Status</th>
                  {canSendMessages && <th>Message</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const missingAdmin = missingAdminFields(row);
                  const missingEmployee = missingEmployeePortalFields(row);
                  const incomplete = missingAdmin.length > 0 || missingEmployee.length > 0;
                  const alertCooldown = profileAlertCooldown(row, nowMs);
                  return (
                    <tr key={row.id} onClick={() => openDetail(row.id)}>
                      {canSendProfileAlert && (
                        <td className="cell-alert">
                          {missingEmployee.length > 0 ? (
                            <button
                              type="button"
                              className="btn btn-ghost alert-row-btn"
                              title={
                                alertCooldown.active
                                  ? `Already sent. Try again in ${alertCooldown.remainingLabel}`
                                  : `Ask them to fill: ${missingEmployee.map((f) => f.label).join(', ')}`
                              }
                              aria-label={
                                alertCooldown.active
                                  ? `Alert available in ${alertCooldown.remainingLabel}`
                                  : `Alert ${fullName(row)} to complete portal fields`
                              }
                              disabled={alertingId === row.id || alertCooldown.active}
                              onClick={(e) => handleSendProfileAlert(row.id, e)}
                            >
                              {alertingId === row.id
                                ? '…'
                                : alertCooldown.active
                                  ? `Wait ${alertCooldown.remainingLabel}`
                                  : 'Alert'}
                            </button>
                          ) : (
                            <span className="muted-cell">—</span>
                          )}
                        </td>
                      )}
                      <td>
                        {row.profile_picture_url ? (
                          <img
                            className="thumb"
                            src={withAuthDocumentUrl(row.profile_picture_url, row.updated_at || row.id)}
                            alt=""
                          />
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
                          {isAccountBlocked(row) && (
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
                          )}
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
                      </td>
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
      </div>

      {composeToast && <p className="success">{composeToast}</p>}

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
              <button type="button" className="icon-btn" onClick={closeDetail} aria-label="Close">
                ×
              </button>
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
                      {profileAlertCooldown(detail, nowMs).active && (
                        <p className="muted" style={{ margin: '0.35rem 0 0' }}>
                          Next alert available in {profileAlertCooldown(detail, nowMs).remainingLabel}.
                        </p>
                      )}
                    </div>
                    {canSendProfileAlert && detailMissingEmployee.length > 0 && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={
                          alertingId === detail.id ||
                          profileAlertCooldown(detail, nowMs).active
                        }
                        onClick={(e) => handleSendProfileAlert(detail.id, e)}
                      >
                        {alertingId === detail.id
                          ? 'Sending…'
                          : profileAlertCooldown(detail, nowMs).active
                            ? `Wait ${profileAlertCooldown(detail, nowMs).remainingLabel}`
                            : 'Alert employee'}
                      </button>
                    )}
                  </div>
                )}

                <div className="detail-hero">
                  {detail.profile_picture_url ? (
                    <img
                      className="thumb large"
                      src={withAuthDocumentUrl(detail.profile_picture_url, detail.updated_at || detail.id)}
                      alt=""
                    />
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
                    <div className="status-stack" style={{ marginTop: '0.45rem' }}>
                      <span className={`status-pill ${statusClass(detail.status)}`}>
                        {employmentStatusLabel(detail.status)}
                      </span>
                      {isAccountBlocked(detail) && (
                        <span className="status-pill locked">blocked</span>
                      )}
                      {isAccountLocked(detail) && (
                        <span className="status-pill locked">
                          locked
                          {detail.failed_login_attempts
                            ? ` · ${detail.failed_login_attempts} attempts`
                            : ''}
                        </span>
                      )}
                      {!isSignInDisabled(detail) && (
                        <span className="status-pill active">login ok</span>
                      )}
                    </div>
                    {isAccountBlocked(detail) && (
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
                  <p>
                    <span className="label">Education</span>
                    <strong>{detail.education || '—'}</strong>
                  </p>
                  <p>
                    <span className="label">Last job status</span>
                    <strong>{detail.last_job_status || '—'}</strong>
                  </p>
                  <p>
                    <span className="label">Employment type</span>
                    <strong>
                      {detail.employment_type === 'onsite'
                        ? 'Onsite'
                        : detail.employment_type === 'remote'
                          ? 'Remote'
                          : detail.employment_type || '—'}
                    </strong>
                  </p>
                  <p>
                    <span className="label">Email</span>
                    <strong>{detail.email || '—'}</strong>
                  </p>
                  <p>
                    <span className="label">CNIC</span>
                    <strong>{detail.cnic_number || '—'}</strong>
                  </p>
                  <p>
                    <span className="label">Contact</span>
                    <strong>{detail.contact_number || '—'}</strong>
                  </p>
                  <p>
                    <span className="label">Address</span>
                    <strong>{detail.address || '—'}</strong>
                  </p>
                  <p>
                    <span className="label">Account created</span>
                    <strong>
                      {detail.date_joined
                        ? new Date(detail.date_joined).toLocaleDateString()
                        : '—'}
                    </strong>
                  </p>
                  <p>
                    <span className="label">Reference person</span>
                    <strong>{detail.reference_person_name || '—'}</strong>
                  </p>
                  <p>
                    <span className="label">Emergency contact</span>
                    <strong>
                      {[detail.emergency_contact_name, detail.emergency_contact_number]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </strong>
                  </p>
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
                  <a
                    className="cv-link"
                    href={withAuthDocumentUrl(
                      detail.employment_form_url,
                      detail.updated_at || detail.id
                    )}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download Employment Form (PDF)
                  </a>
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
                  <p>
                    <span className="label">Bank name</span>
                    <strong>{detail.bank_name || '—'}</strong>
                  </p>
                  <p>
                    <span className="label">Account title</span>
                    <strong>{detail.account_title || '—'}</strong>
                  </p>
                  <p>
                    <span className="label">IBAN</span>
                    <strong>{detail.iban || '—'}</strong>
                  </p>
                  <p>
                    <span className="label">Account number</span>
                    <strong>{detail.account_number || '—'}</strong>
                  </p>
                </div>

                </div>

                <div className="detail-subsection">
                <h3>Admin fields</h3>
                {!canEditEmployees && (
                  <p className="muted" style={{ marginBottom: '0.75rem' }}>
                    You can view this profile but cannot edit admin fields (needs employees:edit).
                  </p>
                )}
                <form className="edit-box" onSubmit={handleSave} noValidate>
                  <fieldset disabled={!canEditEmployees}>
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

                  <label className={fieldErrors.designation ? 'has-error' : ''}>
                    Designation
                    <input
                      type="text"
                      name="designation"
                      value={editForm.designation}
                      onChange={handleEditChange}
                    />
                    {fieldErrors.designation && (
                      <span className="field-error">{fieldErrors.designation}</span>
                    )}
                  </label>

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
                      <option value="onsite">Onsite</option>
                      <option value="remote">Remote</option>
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
                    {canSendProfileAlert && detailMissingEmployee.length > 0 && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={
                          alertingId === detail.id ||
                          saving ||
                          deactivating ||
                          profileAlertCooldown(detail, nowMs).active
                        }
                        onClick={(e) => handleSendProfileAlert(detail.id, e)}
                      >
                        {alertingId === detail.id
                          ? 'Sending…'
                          : profileAlertCooldown(detail, nowMs).active
                            ? `Wait ${profileAlertCooldown(detail, nowMs).remainingLabel}`
                            : 'Alert profile'}
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
                    {canDeactivateEmployees && (
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
                    {canEditEmployees && (
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

      <UploadEmploymentFormModal
        open={employmentFormOpen}
        employee={detail}
        onClose={() => setEmploymentFormOpen(false)}
        onSuccess={() => {
          setComposeToast('Employment form PDF saved.');
          if (detail?.id) openDetail(detail.id);
        }}
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
                  />
                </label>
                <label>
                  Full name <span className="req-star" aria-hidden="true">*</span>
                  <input name="name" value={addForm.name} onChange={handleAddChange} required />
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
                  />
                </label>
                <label>
                  Temporary password <span className="req-star" aria-hidden="true">*</span>
                  <input
                    type="text"
                    name="password"
                    value={addForm.password}
                    onChange={handleAddChange}
                    required
                    minLength={6}
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  Contact number <span className="req-star" aria-hidden="true">*</span>
                  <input
                    name="contact_number"
                    value={addForm.contact_number}
                    onChange={handleAddChange}
                    required
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
                <label>
                  Designation <span className="req-star" aria-hidden="true">*</span>
                  <input
                    name="designation"
                    value={addForm.designation}
                    onChange={handleAddChange}
                    required
                  />
                </label>
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
                    <option value="remote">Remote</option>
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
                  <input name="bank_name" value={addForm.bank_name} onChange={handleAddChange} />
                </label>
                <label>
                  Account title
                  <input
                    name="account_title"
                    value={addForm.account_title}
                    onChange={handleAddChange}
                  />
                </label>
                <label>
                  Account number
                  <input
                    name="account_number"
                    value={addForm.account_number}
                    onChange={handleAddChange}
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
