import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../../api/client';
import { canAccessAdmin, hasPermission } from '../../utils/permissions';
import './AdminDashboard.css';

export default function TeamsPage() {
  const navigate = useNavigate();
  const [role, setRole] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [checking, setChecking] = useState(true);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const canManage = hasPermission(permissions, 'teams:create', role);

  const loadTeams = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/admin/teams');
      setTeams(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load teams.');
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
    if (!checking && role) loadTeams();
  }, [checking, role, loadTeams]);

  async function handleCreate(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) {
      setError('Enter a team name.');
      return;
    }
    if (!canManage) {
      setError('You do not have permission to manage teams.');
      return;
    }
    setCreating(true);
    setError('');
    setSuccess('');
    try {
      const { data } = await api.post('/api/admin/teams', { name });
      setTeams((prev) =>
        [...prev, data].sort((a, b) => String(a.name).localeCompare(String(b.name)))
      );
      setNewName('');
      setSuccess(`Team “${data.name}” created.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create team.');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(team) {
    if (!canManage || !team?.id) return;
    const ok = window.confirm(
      `Delete team “${team.name}”? Employees already assigned this department keep their current value until you change it.`
    );
    if (!ok) return;

    setDeletingId(team.id);
    setError('');
    setSuccess('');
    try {
      const { data } = await api.delete(`/api/admin/teams/${team.id}`);
      setTeams((prev) => prev.filter((t) => t.id !== team.id));
      setSuccess(data.message || `Team “${team.name}” deleted.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete team.');
    } finally {
      setDeletingId(null);
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
          <h1>Manage Teams</h1>
          <p className="muted" style={{ margin: 0 }}>
            Department / team catalog used on employee records
          </p>
        </div>
        <button type="button" className="btn btn-ghost" disabled={loading} onClick={loadTeams}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {canManage && (
        <form className="form" onSubmit={handleCreate} style={{ maxWidth: 420, marginBottom: '1.25rem' }}>
          <label>
            New team name
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Design"
              disabled={creating}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={creating}>
            {creating ? 'Adding…' : 'Add team'}
          </button>
        </form>
      )}

      {!canManage && (
        <p className="muted">You can view teams but need teams:create to add or delete them.</p>
      )}

      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}

      {loading && teams.length === 0 && (
        <div className="admin-loading">
          <div className="spinner" />
          Loading teams…
        </div>
      )}

      {!loading && teams.length === 0 && !error && (
        <div className="admin-empty">No teams yet.</div>
      )}

      {teams.length > 0 && (
        <div className="table-shell">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Created</th>
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.id}>
                  <td className="cell-name">{t.name}</td>
                  <td>
                    {t.created_at ? new Date(t.created_at).toLocaleDateString() : '—'}
                  </td>
                  {canManage && (
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={deletingId === t.id || creating}
                        onClick={() => handleDelete(t)}
                      >
                        {deletingId === t.id ? 'Deleting…' : 'Delete'}
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
