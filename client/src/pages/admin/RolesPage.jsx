import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../../api/client';
import AssignRoleModal from '../../components/AssignRoleModal';
import { isCeo } from '../../utils/permissions';
import {
  describeEmployeeScope,
  isScopedEmployeePermission,
} from '../../utils/employeeScope';
import './AdminDashboard.css';
import '../../components/AssignRoleModal.css';

function fullName(row) {
  return row?.name || '—';
}

function HrPeoplePicker({ onSaved }) {
  const [people, setPeople] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/admin/hr-people');
      const list = Array.isArray(data?.people) ? data.people : [];
      setPeople(list);
      setSelected(new Set(list.filter((p) => p.is_hr).map((p) => String(p.id))));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load people.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) => {
      const hay = `${p.name || ''} ${p.employee_id || ''} ${p.designation || ''} ${p.department || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [people, query]);

  function toggle(id) {
    const key = String(id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const { data } = await api.put('/api/admin/hr-people', {
        user_ids: [...selected].map((id) => Number(id)),
      });
      await load();
      onSaved?.(data?.message || 'HR people saved.');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save HR people.');
    } finally {
      setSaving(false);
    }
  }

  const named = people.filter((p) => selected.has(String(p.id)));

  return (
    <section className="hr-people-card">
      <div className="hr-people-head">
        <div>
          <h2>HR people</h2>
          <p className="muted" style={{ margin: 0 }}>
            Tick names. Those people can add new employees, fill details, and see the incomplete list. Other admins cannot add employees.
          </p>
        </div>
        <button type="button" className="btn btn-primary" disabled={saving || loading} onClick={save}>
          {saving ? 'Saving…' : 'Save HR people'}
        </button>
      </div>
      {named.length > 0 && (
        <p className="hr-people-selected">
          Selected: {named.map((p) => p.name || 'Unnamed').join(', ')}
        </p>
      )}
      <input
        type="search"
        className="admin-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name…"
        aria-label="Search people to assign as HR"
      />
      {error && <p className="error">{error}</p>}
      {loading ? (
        <p className="muted">Loading names…</p>
      ) : (
        <ul className="hr-people-list">
          {filtered.map((person) => {
            const id = String(person.id);
            return (
              <li key={id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.has(id)}
                    onChange={() => toggle(person.id)}
                  />
                  <span>
                    <strong>{person.name || 'Unnamed'}</strong>
                    <em>
                      {[person.employee_id, person.designation, person.department]
                        .filter(Boolean)
                        .join(' · ') || 'No ID'}
                    </em>
                  </span>
                </label>
              </li>
            );
          })}
          {filtered.length === 0 && <li className="muted">No matching names.</li>}
        </ul>
      )}
    </section>
  );
}

export default function RolesPage() {
  const navigate = useNavigate();
  const [role, setRole] = useState(null);
  const [checking, setChecking] = useState(true);
  const [roleHolders, setRoleHolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignInitial, setAssignInitial] = useState(null);
  const [banner, setBanner] = useState('');

  const loadHolders = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/admin/role-holders');
      setRoleHolders(Array.isArray(data?.holders) ? data.holders : []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load current admins.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function verify() {
      try {
        const { data } = await api.get('/api/users/me');
        if (!active) return;
        if (!isCeo(data.role)) {
          navigate('/dashboard', { replace: true });
          return;
        }
        setRole(data.role);
      } catch {
        if (!active) return;
        localStorage.removeItem('token');
        navigate('/', { replace: true });
      } finally {
        if (active) setChecking(false);
      }
    }
    verify();
    return () => {
      active = false;
    };
  }, [navigate]);

  useEffect(() => {
    if (!checking && isCeo(role)) loadHolders();
  }, [checking, role, loadHolders]);

  if (checking) {
    return (
      <div className="admin-page page-panel">
        <div className="admin-loading">
          <div className="spinner" />
          Checking access…
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="admin-page page-panel">
        <div className="admin-toolbar" style={{ marginTop: 0 }}>
          <div>
            <h1>Assign Roles</h1>
            <p className="muted" style={{ margin: 0 }}>
              People with admin or CEO access and their permission scopes
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost" disabled={loading} onClick={loadHolders}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
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
        </div>

        {banner && (
          <p className="success assign-banner" role="status">
            {banner}
          </p>
        )}
        {error && <p className="error">{error}</p>}

        <HrPeoplePicker
          onSaved={(message) => {
            setBanner(message);
            loadHolders();
            window.setTimeout(() => setBanner(''), 5000);
          }}
        />

        {loading && roleHolders.length === 0 && (
          <div className="admin-loading">
            <div className="spinner" />
            Loading role holders…
          </div>
        )}

        {!loading && roleHolders.length === 0 && !error && (
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
                  <th>Branch</th>
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
                    <td>{row.branch || '—'}</td>
                    <td>
                      {String(row.role || '').toLowerCase() === 'ceo' ? (
                        <span className="muted">Full access (all permissions)</span>
                      ) : Array.isArray(row.permissions) && row.permissions.length > 0 ? (
                        <div className="perm-chip-row">
                          {row.permissions.map((key) => {
                            const scope = row.scopes?.[key];
                            const label =
                              isScopedEmployeePermission(key) && scope
                                ? `${key} · ${describeEmployeeScope(scope)}`
                                : key;
                            return (
                              <span key={key} className="perm-chip" title={label}>
                                {label}
                              </span>
                            );
                          })}
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
      </div>

      <AssignRoleModal
        open={assignOpen}
        initialUser={assignInitial}
        onClose={() => {
          setAssignOpen(false);
          setAssignInitial(null);
        }}
        onSuccess={({ message }) => {
          setBanner(message);
          loadHolders();
          window.setTimeout(() => setBanner(''), 5000);
        }}
      />
    </>
  );
}
