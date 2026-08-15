import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import api from '../api/client';
import Navbar from '../components/Navbar';
import PasswordInput from '../components/PasswordInput';
import logo from '../assets/logo.png';

function ResetPassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = useMemo(() => params.get('token') || '', [params]);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setMessage('');

    if (!token) {
      setError('Missing reset token. Use the link from your email.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/api/auth/reset-password', { token, password });
      setMessage(data.message);
      setTimeout(() => navigate('/'), 1500);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to reset password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <Navbar />
      <main className="card">
        <div className="brand-hero">
          <img src={logo} alt="Textured Lab" />
          <p className="brand-name">Textured Lab</p>
        </div>
        <h1>Reset password</h1>
        <p className="muted">Choose a new password for your account.</p>
        <form onSubmit={handleSubmit} className="form">
          <PasswordInput
            name="password"
            label="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
          />
          <PasswordInput
            name="confirm"
            label="Confirm password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
          />
          {error && <p className="error">{error}</p>}
          {message && <p className="success">{message}</p>}
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Updating…' : 'Update password'}
          </button>
        </form>
        <p className="muted center">
          <Link to="/">Back to sign in</Link>
        </p>
      </main>
    </div>
  );
}

export default ResetPassword;
