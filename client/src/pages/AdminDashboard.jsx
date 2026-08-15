import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import api from '../api/client';
import Navbar from '../components/Navbar';
import AssignRoleModal from '../components/AssignRoleModal';
import { canAccessAdmin, hasPermission, isCeo } from '../utils/permissions';
import './AdminDashboard.css';

const BRANCH_OPTIONS = ['Head Office', 'Unit', 'Branch', 'Amir Chamber'];
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

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function missingAdminFields(row) {
  if (!row) return [];
  // date_of_joining is optional for save validation of incomplete banner
  return Object.keys(ADMIN_FIELD_LABELS)
    .filter((key) => key !== 'date_of_joining')
    .filter((key) => isBlank(row[key]));
}

function AdminDashboard() {
  const navigate = useNavigate();
  const [role, setRole] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [statusTab, setStatusTab] = useState('all');

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

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignInitial, setAssignInitial] = useState(null);
  const [assignBanner, setAssignBanner] = useState('');
  const [roleHolders, setRoleHolders] = useState([]);
  const [holdersLoading, setHoldersLoading] = useState(false);
  const [holdersError, setHoldersError] = useState('');

  const loadRoleHolders = useCallback(async () => {
    setHoldersLoading(true);
    setHoldersError('');
    try {
      const { data } = await api.get('/api/admin/role-holders');
      setRoleHolders(Array.isArray(data?.holders) ? data.holders : []);
    } catch (err) {
      setHoldersError(
        err.response?.data?.message ||
          err.response?.data?.error ||
          'Failed to load current admins.'
      );
    } finally {
      setHoldersLoading(false);
    }
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
        // Load list in the same flow so CEO/admin never sit on an empty table
        setLoading(true);
        setListError('');
        const canView = isCeo(data.role) || hasPermission(data.permissions, 'employees:view');
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
          if (isCeo(data.role)) {
            try {
              const { data: holdersData } = await api.get('/api/admin/role-holders');
              if (!active) return;
              setRoleHolders(Array.isArray(holdersData?.holders) ? holdersData.holders : []);
            } catch (holdersErr) {
              if (!active) return;
              setHoldersError(
                holdersErr.response?.data?.message || 'Failed to load current admins.'
              );
            }
          }
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

  const canEditEmployees =
    isCeo(role) || hasPermission(permissions, 'employees:edit');
  const canDeactivateEmployees =
    isCeo(role) || hasPermission(permissions, 'employees:deactivate');
  const canViewDocuments =
    isCeo(role) || hasPermission(permissions, 'documents:view');
  const canCreateTeams =
    isCeo(role) || hasPermission(permissions, 'teams:create');

  async function loadTeams() {
    try {
      const { data } = await api.get('/api/admin/teams');
      setTeams(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('Failed to load teams:', err.response?.data?.message || err.message);
    }
  }

  useEffect(() => {
    if (!role) return;
    if (isCeo(role) || hasPermission(permissions, 'employees:view') || canAccessAdmin(role)) {
      loadTeams();
    }
  }, [role, permissions]);

  const stats = useMemo(() => {
    const total = employees.length;
    const active = employees.filter((e) => e.status === 'active').length;
    const inactive = employees.filter((e) => e.status !== 'active').length;
    const pendingId = employees.filter((e) => isBlank(e.employee_id)).length;
    return { total, active, inactive, pendingId };
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

  const tabCounts = useMemo(() => {
    const active = employees.filter((e) => e.status === 'active').length;
    const pending = employees.filter((e) => e.status !== 'active').length;
    return { active, pending };
  }, [employees]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return employees.filter((e) => {
      if (statusTab === 'active' && e.status !== 'active') return false;
      if (statusTab === 'pending' && e.status === 'active') return false;
      if (statusTab === 'inactive' && e.status !== 'inactive') return false;

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

  function closeDetail() {
    setSelectedId(null);
    setDetail(null);
    setSaveError('');
    setSaveSuccess('');
    setFieldErrors({});
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
    if (
      !isBlank(editForm.salary) &&
      Number.isNaN(Number(editForm.salary))
    ) {
      errors.salary = 'Salary must be a valid number.';
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
      date_of_joining: editForm.date_of_joining
        ? editForm.date_of_joining
        : null,
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
                profile_picture_url: data.profile_picture_url || row.profile_picture_url,
              }
            : row
        )
      );
    } catch (err) {
      setSaveError(err.response?.data?.message || 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem('token');
    navigate('/');
  }

  if (checkingAuth) {
    return (
      <div className="page">
        <Navbar showLogout onLogout={handleLogout} />
        <div className="admin-page">
          <div className="admin-loading">
            <div className="spinner" />
            Checking admin access…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <Navbar showLogout onLogout={handleLogout} role={role} />

      <div className="admin-page">
        <div className="admin-toolbar" style={{ marginTop: 0 }}>
          <div>
            <h1>Admin Panel</h1>
            <p className="muted" style={{ margin: 0 }}>
              Manage employee records, IDs, and assignments
            </p>
          </div>
          {isCeo(role) && (
            <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
              <Link to="/admin/login-logs" className="btn btn-ghost">
                Check Logs
              </Link>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setAssignInitial(null);
                  setAssignOpen(true);
                }}
              >
                Assign Admin Role
              </button>
            </div>
          )}
        </div>

        {assignBanner && (
          <p className="success assign-banner" role="status">
            {assignBanner}
          </p>
        )}

        {isCeo(role) && (
          <section className="ceo-role-section" aria-label="Current admins">
            <div className="ceo-role-header">
              <div>
                <h2>Current Admins</h2>
                <p className="muted" style={{ margin: 0 }}>
                  People with admin or CEO access and their permission scopes
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={holdersLoading}
                onClick={loadRoleHolders}
              >
                {holdersLoading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>

            {holdersError && <p className="error">{holdersError}</p>}

            {!holdersError && holdersLoading && roleHolders.length === 0 && (
              <div className="admin-loading">
                <div className="spinner" />
                Loading role holders…
              </div>
            )}

            {!holdersError && !holdersLoading && roleHolders.length === 0 && (
              <div className="admin-empty">No admin or CEO accounts found.</div>
            )}

            {roleHolders.length > 0 && (
              <div className="table-shell">
                <table className="admin-table role-holders-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Employee ID</th>
                      <th>Role</th>
                      <th>Permissions</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {roleHolders.map((row) => (
                      <tr key={row.id}>
                        <td className="cell-name">{fullName(row)}</td>
                        <td>{row.employee_id || '—'}</td>
                        <td>
                          <span className={`status-pill ${row.role === 'ceo' ? 'active' : 'unset'}`}>
                            {row.role}
                          </span>
                        </td>
                        <td>
                          {row.role === 'ceo' ? (
                            <span className="muted">Full access (CEO bypass)</span>
                          ) : Array.isArray(row.permissions) && row.permissions.length > 0 ? (
                            <div className="perm-chip-row">
                              {row.permissions.map((key) => (
                                <span key={key} className="perm-chip">
                                  {key}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="muted">None</span>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => {
                              setAssignInitial(row);
                              setAssignOpen(true);
                            }}
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

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
        </section>

        <div className="status-tabs">
          <button
            type="button"
            className={`status-tab ${statusTab === 'all' ? 'active' : ''}`}
            onClick={() => setStatusTab('all')}
          >
            All <span className="tab-badge">{employees.length}</span>
          </button>
          <button
            type="button"
            className={`status-tab ${statusTab === 'active' ? 'active' : ''}`}
            onClick={() => setStatusTab('active')}
          >
            Active <span className="tab-badge">{tabCounts.active}</span>
          </button>
          <button
            type="button"
            className={`status-tab ${statusTab === 'pending' ? 'active' : ''}`}
            onClick={() => setStatusTab('pending')}
          >
            Pending Approval <span className="tab-badge">{tabCounts.pending}</span>
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
            {BRANCH_OPTIONS.map((opt) => (
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
                  <th>Photo</th>
                  <th>Full Name</th>
                  <th>Username</th>
                  <th>Employee ID</th>
                  <th>Department</th>
                  <th>Designation</th>
                  <th>Branch</th>
                  <th>Shift</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const incomplete = missingAdminFields(row).length > 0;
                  return (
                    <tr key={row.id} onClick={() => openDetail(row.id)}>
                      <td>
                        {row.profile_picture_url ? (
                          <img className="thumb" src={row.profile_picture_url} alt="" />
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
                              title="Admin assignment incomplete"
                              aria-label="Incomplete admin fields"
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
                        <span className={`status-pill ${statusClass(row.status)}`}>
                          {row.status === 'active'
                            ? 'active'
                            : row.status === 'inactive'
                              ? 'pending'
                              : row.status || 'unset'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <AssignRoleModal
        open={assignOpen}
        initialUser={assignInitial}
        onClose={() => {
          setAssignOpen(false);
          setAssignInitial(null);
        }}
        onSuccess={({ message, user }) => {
          setAssignBanner(message);
          setEmployees((prev) =>
            prev.map((row) =>
              user?.id && row.id === user.id ? { ...row, role: user.role } : row
            )
          );
          loadRoleHolders();
          window.setTimeout(() => setAssignBanner(''), 5000);
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
                {detailMissingAdmin.length > 0 && (
                  <div className="alert-banner admin-incomplete" role="status">
                    <div>
                      <strong>This employee&apos;s profile is incomplete.</strong>
                      <p className="muted" style={{ margin: '0.35rem 0 0' }}>
                        Missing: {detailMissingAdmin.join(', ')}
                      </p>
                    </div>
                  </div>
                )}

                <div className="detail-hero">
                  {detail.profile_picture_url ? (
                    <img className="thumb large" src={detail.profile_picture_url} alt="" />
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
                  </div>
                </div>

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

                <h3 className="section-title">Documents</h3>
                {!canViewDocuments || detail.documents_redacted ? (
                  <p className="muted">
                    Document access is restricted for your admin role (needs documents:view).
                  </p>
                ) : (
                  <>
                <div className="doc-row">
                  <a
                    className="doc-preview"
                    href={detail.cnic_front_url || undefined}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {detail.cnic_front_url ? (
                      <img src={detail.cnic_front_url} alt="CNIC front" />
                    ) : (
                      <span>No CNIC front</span>
                    )}
                    <span>CNIC front</span>
                  </a>
                  <a
                    className="doc-preview"
                    href={detail.cnic_back_url || undefined}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {detail.cnic_back_url ? (
                      <img src={detail.cnic_back_url} alt="CNIC back" />
                    ) : (
                      <span>No CNIC back</span>
                    )}
                    <span>CNIC back</span>
                  </a>
                </div>
                {detail.cv_url ? (
                  <a className="cv-link" href={detail.cv_url} target="_blank" rel="noreferrer">
                    Download CV (PDF)
                  </a>
                ) : (
                  <p className="muted">No CV uploaded.</p>
                )}
                  </>
                )}

                <h3 className="section-title">Bank details</h3>
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

                <h3 className="section-title">Admin fields</h3>
                {!canEditEmployees && (
                  <p className="muted" style={{ marginBottom: '0.75rem' }}>
                    You can view this profile but cannot edit admin fields (needs employees:edit).
                  </p>
                )}
                <form className="edit-box" onSubmit={handleSave} noValidate>
                  <fieldset disabled={!canEditEmployees} style={{ border: 0, margin: 0, padding: 0 }}>
                  <label className={fieldErrors.employee_id ? 'has-error' : ''}>
                    Employee ID
                    <input
                      type="text"
                      name="employee_id"
                      value={editForm.employee_id}
                      onChange={handleEditChange}
                      placeholder="e.g. EMP-001"
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
                    <div style={{ marginTop: '-0.35rem', marginBottom: '0.75rem' }}>
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
                      {BRANCH_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                    {fieldErrors.branch && (
                      <span className="field-error">{fieldErrors.branch}</span>
                    )}
                  </label>

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
                    Salary
                    <input
                      type="number"
                      name="salary"
                      value={editForm.salary}
                      onChange={handleEditChange}
                      min="0"
                      step="1"
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
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

export default AdminDashboard;
