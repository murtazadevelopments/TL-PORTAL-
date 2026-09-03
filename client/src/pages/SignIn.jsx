import { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router';
import { startAuthentication } from '@simplewebauthn/browser';
import api from '../api/client';
import Navbar from '../components/Navbar';
import PasswordInput from '../components/PasswordInput';
import logo from '../assets/logo.webp';

function supportsWebAuthn() {
  return (
    typeof window !== 'undefined' &&
    window.PublicKeyCredential &&
    typeof navigator.credentials?.get === 'function'
  );
}

function SignIn() {
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);
  const [webauthnOk] = useState(() => supportsWebAuthn());
  const [hasPasskey, setHasPasskey] = useState(false);

  useEffect(() => {
    const msg = location.state?.inactivityMessage;
    if (msg) setInfo(String(msg));
  }, [location.state]);

  useEffect(() => {
    if (!webauthnOk) {
      setHasPasskey(false);
      return;
    }
    const username = form.username.trim().toLowerCase();
    if (username.length < 3) {
      setHasPasskey(false);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/api/auth/webauthn/has-credential', {
          params: { username },
        });
        if (!cancelled) setHasPasskey(Boolean(data?.hasCredential));
      } catch {
        if (!cancelled) setHasPasskey(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [form.username, webauthnOk]);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: name === 'username' ? value.toLowerCase() : value,
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);

    try {
      const { collectDeviceHints } = await import('../utils/deviceHints');
      const deviceHints = await collectDeviceHints();
      const { data } = await api.post('/api/auth/login', {
        username: form.username.trim().toLowerCase(),
        password: form.password,
        deviceHints,
      });
      localStorage.setItem('token', data.token);
      const { enablePushNotificationsSafe } = await import('../utils/pushNotifications');
      enablePushNotificationsSafe();
      navigate('/dashboard');
    } catch (err) {
      const status = err.response?.status;
      const apiMsg = err.response?.data?.message;
      if (apiMsg) setError(apiMsg);
      else if (status === 503 || !err.response)
        setError('Server unavailable. Please contact your admin');
      else setError('Unable to sign in.');
    } finally {
      setLoading(false);
    }
  }

  async function handleBiometricLogin() {
    setError('');
    setInfo('');
    const username = form.username.trim().toLowerCase();
    if (!username) {
      setError('Enter your username first, then use Face/Fingerprint login.');
      return;
    }
    setBioLoading(true);
    try {
      const { data: options } = await api.post('/api/auth/webauthn/login-options', {
        username,
      });
      const assertion = await startAuthentication({
        optionsJSON: options,
        useBrowserAutofill: false,
      });
      const { collectDeviceHints } = await import('../utils/deviceHints');
      const deviceHints = await collectDeviceHints();
      const { data } = await api.post('/api/auth/webauthn/login-verify', {
        username,
        response: assertion,
        deviceHints,
      });
      localStorage.setItem('token', data.token);
      const { enablePushNotificationsSafe } = await import('../utils/pushNotifications');
      enablePushNotificationsSafe();
      navigate('/dashboard');
    } catch (err) {
      if (err?.name === 'NotAllowedError') {
        setError('Biometric login was cancelled or timed out.');
      } else {
        setError(
          err.response?.data?.message ||
            err.message ||
            'Face/Fingerprint login failed.'
        );
      }
    } finally {
      setBioLoading(false);
    }
  }

  return (
    <div className="page">
      <Navbar />
      <main className="card">
        <div className="brand-hero">
          <img src={logo} alt="Textured Lab Portal" width={200} height={200} />
          <p className="brand-name">Textured Lab Portal</p>
        </div>

        <h1>Sign in</h1>
        <p className="muted">Enter the lab — access your employee portal</p>

        <form onSubmit={handleSubmit} className="form">
          <label>
            Username
            <input
              type="text"
              name="username"
              value={form.username}
              onChange={handleChange}
              required
              autoComplete="username"
              minLength={3}
              maxLength={30}
              pattern="[a-z0-9._]+"
              title="lowercase letters, numbers, dots, and underscores only"
            />
          </label>

          <PasswordInput
            name="password"
            value={form.password}
            onChange={handleChange}
            required
            autoComplete="current-password"
          />

          {info && <p className="success">{info}</p>}
          {error && <p className="error">{error}</p>}

          <button type="submit" className="btn btn-primary" disabled={loading || bioLoading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>

          {webauthnOk && hasPasskey && (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={loading || bioLoading}
              onClick={handleBiometricLogin}
            >
              {bioLoading ? 'Waiting for biometric…' : 'Login with Face/Fingerprint'}
            </button>
          )}
        </form>

        <p className="muted center auth-links">
          <Link to="/forgot-username">Forgot username?</Link>
          {' · '}
          <Link to="/forgot-password">Forgot password?</Link>
        </p>

        <p className="muted center">
          <a href="/pwa-reset.html">App looks outdated? Tap to refresh</a>
        </p>

        <p className="muted center">
          No account? <Link to="/signup">Create one</Link>
        </p>
      </main>
    </div>
  );
}

export default SignIn;
