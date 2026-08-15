import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { startRegistration } from '@simplewebauthn/browser';
import api from '../../api/client';

export default function AccountSecurity() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  const [webauthnSupported] = useState(
    () =>
      typeof window !== 'undefined' &&
      Boolean(window.PublicKeyCredential) &&
      typeof navigator.credentials?.create === 'function'
  );
  const [passkeys, setPasskeys] = useState([]);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyError, setPasskeyError] = useState('');
  const [passkeySuccess, setPasskeySuccess] = useState('');
  const [registeringPasskey, setRegisteringPasskey] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { data } = await api.get('/api/users/me');
        if (!active) return;
        setProfile(data);
        if (webauthnSupported) {
          try {
            const { data: keys } = await api.get('/api/auth/webauthn/credentials');
            if (active) setPasskeys(Array.isArray(keys) ? keys : []);
          } catch {
            /* optional */
          }
        }
      } catch (err) {
        if (!active) return;
        if (err.response?.status === 401) {
          localStorage.removeItem('token');
          navigate('/');
          return;
        }
        setError(err.response?.data?.message || 'Failed to load account.');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [navigate, webauthnSupported]);

  async function refreshPasskeys() {
    setPasskeyLoading(true);
    try {
      const { data } = await api.get('/api/auth/webauthn/credentials');
      setPasskeys(Array.isArray(data) ? data : []);
    } catch (err) {
      setPasskeyError(err.response?.data?.message || 'Failed to load passkeys.');
    } finally {
      setPasskeyLoading(false);
    }
  }

  async function handleEnablePasskey() {
    setPasskeyError('');
    setPasskeySuccess('');
    setRegisteringPasskey(true);
    try {
      const { data: options } = await api.post('/api/auth/webauthn/register-options');
      const attestation = await startRegistration({ optionsJSON: options });
      const { data } = await api.post('/api/auth/webauthn/register-verify', {
        response: attestation,
        device_label: navigator.userAgent?.slice(0, 80) || 'This device',
      });
      setPasskeySuccess(data.message || 'Face/Fingerprint login enabled.');
      await refreshPasskeys();
    } catch (err) {
      if (err?.name === 'NotAllowedError') {
        setPasskeyError('Registration was cancelled or timed out.');
      } else {
        setPasskeyError(
          err.response?.data?.message || err.message || 'Failed to enable biometric login.'
        );
      }
    } finally {
      setRegisteringPasskey(false);
    }
  }

  async function handleRemovePasskey(id) {
    setPasskeyError('');
    setPasskeySuccess('');
    try {
      await api.delete(`/api/auth/webauthn/credentials/${id}`);
      setPasskeySuccess('Passkey removed.');
      setPasskeys((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setPasskeyError(err.response?.data?.message || 'Failed to remove passkey.');
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');
    if (passwordForm.new_password.length < 6) {
      setPasswordError('New password must be at least 6 characters.');
      return;
    }
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setPasswordError('New passwords do not match.');
      return;
    }
    setChangingPassword(true);
    try {
      const { data } = await api.post('/api/auth/change-password', {
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password,
      });
      setPasswordSuccess(data.message || 'Password changed.');
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
      setShowPasswordForm(false);
    } catch (err) {
      setPasswordError(err.response?.data?.message || 'Failed to change password.');
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <main className="card wide page-panel">
      <h1>Security</h1>
      <p className="muted">Biometric login and password</p>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}

      {!loading && profile && (
        <section className="form" style={{ marginTop: '0.75rem' }}>
          {webauthnSupported && (
            <div style={{ marginBottom: '1.25rem' }}>
              <h2 style={{ margin: '0 0 0.35rem', fontSize: '1.1rem' }}>Face / Fingerprint login</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                Optional. Uses this device’s built-in biometrics (Face ID, Touch ID, Windows Hello).
                You can still sign in with your password.
              </p>
              {passkeyError && <p className="error">{passkeyError}</p>}
              {passkeySuccess && <p className="success">{passkeySuccess}</p>}
              {passkeyLoading ? (
                <p className="muted">Loading…</p>
              ) : passkeys.length > 0 ? (
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.75rem' }}>
                  {passkeys.map((pk) => (
                    <li
                      key={pk.id}
                      style={{
                        display: 'flex',
                        gap: '0.75rem',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        marginBottom: '0.5rem',
                      }}
                    >
                      <span>
                        {pk.device_label || 'Registered device'}
                        {pk.created_at ? ` · ${new Date(pk.created_at).toLocaleDateString()}` : ''}
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => handleRemovePasskey(pk.id)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No biometric login enabled on this account yet.</p>
              )}
              <button
                type="button"
                className="btn btn-primary"
                disabled={registeringPasskey}
                onClick={handleEnablePasskey}
              >
                {registeringPasskey
                  ? 'Waiting for biometric…'
                  : passkeys.length
                    ? 'Add another device'
                    : 'Enable Face/Fingerprint Login'}
              </button>
            </div>
          )}

          <h2 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem' }}>Password</h2>
          {!showPasswordForm ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setPasswordError('');
                setPasswordSuccess('');
                setShowPasswordForm(true);
              }}
            >
              Change password
            </button>
          ) : (
            <form onSubmit={handleChangePassword} className="form" style={{ marginTop: 0 }}>
              <label>
                Current password
                <input
                  type="password"
                  name="current_password"
                  value={passwordForm.current_password}
                  onChange={(e) =>
                    setPasswordForm((prev) => ({ ...prev, current_password: e.target.value }))
                  }
                  required
                  autoComplete="current-password"
                />
              </label>
              <label>
                New password
                <input
                  type="password"
                  name="new_password"
                  value={passwordForm.new_password}
                  onChange={(e) =>
                    setPasswordForm((prev) => ({ ...prev, new_password: e.target.value }))
                  }
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
              </label>
              <label>
                Confirm new password
                <input
                  type="password"
                  name="confirm_password"
                  value={passwordForm.confirm_password}
                  onChange={(e) =>
                    setPasswordForm((prev) => ({ ...prev, confirm_password: e.target.value }))
                  }
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
              </label>
              {passwordError && <p className="error">{passwordError}</p>}
              {passwordSuccess && <p className="success">{passwordSuccess}</p>}
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button type="submit" className="btn btn-primary" disabled={changingPassword}>
                  {changingPassword ? 'Updating…' : 'Update password'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={changingPassword}
                  onClick={() => {
                    setShowPasswordForm(false);
                    setPasswordError('');
                    setPasswordSuccess('');
                    setPasswordForm({
                      current_password: '',
                      new_password: '',
                      confirm_password: '',
                    });
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>
      )}
    </main>
  );
}
