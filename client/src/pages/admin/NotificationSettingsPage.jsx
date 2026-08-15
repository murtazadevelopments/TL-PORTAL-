import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../../api/client';
import { canAccessAdmin, hasPermission } from '../../utils/permissions';
import './AdminDashboard.css';

export default function NotificationSettingsPage() {
  const navigate = useNavigate();
  const [role, setRole] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientUser, setRecipientUser] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');

  const canManage = hasPermission(permissions, 'notifications:signup_recipient', role);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/admin/notification-settings');
      const block = data?.settings?.new_signup_recipient;
      setRecipientUser(block?.recipient_user || null);
      setRecipientEmail(block?.recipient_email || '');
      setSelectedUserId(block?.recipient_user?.id ? String(block.recipient_user.id) : '');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load notification settings.');
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
        if (!hasPermission(data.permissions, 'notifications:signup_recipient', data.role)) {
          navigate('/dashboard', { replace: true });
          return;
        }
        setRole(data.role);
        setPermissions(Array.isArray(data.permissions) ? data.permissions : []);
        try {
          const { data: list } = await api.get('/api/admin/employees');
          if (active) setEmployees(Array.isArray(list) ? list : []);
        } catch {
          /* picker optional if no employees:view */
        }
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
    if (!checking && canManage) loadSettings();
  }, [checking, canManage, loadSettings]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const body = selectedUserId
        ? { new_signup_recipient_user_id: selectedUserId }
        : recipientEmail.trim()
          ? { new_signup_recipient_email: recipientEmail.trim() }
          : { clear_new_signup_recipient: true };
      const { data } = await api.put('/api/admin/notification-settings', body);
      setSuccess(data.message || 'Settings saved.');
      await loadSettings();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const { data } = await api.put('/api/admin/notification-settings', {
        clear_new_signup_recipient: true,
      });
      setSelectedUserId('');
      setRecipientEmail('');
      setRecipientUser(null);
      setSuccess(data.message || 'Recipient cleared.');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to clear recipient.');
    } finally {
      setSaving(false);
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
          <h1>Notification Settings</h1>
          <p className="muted" style={{ margin: 0 }}>
            Who receives email when a new employee signs up
          </p>
        </div>
        <button type="button" className="btn btn-ghost" disabled={loading} onClick={loadSettings}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}

      {!loading && (
        <form className="form" onSubmit={handleSave} style={{ maxWidth: 480 }}>
          {recipientUser && (
            <p className="muted">
              Current recipient:{' '}
              <strong>
                {recipientUser.name || recipientUser.username} ({recipientUser.email})
              </strong>
            </p>
          )}
          {!recipientUser && recipientEmail && (
            <p className="muted">
              Current recipient email: <strong>{recipientEmail}</strong>
            </p>
          )}

          {employees.length > 0 && (
            <label>
              Recipient employee
              <select
                value={selectedUserId}
                onChange={(e) => {
                  setSelectedUserId(e.target.value);
                  if (e.target.value) setRecipientEmail('');
                }}
              >
                <option value="">Select employee (optional)</option>
                {employees
                  .filter((e) => e.email)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name || e.username} — {e.email}
                    </option>
                  ))}
              </select>
            </label>
          )}

          <label>
            Or recipient email
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => {
                setRecipientEmail(e.target.value);
                if (e.target.value) setSelectedUserId('');
              }}
              placeholder="alerts@example.com"
              disabled={Boolean(selectedUserId)}
            />
          </label>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={handleClear}>
              Clear recipient
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
