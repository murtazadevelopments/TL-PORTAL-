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
  const [actingId, setActingId] = useState(null);
  const [success, setSuccess] = useState('');

  const canUnlock = hasPermission(permissions, 'accounts:unlock', role);
  const canBlock = hasPermission(permissions, 'employees:deactivate', role);
  const canOpen = canUnlock || canBlock;

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
        const perms = Array.isArray(data.permissions) ? data.permissions : [];
        const allowed =
          hasPermission(perms, 'accounts:unlock', data.role) ||
          hasPermission(perms, 'employees:deactivate', data.role);
        if (!allowed) {
          navigate('/dashboard', { replace: true });
          return;
        }
        setRole(data.role);
        setPermissions(perms);
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
    if (!checking && canOpen) loadLocked();
  }, [checking, canOpen, loadLocked]);

  async function handleUnlock(userId) {
    setActingId(userId);
    setError('');
    setSuccess('');
    try {
      await api.put(`/api/admin/accounts/${userId}/unlock`);
      setLockedAccounts((prev) =>
        prev
          .map((r) =>
            String(r.id) === String(userId)
              ? { ...r, locked_at: null, failed_login_attempts: 0 }
              : r
          )
          .filter((r) => r.locked_at || r.blocked_at)
      );
      setSuccess('Login lock cleared. They can sign in if they are not admin-blocked.');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to unlock account.');
    } finally {
      setActingId(null);
    }
  }

  async function handleUnblock(userId) {
    setActingId(userId);
    setError('');
    setSuccess('');
    try {
      await api.put(`/api/admin/accounts/${userId}/unblock`);
      setLockedAccounts((prev) =>
        prev
          .map((r) =>
            String(r.id) === String(userId) ? { ...r, blocked_at: null, blocked_reason: null } : r
          )
          .filter((r) => r.locked_at || r.blocked_at)
      );
      setSuccess('Account unblocked. They can sign in if they are not locked.');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to unblock account.');
    } finally {
      setActingId(null);
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
          <h1>Locked & blocked accounts</h1>
          <p className="muted" style={{ margin: 0 }}>
            Failed-login lockouts and accounts blocked by an admin. Blocked users are signed out
            immediately and cannot sign in until unblocked.
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
          Loading accounts…
        </div>
      )}

      {!loading && lockedAccounts.length === 0 && !error && (
        <div className="admin-empty">No locked or blocked accounts.</div>
      )}

      {lockedAccounts.length > 0 && (
        <div className="table-shell">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Type</th>
                <th>Employment</th>
                <th>When</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lockedAccounts.map((row) => {
                const blocked = Boolean(row.blocked_at);
                const locked = Boolean(row.locked_at);
                const when = row.blocked_at || row.locked_at;
                return (
                  <tr key={row.id}>
                    <td className="cell-name">{fullName(row)}</td>
                    <td>{row.username || '—'}</td>
                    <td>
                      {blocked ? 'admin blocked' : ''}
                      {blocked && locked ? ' · ' : ''}
                      {locked ? 'failed logins' : ''}
                    </td>
                    <td>{row.status === 'active' ? 'active' : 'pending'}</td>
                    <td>{when ? new Date(when).toLocaleString() : '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        {canUnlock && locked && (
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={actingId === row.id}
                            onClick={() => handleUnlock(row.id)}
                          >
                            {actingId === row.id ? 'Unlocking…' : 'Unlock'}
                          </button>
                        )}
                        {canBlock && blocked && (
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={actingId === row.id}
                            onClick={() => handleUnblock(row.id)}
                          >
                            {actingId === row.id ? 'Unblocking…' : 'Unblock'}
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
