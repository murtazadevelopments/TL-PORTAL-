import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import Navbar from '../components/Navbar';
import './AdminDashboard.css';

const BRANCH_OPTIONS = ['Head Office', 'Unit', 'Branch', 'Amir Chamber'];
const SHIFT_OPTIONS = ['Evening', 'Night'];

const ADMIN_FIELD_LABELS = {
  employee_id: 'Employee ID',
  status: 'Status',
  department: 'Department',
  designation: 'Designation',
  branch: 'Branch',
  shift: 'Shift',
  salary: 'Salary',
};

const EMPTY_EDIT = {
  employee_id: '',
  status: 'active',
  department: '',
  designation: '',
  branch: '',
  shift: '',
  salary: '',
};

const EMPTY_FILTERS = {
  status: 'all',
  department: 'all',
  branch: 'all',
  shift: 'all',
};

function fullName(row) {
  return [row.first_name, row.father_name].filter(Boolean).join(' ') || '—';
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
  return Object.keys(ADMIN_FIELD_LABELS).filter((key) => isBlank(row[key]));
}

function AdminDashboard() {
  const navigate = useNavigate();
  const [role, setRole] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [statusTab, setStatusTab] = useState('active');

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editForm, setEditForm] = useState(EMPTY_EDIT);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');

  useEffect(() => {
    let active = true;

    async function verifyAdmin() {
      try {
        const { data } = await api.get('/api/users/me');
        if (!active) return;
        if (data.role !== 'admin') {
          navigate('/dashboard', { replace: true });
          return;
        }
        setRole(data.role);
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
        navigate('/dashboard', { replace: true });
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

  useEffect(() => {
    if (role === 'admin') loadEmployees();
  }, [role]);

  const stats = useMemo(() => {
    const total = employees.length;
    const active = employees.filter((e) => e.status === 'active').length;
    const inactive = employees.filter((e) => e.status === 'inactive').length;
    const pendingId = employees.filter((e) => isBlank(e.employee_id)).length;
    return { total, active, inactive, pendingId };
  }, [employees]);

  const departmentOptions = useMemo(() => {
    const values = [
      ...new Set(
        employees
          .map((e) => e.department)
          .filter((d) => d != null && String(d).trim() !== '')
          .map((d) => String(d).trim())
      ),
    ];
    return values.sort((a, b) => a.localeCompare(b));
  }, [employees]);

  const tabCounts = useMemo(() => {
    const active = employees.filter((e) => e.status === 'active').length;
    const inactive = employees.filter((e) => e.status === 'inactive').length;
    return { active, inactive };
  }, [employees]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return employees.filter((e) => {
      // Active / Inactive tab
      if (statusTab === 'active' && e.status !== 'active') return false;
      if (statusTab === 'inactive' && e.status !== 'inactive') return false;

      // Dropdown filters
      if (filters.status !== 'all' && e.status !== filters.status) return false;
      if (
        filters.department !== 'all' &&
        String(e.department || '').trim() !== filters.department
      ) {
        return false;
      }
      if (filters.branch !== 'all' && e.branch !== filters.branch) return false;
      if (filters.shift !== 'all' && e.shift !== filters.shift) return false;

      // Search
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
        status: data.status === 'inactive' ? 'inactive' : data.status === 'active' ? 'active' : '',
        department: data.department || '',
        designation: data.designation || '',
        branch: data.branch || '',
        shift: data.shift || '',
        salary: data.salary ?? '',
      });
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

  async function handleSave(e) {
    e.preventDefault();
    if (!selectedId) return;

    const errors = validateAdminForm();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setSaveError('All fields are required before saving.');
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
        <h1>Admin Panel</h1>
        <p className="muted">Manage employee records, IDs, and assignments</p>

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
            <span className="stat-label">Inactive</span>
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
            className={`status-tab ${statusTab === 'active' ? 'active' : ''}`}
            onClick={() => setStatusTab('active')}
          >
            Active <span className="tab-badge">{tabCounts.active}</span>
          </button>
          <button
            type="button"
            className={`status-tab ${statusTab === 'inactive' ? 'active' : ''}`}
            onClick={() => setStatusTab('inactive')}
          >
            Inactive <span className="tab-badge">{tabCounts.inactive}</span>
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
            <option value="inactive">Inactive</option>
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
                            {(row.first_name || '?').charAt(0).toUpperCase()}
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
                          {row.status || 'unset'}
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
                      {(detail.first_name || '?').charAt(0).toUpperCase()}
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
                    <span className="label">Date of joining</span>
                    <strong>
                      {detail.date_of_joining
                        ? new Date(detail.date_of_joining).toLocaleDateString()
                        : detail.date_joined
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
                <form className="edit-box" onSubmit={handleSave} noValidate>
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
                      <option value="inactive">Inactive</option>
                    </select>
                    {fieldErrors.status && (
                      <span className="field-error">{fieldErrors.status}</span>
                    )}
                  </label>

                  <label className={fieldErrors.department ? 'has-error' : ''}>
                    Department / Team
                    <input
                      type="text"
                      name="department"
                      value={editForm.department}
                      onChange={handleEditChange}
                    />
                    {fieldErrors.department && (
                      <span className="field-error">{fieldErrors.department}</span>
                    )}
                  </label>

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

                  {saveError && <p className="error">{saveError}</p>}
                  {saveSuccess && <p className="success">{saveSuccess}</p>}

                  <div className="modal-actions">
                    <button type="button" className="btn btn-ghost" onClick={closeDetail}>
                      Close
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={saving}>
                      {saving ? 'Saving…' : 'Save Changes'}
                    </button>
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
