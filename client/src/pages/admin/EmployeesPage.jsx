import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import api from '../../api/client';
import { canAccessAdmin, hasPermission } from '../../utils/permissions';
import { BRANCH_OPTIONS } from '../../utils/employeeScope';
import { withAuthDocumentUrl } from '../../utils/documentUrls';
import ComposeMessageModal from '../../components/ComposeMessageModal';
import UploadEmploymentFormModal from '../../components/UploadEmploymentFormModal';
import { missingEmployeePortalFields, profileAlertCooldown } from '../../utils/profileCompleteness';
import { ADMIN_INCOMPLETE_EVENT } from '../../components/AdminIncompleteGate';
import ClockHourSelect from '../../components/ClockHourSelect';
import './AdminDashboard.css';

const SHIFT_OPTIONS = ['Evening', 'Night'];

const ADMIN_FIELD_LABELS = {
  employee_id: 'Employee ID',
  status: 'Status',
  department: 'Department / Team',
  designation: 'Designation',
  branch: 'Branch',
  shift: 'Shift',
  salary: 'Salary',
  date_of_joining: 'Date of joining',
};

const EMPTY_EDIT = {
  employee_id: '',
  status: 'inactive',
  department: '',
  designation: '',
  branch: '',
  shift: '',
  salary: '',
  date_of_joining: '',
  employment_type: 'onsite',
  work_start_hour: 9,
  work_end_hour: 18,
};

const EMPTY_FILTERS = {
  status: 'all',
  department: 'all',
  branch: 'all',
  shift: 'all',
};

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

function isSalaryMissing(value) {
  if (isBlank(value)) return true;
  const n = Number(value);
  return !Number.isFinite(n) || n <= 0;
}

function missingAdminFields(row) {
  if (!row) return [];
  return Object.keys(ADMIN_FIELD_LABELS)
    .filter((key) => key !== 'date_of_joining')
    .filter((key) => (key === 'salary' ? isSalaryMissing(row[key]) : isBlank(row[key])));
}

function EmployeesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [role, setRole] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [statusTab, setStatusTab] = useState(() => {
    const s = searchParams.get('status');
    return s === 'pending' || s === 'active' || s === 'locked' ? s : 'all';
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

  useEffect(() => {
    const s = searchParams.get('status');
    const next = s === 'pending' || s === 'active' || s === 'locked' ? s : 'all';
    setStatusTab(next);
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
        // Load list in the same flow so CEO/admin never sit on an empty table
        setLoading(true);
        setListError('');
        const canView = hasPermission(data.permissions, 'employees:view', data.role);
        if (!canView) {
          setEmployees([]);
          setListError(
            'You do not have permission to view employees. Ask the CEO to grant employees:view (and other scopes) on your admin role.'
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

  const canEditEmployees = hasPermission(permissions, 'employees:edit', role);
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

  useEffect(() => {
    if (!role) return;
    if (canAccessAdmin(role) || hasPermission(permissions, 'employees:view', role)) {
      loadTeams();
      loadBranches();
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

  const stats = useMemo(() => {
    const total = employees.length;
    const active = employees.filter((e) => e.status === 'active').length;
    const inactive = employees.filter((e) => e.status !== 'active').length;
    const pendingId = employees.filter((e) => isBlank(e.employee_id)).length;
    const locked = employees.filter((e) => isSignInDisabled(e)).length;
    return { total, active, inactive, pendingId, locked };
  }, [employees]);

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
    return [...new Set([...fromCatalog, ...fromEmployees])].sort((a, b) =>
      a.localeCompare(b)
    );
  }, [employees, branches]);

  const tabCounts = useMemo(() => {
    const active = employees.filter((e) => e.status === 'active').length;
    const pending = employees.filter((e) => e.status !== 'active').length;
    const locked = employees.filter((e) => isSignInDisabled(e)).length;
    return { active, pending, locked };
  }, [employees]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return employees.filter((e) => {
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
  }, [employees, search, filters, statusTab]);

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
        salary: data.salary ?? '',
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
    if (isSalaryMissing(editForm.salary)) {
      errors.salary = 'Salary is required and must be greater than 0.';
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
      salary: Number(editForm.salary),
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
                salary: data.salary,
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
            All <span className="tab-badge">{employees.length}</span>
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
        </div>

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
            {SHIFT_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>

          <button type="button" className="btn btn-ghost" onClick={clearFilters}>
            Clear filters
          </button>
        </div>

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
              {employees.length === 0
                ? 'No employees found yet.'
                : 'No employees match your search or filters.'}
            </div>
          )}

          {!loading && !listError && filtered.length > 0 && (
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
                  <div className="doc-preview">
                    <span>
                      {detail.cnic_front_on_file ? 'On file' : 'No CNIC front'}
                    </span>
                    <span>CNIC front</span>
                    <span className="muted" style={{ fontSize: '0.8rem' }}>
                      Not downloadable
                    </span>
                  </div>
                  <div className="doc-preview">
                    <span>
                      {detail.cnic_back_on_file ? 'On file' : 'No CNIC back'}
                    </span>
                    <span>CNIC back</span>
                    <span className="muted" style={{ fontSize: '0.8rem' }}>
                      Not downloadable
                    </span>
                  </div>
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
                      {SHIFT_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                    {fieldErrors.shift && (
                      <span className="field-error">{fieldErrors.shift}</span>
                    )}
                  </label>

                  <label className={fieldErrors.salary ? 'has-error' : ''}>
                    Salary <span className="req-star" aria-hidden="true">*</span>
                    <input
                      type="number"
                      name="salary"
                      value={editForm.salary}
                      onChange={handleEditChange}
                      min="1"
                      step="1"
                      required
                      aria-required="true"
                    />
                    {fieldErrors.salary && (
                      <span className="field-error">{fieldErrors.salary}</span>
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
    </>
  );
}

export default EmployeesPage;
