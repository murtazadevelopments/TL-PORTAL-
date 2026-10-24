import { useState } from 'react';
import { Link } from 'react-router';
import api from '../api/client';
import Navbar from '../components/Navbar';
import logo from '../assets/logo.webp';

function AccountRecovery({ mode }) {
  const isPassword = mode === 'password';
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [cnic, setCnic] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function goToCnic(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!email.trim() && !username.trim()) {
      setError('Enter your email or username.');
      return;
    }
    setStep(2);
  }

  async function sendRecovery(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!cnic.trim()) {
      setError('Invalid CNIC number.');
      return;
    }
    setLoading(true);
    try {
      const path = isPassword ? '/api/auth/forgot-password' : '/api/auth/forgot-username';
      const { data } = await api.post(path, {
        email: email.trim().toLowerCase(),
        username: username.trim().toLowerCase(),
        cnic: cnic.trim(),
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
        <h1>{isPassword ? 'Forgot password' : 'Forgot username'}</h1>
        <p className="muted">
          {step === 1
            ? 'Step 1 of 2 — enter your email or username. One is enough.'
            : 'Step 2 of 2 — enter the CNIC registered with that email.'}
        </p>
        {step === 1 ? (
          <form onSubmit={goToCnic} className="form">
            <label>
              Email
              <input
                type="email"
                name="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                data-input-kind="email"
              />
            </label>
            <label>
              Username
              <input
                type="text"
                name="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                data-input-kind="username"
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button type="submit" className="btn btn-primary">
              Continue
            </button>
          </form>
        ) : (
          <form onSubmit={sendRecovery} className="form">
            <label>
              CNIC number
              <input
                type="text"
                name="cnic_number"
                value={cnic}
                onChange={(e) => setCnic(e.target.value)}
                required
                inputMode="numeric"
                autoComplete="off"
                data-input-kind="integer"
                maxLength={13}
                placeholder="13-digit CNIC"
              />
            </label>
            {error && <p className="error">{error}</p>}
            {message && <p className="success">{message}</p>}
            <button type="submit" className="btn btn-primary" disabled={loading || Boolean(message)}>
              {loading ? 'Sending…' : isPassword ? 'Send reset link' : 'Send username'}
            </button>
            {!message && (
              <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>
                Back
              </button>
            )}
          </form>
        )}
        <p className="muted center">
          <Link to="/">Back to sign in</Link>
        </p>
      </main>
    </div>
  );
}

export default AccountRecovery;
