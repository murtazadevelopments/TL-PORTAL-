import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../../api/client';
import { canAccessAdmin, hasPermission } from '../../utils/permissions';
import './AdminDashboard.css';

export default function BranchesPage() {
  const navigate = useNavigate();
  const [role, setRole] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [checking, setChecking] = useState(true);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const canManage = hasPermission(permissions, 'branches:create', role);

  const loadBranches = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/admin/branches');
      setBranches(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load branches.');
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
    if (!checking && role) loadBranches();
  }, [checking, role, loadBranches]);

  async function handleCreate(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) {
      setError('Enter a branch name.');
      return;
    }
    if (!canManage) {
      setError('You do not have permission to manage branches.');
      return;
    }
    setCreating(true);
    setError('');
    setSuccess('');
    try {
      const { data } = await api.post('/api/admin/branches', { name });
      setBranches((prev) =>
        [...prev, data].sort((a, b) => String(a.name).localeCompare(String(b.name)))
      );
      setNewName('');
      setSuccess(`Branch “${data.name}” created.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create branch.');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(branch) {
    if (!canManage || !branch?.id) return;
    const ok = window.confirm(
      `Delete branch “${branch.name}”? People already assigned this branch keep their current value until you change it.`
    );
    if (!ok) return;

    setDeletingId(branch.id);
    setError('');
    setSuccess('');
    try {
      const { data } = await api.delete(`/api/admin/branches/${branch.id}`);
      setBranches((prev) => prev.filter((b) => b.id !== branch.id));
      setSuccess(data.message || `Branch “${branch.name}” deleted.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete branch.');
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
          <h1>Manage Branches</h1>
          <p className="muted" style={{ margin: 0 }}>
            Office / branch catalog used on employee records and admin role assignment
          </p>
        </div>
        <button type="button" className="btn btn-ghost" disabled={loading} onClick={loadBranches}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {canManage && (
        <form className="form" onSubmit={handleCreate} style={{ maxWidth: 420, marginBottom: '1.25rem' }}>
          <label>
            New branch name
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Head Office"
              disabled={creating}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={creating}>
            {creating ? 'Adding…' : 'Add branch'}
          </button>
        </form>
      )}

      {!canManage && (
        <p className="muted">You can view branches but need branches:create to add or delete them.</p>
      )}

      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}

      {loading && branches.length === 0 && (
        <div className="admin-loading">
          <div className="spinner" />
          Loading branches…
        </div>
      )}

      {!loading && branches.length === 0 && !error && (
        <div className="admin-empty">No branches yet.</div>
      )}

      {branches.length > 0 && (
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
              {branches.map((b) => (
                <tr key={b.id}>
                  <td className="cell-name">{b.name}</td>
                  <td>
                    {b.created_at ? new Date(b.created_at).toLocaleDateString() : '—'}
                  </td>
                  {canManage && (
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={deletingId === b.id || creating}
                        onClick={() => handleDelete(b)}
                      >
                        {deletingId === b.id ? 'Deleting…' : 'Delete'}
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
