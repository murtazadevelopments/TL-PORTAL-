import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../../api/client';
import { canAccessAdmin, hasPermission } from '../../utils/permissions';
import './AdminDashboard.css';

function fullName(row) {
  return row?.name || '—';
}

export default function LockedAccountsPage() {
  const navigate = useNavigate();
  const [role, setRole] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [checking, setChecking] = useState(true);
  const [lockedAccounts, setLockedAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [unlockingId, setUnlockingId] = useState(null);
  const [success, setSuccess] = useState('');

  const canUnlock = hasPermission(permissions, 'accounts:unlock', role);

  const loadLocked = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/admin/locked-accounts');
      setLockedAccounts(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load locked accounts.');
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
        if (!hasPermission(data.permissions, 'accounts:unlock', data.role)) {
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
    if (!checking && canUnlock) loadLocked();
  }, [checking, canUnlock, loadLocked]);

  async function handleUnlock(userId) {
    setUnlockingId(userId);
    setError('');
    setSuccess('');
    try {
      await api.put(`/api/admin/accounts/${userId}/unlock`);
      setLockedAccounts((prev) => prev.filter((r) => String(r.id) !== String(userId)));
      setSuccess('Account unblocked. They can sign in again.');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to unblock account.');
    } finally {
      setUnlockingId(null);
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
          <h1>Locked Accounts</h1>
          <p className="muted" style={{ margin: 0 }}>
            Locked after 5 failed password attempts — unlock to restore sign-in
          </p>
        </div>
        <button type="button" className="btn btn-ghost" disabled={loading} onClick={loadLocked}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}

      {loading && lockedAccounts.length === 0 && (
        <div className="admin-loading">
          <div className="spinner" />
          Loading locked accounts…
        </div>
      )}

      {!loading && lockedAccounts.length === 0 && !error && (
        <div className="admin-empty">No locked accounts.</div>
      )}

      {lockedAccounts.length > 0 && (
        <div className="table-shell">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Employment</th>
                <th>Attempts</th>
                <th>Locked at</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lockedAccounts.map((row) => (
                <tr key={row.id}>
                  <td className="cell-name">{fullName(row)}</td>
                  <td>{row.username || '—'}</td>
                  <td>{row.status === 'active' ? 'active' : 'pending'}</td>
                  <td>{row.failed_login_attempts ?? '—'}</td>
                  <td>
                    {row.locked_at ? new Date(row.locked_at).toLocaleString() : '—'}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={unlockingId === row.id}
                      onClick={() => handleUnlock(row.id)}
                    >
                      {unlockingId === row.id ? 'Unblocking…' : 'Unblock'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
