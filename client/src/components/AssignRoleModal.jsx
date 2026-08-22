import { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
<<<<<<< HEAD
import { BRANCH_OPTIONS } from '../constants/branches';
=======
import {
  BRANCH_OPTIONS,
  describeEmployeeScope,
  isScopedEmployeePermission,
  normalizeEmployeeScope,
} from '../utils/employeeScope';
>>>>>>> 26cb648ec4b238983f2472c30081ce976617c1cc
import './AssignRoleModal.css';

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'team_leader', label: 'Team Leader' },
  { value: 'employee', label: 'Employee' },
  { value: 'ceo', label: 'CEO' },
];

function employeeLabel(row) {
  const name = row?.name || 'Unnamed';
  const empId = row?.employee_id || 'No ID';
  return `${name} — ${empId}`;
}

function defaultScopesFromUser(user) {
  const scopes = {};
  const incoming = user?.scopes && typeof user.scopes === 'object' ? user.scopes : {};
  for (const key of ['employees:view', 'employees:edit']) {
    scopes[key] = normalizeEmployeeScope(incoming[key]);
  }
  return scopes;
}

/**
 * CEO-only modal to assign role + optional admin permission scopes.
 */
function AssignRoleModal({ open, onClose, onSuccess, initialUser = null }) {
  const [employees, setEmployees] = useState([]);
  const [catalog, setCatalog] = useState([]);
<<<<<<< HEAD
=======
  const [teams, setTeams] = useState([]);
>>>>>>> 26cb648ec4b238983f2472c30081ce976617c1cc
  const [branchOptions, setBranchOptions] = useState(BRANCH_OPTIONS);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [metaError, setMetaError] = useState('');

  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('admin');
  const [permissions, setPermissions] = useState([]);
<<<<<<< HEAD
  const [branch, setBranch] = useState('');
=======
  const [scopes, setScopes] = useState({
    'employees:view': { type: 'all' },
    'employees:edit': { type: 'all' },
  });
>>>>>>> 26cb648ec4b238983f2472c30081ce976617c1cc
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    let active = true;

    async function loadMeta() {
      setLoadingMeta(true);
      setMetaError('');
      setFormError('');
      try {
<<<<<<< HEAD
        const [listRes, catalogRes, branchesRes] = await Promise.all([
          api.get('/api/admin/employees-list'),
          api.get('/api/admin/permissions-catalog'),
          api.get('/api/admin/branches'),
=======
        const [listRes, catalogRes, teamsRes] = await Promise.all([
          api.get('/api/admin/employees-list'),
          api.get('/api/admin/permissions-catalog'),
          api.get('/api/admin/teams'),
>>>>>>> 26cb648ec4b238983f2472c30081ce976617c1cc
        ]);
        if (!active) return;
        setEmployees(Array.isArray(listRes.data?.employees) ? listRes.data.employees : []);
        setCatalog(
          Array.isArray(catalogRes.data?.permissions) ? catalogRes.data.permissions : []
        );
<<<<<<< HEAD
        const fromApi = Array.isArray(branchesRes.data)
          ? branchesRes.data.map((b) => b.name).filter(Boolean)
          : [];
        setBranchOptions(fromApi.length ? fromApi : BRANCH_OPTIONS);
=======
        if (Array.isArray(catalogRes.data?.branch_options) && catalogRes.data.branch_options.length) {
          setBranchOptions(catalogRes.data.branch_options);
        }
        setTeams(Array.isArray(teamsRes.data) ? teamsRes.data : []);
>>>>>>> 26cb648ec4b238983f2472c30081ce976617c1cc
      } catch (err) {
        if (!active) return;
        setMetaError(
          err.response?.data?.message ||
            err.response?.data?.error ||
            'Failed to load assignment options.'
        );
      } finally {
        if (active) setLoadingMeta(false);
      }
    }

    loadMeta();
    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (initialUser) {
      setUserId(String(initialUser.id));
      setRole(initialUser.role || 'admin');
      setPermissions(
        Array.isArray(initialUser.permissions) ? [...initialUser.permissions] : []
      );
<<<<<<< HEAD
      setBranch(initialUser.branch || '');
=======
      setScopes(defaultScopesFromUser(initialUser));
>>>>>>> 26cb648ec4b238983f2472c30081ce976617c1cc
      setReason('');
      setSearch('');
      setFormError('');
    } else {
      setUserId('');
      setRole('admin');
      setPermissions([]);
<<<<<<< HEAD
      setBranch('');
=======
      setScopes({
        'employees:view': { type: 'all' },
        'employees:edit': { type: 'all' },
      });
>>>>>>> 26cb648ec4b238983f2472c30081ce976617c1cc
      setReason('');
      setSearch('');
      setFormError('');
    }
  }, [open, initialUser]);

  const teamNames = useMemo(
    () =>
      [...new Set(teams.map((t) => String(t.name || '').trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b)
      ),
    [teams]
  );

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) => {
      const hay = `${e.name || ''} ${e.employee_id || ''} ${e.role || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [employees, search]);

  const selectedEmployee = useMemo(
    () => employees.find((e) => String(e.id) === String(userId)) || null,
    [employees, userId]
  );

  function togglePermission(key) {
    setPermissions((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      return [...prev, key];
    });
    if (isScopedEmployeePermission(key)) {
      setScopes((prev) => ({
        ...prev,
        [key]: prev[key] || { type: 'all' },
      }));
    }
  }

  function setScopeType(key, type) {
    setScopes((prev) => ({
      ...prev,
      [key]:
        type === 'all'
          ? { type: 'all' }
          : { type, values: Array.isArray(prev[key]?.values) ? prev[key].values : [] },
    }));
  }

  function toggleScopeValue(key, value) {
    setScopes((prev) => {
      const current = normalizeEmployeeScope(prev[key]);
      const type = current.type === 'all' ? 'branch' : current.type;
      const values = new Set(current.values || []);
      if (values.has(value)) values.delete(value);
      else values.add(value);
      return {
        ...prev,
        [key]: { type, values: [...values] },
      };
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');

    if (!userId) {
      setFormError('Select an employee before confirming.');
      return;
    }
    if (!role) {
      setFormError('Choose a role to assign.');
      return;
    }
    if (role === 'admin' && !branch) {
      setFormError('Select a branch for this admin.');
      return;
    }
    if (role === 'admin' && permissions.length === 0) {
      setFormError('Select at least one permission for Admin.');
      return;
    }

    if (role === 'admin') {
      for (const key of permissions) {
        if (!isScopedEmployeePermission(key)) continue;
        const scope = normalizeEmployeeScope(scopes[key]);
        if (scope.type !== 'all' && (!scope.values || !scope.values.length)) {
          setFormError(
            `For ${key === 'employees:view' ? 'View employees' : 'Edit employees'}, choose All, or pick at least one branch/team.`
          );
          return;
        }
      }
    }

    setSubmitting(true);
    try {
      const payload = {
        user_id: Number(userId),
        role,
        reason: reason.trim() || undefined,
      };
      if (role === 'admin') {
        payload.permissions = permissions;
<<<<<<< HEAD
        payload.branch = branch;
=======
        const permission_scopes = {};
        for (const key of permissions) {
          if (isScopedEmployeePermission(key)) {
            permission_scopes[key] = normalizeEmployeeScope(scopes[key]);
          }
        }
        payload.permission_scopes = permission_scopes;
>>>>>>> 26cb648ec4b238983f2472c30081ce976617c1cc
      } else {
        payload.permissions = [];
        payload.permission_scopes = {};
      }

      const { data } = await api.post('/api/roles/assign', payload);
      onSuccess?.({
        message:
          data.message ||
          `Role assigned successfully to ${selectedEmployee?.name || 'employee'}.`,
        user: data.user,
      });
      onClose?.();
    } catch (err) {
      setFormError(
        err.response?.data?.message ||
          err.response?.data?.error ||
          'Unable to assign role. Try again.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  function renderScopeControls(permKey) {
    if (!permissions.includes(permKey)) return null;
    const scope = normalizeEmployeeScope(scopes[permKey] || { type: 'all' });
    const options = scope.type === 'team' ? teamNames : branchOptions;

    return (
      <div
        className="permission-scope"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <span className="permission-scope-label">Access scope</span>
        <div className="permission-scope-types" role="radiogroup" aria-label="Access scope">
          {[
            { value: 'all', label: 'All employees' },
            { value: 'branch', label: 'Specific branch' },
            { value: 'team', label: 'Specific team' },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`permission-scope-type ${scope.type === opt.value ? 'active' : ''}`}
              aria-pressed={scope.type === opt.value}
              onClick={() => setScopeType(permKey, opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {scope.type === 'branch' && (
          <div className="permission-scope-values">
            <span className="permission-scope-label">Branches</span>
            {branchOptions.map((value) => (
              <label key={value} className="permission-scope-chip">
                <input
                  type="checkbox"
                  checked={(scope.values || []).includes(value)}
                  onChange={() => toggleScopeValue(permKey, value)}
                />
                {value}
              </label>
            ))}
          </div>
        )}

        {scope.type === 'team' && (
          <div className="permission-scope-values">
            <span className="permission-scope-label">Teams</span>
            {teamNames.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No teams yet. Create a team under Employees first.
              </p>
            ) : (
              teamNames.map((value) => (
                <label key={value} className="permission-scope-chip">
                  <input
                    type="checkbox"
                    checked={(scope.values || []).includes(value)}
                    onChange={() => toggleScopeValue(permKey, value)}
                  />
                  {value}
                </label>
              ))
            )}
          </div>
        )}

        <p className="muted permission-scope-summary">{describeEmployeeScope(scope)}</p>
      </div>
    );
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <aside
        className="modal-panel assign-role-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Assign admin role"
      >
        <div className="modal-header">
          <div>
            <h2>Assign Admin Role</h2>
            <p className="muted" style={{ margin: 0 }}>
              Choose an employee, role, branch, and access scopes
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {loadingMeta && (
          <div className="admin-loading">
            <div className="spinner" />
            Loading…
          </div>
        )}

        {metaError && <p className="error">{metaError}</p>}

        {!loadingMeta && !metaError && (
          <form className="assign-role-form" onSubmit={handleSubmit} noValidate>
            <fieldset className="assign-step">
              <legend>1. Select employee</legend>
              <input
                className="assign-search"
                type="search"
                placeholder="Search by name or employee ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search employees"
              />
              <select
                value={userId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setUserId(nextId);
                  const match = employees.find((row) => String(row.id) === String(nextId));
                  if (match?.branch) setBranch(match.branch);
                }}
                aria-label="Employee"
                required
              >
                <option value="">Select employee…</option>
                {filteredEmployees.map((row) => (
                  <option key={row.id} value={row.id}>
                    {employeeLabel(row)} ({row.role || 'employee'})
                  </option>
                ))}
              </select>
              {selectedEmployee && (
                <p className="muted assign-selected">
                  Selected: <strong>{employeeLabel(selectedEmployee)}</strong>
<<<<<<< HEAD
                  {selectedEmployee.department
                    ? ` · ${selectedEmployee.department}`
                    : ''}
                  {selectedEmployee.designation
                    ? ` · ${selectedEmployee.designation}`
                    : ''}
                  {selectedEmployee.branch ? ` · ${selectedEmployee.branch}` : ''}
=======
                  {selectedEmployee.department ? ` · ${selectedEmployee.department}` : ''}
                  {selectedEmployee.designation ? ` · ${selectedEmployee.designation}` : ''}
>>>>>>> 26cb648ec4b238983f2472c30081ce976617c1cc
                </p>
              )}
            </fieldset>

            <fieldset className="assign-step">
              <legend>2. Role</legend>
              <div className="role-radio-row">
                {ROLE_OPTIONS.map((opt) => (
                  <label key={opt.value} className="role-radio">
                    <input
                      type="radio"
                      name="assign-role"
                      value={opt.value}
                      checked={role === opt.value}
                      onChange={() => setRole(opt.value)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </fieldset>

            {role === 'admin' && (
              <fieldset className="assign-step">
                <legend>3. Branch</legend>
                <select
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  aria-label="Branch"
                  required
                >
                  <option value="">Select branch…</option>
                  {branchOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                  {branch && !branchOptions.includes(branch) && (
                    <option value={branch}>{branch} (current)</option>
                  )}
                </select>
                <p className="muted assign-selected">
                  Required. Office this admin is assigned to.
                </p>
              </fieldset>
            )}

            {role === 'admin' && (
              <fieldset className="assign-step">
                <legend>4. Admin permissions</legend>
                <div className="permission-list">
                  {catalog.map((perm) => (
                    <div key={perm.key} className="permission-block">
                      <label className="permission-item">
                        <input
                          type="checkbox"
                          checked={permissions.includes(perm.key)}
                          onChange={() => togglePermission(perm.key)}
                        />
                        <span>
                          <strong>{perm.label}</strong>
                          <span className="muted">{perm.description}</span>
                        </span>
                      </label>
                      {isScopedEmployeePermission(perm.key) && renderScopeControls(perm.key)}
                    </div>
                  ))}
                </div>
              </fieldset>
            )}

            <fieldset className="assign-step">
              <legend>{role === 'admin' ? '5' : '3'}. Reason (optional)</legend>
              <textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Note for the audit log…"
              />
            </fieldset>

            {formError && <p className="error">{formError}</p>}

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Assigning…' : 'Confirm Assignment'}
              </button>
            </div>
          </form>
        )}
      </aside>
    </div>
  );
}

export default AssignRoleModal;
