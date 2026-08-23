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
  const [restoringId, setRestoringId] = useState(null);
  const [purgingId, setPurgingId] = useState(null);

  const canView = hasPermission(permissions, 'employees:deactivate', role);
  const canRestore = canView;
  const canPurge = isCeo(role);

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

  async function handleRestore(id, label) {
    const ok = window.confirm(
      `Restore ${label}? They will appear in the active employee list and can sign in again.`
    );
    if (!ok) return;
    setRestoringId(id);
    setError('');
    setSuccess('');
    try {
      await api.put(`/api/admin/employees/${id}/restore`);
      setUsers((prev) => prev.filter((u) => String(u.id) !== String(id)));
      setSuccess(`${label} was restored.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to restore employee.');
    } finally {
      setRestoringId(null);
    }
  }

  async function handlePurge(id, label) {
    if (!canPurge) return;
    const ok = window.confirm(
      `Permanently delete ${label}? Their profile, documents, and login access will be removed. This cannot be undone.`
    );
    if (!ok) return;
    const reason =
      window.prompt('Optional note for the audit log (permanent delete):', '') ?? '';
    setPurgingId(id);
    setError('');
    setSuccess('');
    try {
      await api.delete(`/api/admin/employees/${id}/purge`, {
        data: { reason: reason.trim() || 'Permanent delete from deactivated list' },
      });
      setUsers((prev) => prev.filter((u) => String(u.id) !== String(id)));
      setSuccess(`${label} was permanently deleted.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to permanently delete employee.');
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

  const busy = Boolean(restoringId || purgingId);

  return (
    <div className="admin-page page-panel">
      <div className="admin-toolbar" style={{ marginTop: 0 }}>
        <div>
          <h1>Deactivated</h1>
          <p className="muted" style={{ margin: 0 }}>
            Restore an employee to the active list, or permanently delete them (CEO only).
          </p>
        </div>
        <button type="button" className="btn btn-ghost" disabled={loading || busy} onClick={load}>
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
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((row) => {
                const label = row.name || row.username || 'this employee';
                return (
                  <tr key={row.id}>
                    <td className="cell-name">{fullName(row)}</td>
                    <td>{row.username || '—'}</td>
                    <td>{row.employee_id || '—'}</td>
                    <td>{row.department || '—'}</td>
                    <td>
                      <div className="row-actions">
                        {canRestore && (
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={busy}
                            onClick={() => handleRestore(row.id, label)}
                          >
                            {restoringId === row.id ? 'Restoring…' : 'Restore'}
                          </button>
                        )}
                        {canPurge && (
                          <button
                            type="button"
                            className="btn btn-danger"
                            disabled={busy}
                            onClick={() => handlePurge(row.id, label)}
                          >
                            {purgingId === row.id ? 'Deleting…' : 'Permanently delete'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
