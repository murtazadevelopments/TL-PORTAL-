import { useState } from 'react';
import { Link } from 'react-router';
import api from '../api/client';
import Navbar from '../components/Navbar';
import logo from '../assets/logo.webp';

function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const { data } = await api.post('/api/auth/forgot-password', {
        email: email.trim().toLowerCase(),
      });
      setMessage(data.message);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to process request.');
    } finally {
      setLoading(false);
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
        <h1>Forgot password</h1>
        <p className="muted">Enter your email and we&apos;ll send a reset link.</p>
        <form onSubmit={handleSubmit} className="form">
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          {error && <p className="error">{error}</p>}
          {message && <p className="success">{message}</p>}
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
        <p className="muted center">
          <Link to="/">Back to sign in</Link>
        </p>
      </main>
    </div>
  );
}

export default ForgotPassword;
