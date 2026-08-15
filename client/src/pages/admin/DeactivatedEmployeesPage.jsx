import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../../api/client';
import { canAccessAdmin, hasPermission, isCeo } from '../../utils/permissions';
import './AdminDashboard.css';

function fullName(row) {
  return row?.name || '—';
}

export default function DeactivatedEmployeesPage() {
  const navigate = useNavigate();
  const [role, setRole] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [checking, setChecking] = useState(true);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [purgingId, setPurgingId] = useState(null);

  const canView = hasPermission(permissions, 'employees:deactivate', role);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/admin/deactivated');
      setUsers(Array.isArray(data?.users) ? data.users : Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load deactivated employees.');
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
        if (!canAccessAdmin(data.role)) {
          navigate('/dashboard', { replace: true });
          return;
        }
        if (!hasPermission(data.permissions, 'employees:deactivate', data.role)) {
          navigate('/dashboard', { replace: true });
          return;
        }
        setRole(data.role);
        setPermissions(Array.isArray(data.permissions) ? data.permissions : []);
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
    if (!checking && canView) load();
  }, [checking, canView, load]);

  async function handlePurge(id, label) {
    if (!isCeo(role)) return;
    const ok = window.confirm(
      `Permanently purge ${label}? This cannot be undone.`
    );
    if (!ok) return;
    setPurgingId(id);
    setError('');
    setSuccess('');
    try {
      await api.delete(`/api/admin/employees/${id}/purge`);
      setUsers((prev) => prev.filter((u) => u.id !== id));
      setSuccess('Employee permanently purged.');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to purge employee.');
    } finally {
      setPurgingId(null);
    }
  }

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
    <div className="admin-page page-panel">
      <div className="admin-toolbar" style={{ marginTop: 0 }}>
        <div>
          <h1>Deactivated</h1>
          <p className="muted" style={{ margin: 0 }}>
            Soft-deleted employees — CEO can permanently purge
          </p>
        </div>
        <button type="button" className="btn btn-ghost" disabled={loading} onClick={load}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}

      {loading && users.length === 0 && (
        <div className="admin-loading">
          <div className="spinner" />
          Loading…
        </div>
      )}

      {!loading && users.length === 0 && !error && (
        <div className="admin-empty">No deactivated employees.</div>
      )}

      {users.length > 0 && (
        <div className="table-shell">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Employee ID</th>
                <th>Department</th>
                {isCeo(role) && <th />}
              </tr>
            </thead>
            <tbody>
              {users.map((row) => (
                <tr key={row.id}>
                  <td className="cell-name">{fullName(row)}</td>
                  <td>{row.username || '—'}</td>
                  <td>{row.employee_id || '—'}</td>
                  <td>{row.department || '—'}</td>
                  {isCeo(role) && (
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={purgingId === row.id}
                        onClick={() =>
                          handlePurge(row.id, row.name || row.username || 'this employee')
                        }
                      >
                        {purgingId === row.id ? 'Purging…' : 'Purge'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
