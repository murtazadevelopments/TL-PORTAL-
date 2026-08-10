import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';
import Navbar from '../components/Navbar';
import PasswordInput from '../components/PasswordInput';
import logo from '../assets/logo.png';

function SignIn() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
    setLoading(true);

    try {
      const { data } = await api.post('/auth/login', {
        username: form.username.trim().toLowerCase(),
        password: form.password,
      });
      localStorage.setItem('token', data.token);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to sign in.');
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

          {error && <p className="error">{error}</p>}

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="muted center">
          No account? <Link to="/signup">Create one</Link>
        </p>
      </main>
    </div>
  );
}

export default SignIn;
