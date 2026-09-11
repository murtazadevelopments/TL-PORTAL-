import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../../api/client';
import { canAccessAdmin, hasPermission } from '../../utils/permissions';
import './AdminDashboard.css';

export default function DesignationsPage() {
  const navigate = useNavigate();
  const [role, setRole] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [checking, setChecking] = useState(true);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [newName, setNewName] = useState('');
  const [tlAccess, setTlAccess] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const canManage =
    hasPermission(permissions, 'employees:edit', role) ||
    hasPermission(permissions, 'hr:add_employee', role);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/admin/designations');
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load designations.');
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
    if (!checking && role) load();
  }, [checking, role, load]);

  async function handleCreate(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) {
      setError('Enter a designation name.');
      return;
    }
    if (!canManage) {
      setError('You do not have permission to manage designations.');
      return;
    }
    setCreating(true);
    setError('');
    setSuccess('');
    try {
      const { data } = await api.post('/api/admin/designations', {
        name,
        tl_dashboard_access: tlAccess,
      });
      setRows((prev) =>
        [...prev, data].sort((a, b) => {
          if (a.tl_dashboard_access !== b.tl_dashboard_access) {
            return a.tl_dashboard_access ? -1 : 1;
          }
          return String(a.name).localeCompare(String(b.name));
        })
      );
      setNewName('');
      setTlAccess(false);
      setSuccess(
        data.tl_dashboard_access
          ? `Added “${data.name}” with Team Lead access.`
          : `Added “${data.name}”.`
      );
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add designation.');
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleTl(row) {
    if (!canManage || !row?.id) return;
    setBusyId(row.id);
    setError('');
    setSuccess('');
    try {
      const { data } = await api.patch(`/api/admin/designations/${row.id}`, {
        tl_dashboard_access: !row.tl_dashboard_access,
      });
      setRows((prev) => prev.map((item) => (item.id === data.id ? data : item)));
      setSuccess(
        data.tl_dashboard_access
          ? `“${data.name}” now has Team Lead access.`
          : `Removed Team Lead access from “${data.name}”.`
      );
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update access.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(row) {
    if (!canManage || !row?.id) return;
    const ok = window.confirm(
      `Remove “${row.name}” from the list? Employees already using it keep the title until you change it.`
    );
    if (!ok) return;
    setBusyId(row.id);
    setError('');
    setSuccess('');
    try {
      const { data } = await api.delete(`/api/admin/designations/${row.id}`);
      setRows((prev) => prev.filter((item) => item.id !== row.id));
      setSuccess(data.message || `Removed “${row.name}”.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to remove designation.');
    } finally {
      setBusyId(null);
    }
  }

  if (checking) {
    return (
      <div className="admin-page page-panel">
        <div className="admin-loading">Checking access…</div>
      </div>
    );
  }

  return (
    <div className="admin-page page-panel">
      <div className="admin-toolbar" style={{ marginTop: 0 }}>
        <div>
          <h1>Manage Designations</h1>
          <p className="muted" style={{ margin: 0 }}>
            Titles on Add / Edit employee. Team Lead access opens the Team Leader Dashboard for
            anyone with that designation.
          </p>
        </div>
        <button type="button" className="btn btn-ghost" disabled={loading} onClick={load}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {canManage && (
        <form className="form branches-add-form" onSubmit={handleCreate}>
          <label>
            New designation
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Quality Lead"
              disabled={creating}
            />
          </label>
          <label className="checkbox-inline" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <input
              type="checkbox"
              checked={tlAccess}
              onChange={(e) => setTlAccess(e.target.checked)}
              disabled={creating}
            />
            Team Lead access
          </label>
          <button type="submit" className="btn btn-primary" disabled={creating}>
            {creating ? 'Adding…' : 'Add designation'}
          </button>
        </form>
      )}

      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}

      {loading && rows.length === 0 && <div className="admin-loading">Loading designations…</div>}
      {!loading && rows.length === 0 && !error && (
        <div className="admin-empty">No designations yet.</div>
      )}

      {rows.length > 0 && (
        <div className="table-shell">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Team Lead access</th>
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="cell-name">{row.name}</td>
                  <td>{row.tl_dashboard_access ? 'Yes' : 'No'}</td>
                  {canManage && (
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busyId === row.id || creating}
                        onClick={() => handleToggleTl(row)}
                      >
                        {row.tl_dashboard_access ? 'Remove access' : 'Give access'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busyId === row.id || creating}
                        onClick={() => handleDelete(row)}
                      >
                        {busyId === row.id ? 'Working…' : 'Delete'}
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
