import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';
import Navbar from '../components/Navbar';
import PasswordInput from '../components/PasswordInput';
import logo from '../assets/logo.png';

const INITIAL = {
  username: '',
  first_name: '',
  father_name: '',
  email: '',
  password: '',
  contact_number: '',
  address: '',
  cnic_number: '',
  department: '',
};

const USERNAME_REGEX = /^[a-z0-9._]+$/;

function SignUp() {
  const navigate = useNavigate();
  const [form, setForm] = useState(INITIAL);
  const [files, setFiles] = useState({
    cnic_front: null,
    cnic_back: null,
    cv: null,
    profile_picture: null,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: name === 'username' ? value.toLowerCase() : value,
    }));
  }

  function handleFileChange(e) {
    const { name, files: list } = e.target;
    setFiles((prev) => ({ ...prev, [name]: list?.[0] || null }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const normalizedUsername = form.username.trim().toLowerCase();
    if (
      normalizedUsername.length < 3 ||
      normalizedUsername.length > 30 ||
      !USERNAME_REGEX.test(normalizedUsername)
    ) {
      setError(
        'Username must be 3–30 characters and use lowercase letters, numbers, dots, and underscores only.'
      );
      return;
    }

    if (!files.cnic_front || !files.cnic_back || !files.cv || !files.profile_picture) {
      setError('Please upload CNIC front, CNIC back, CV, and profile picture.');
      return;
    }

    setLoading(true);

    try {
      // Multipart signup — do NOT JSON.stringify; let the browser set the boundary
      const body = new FormData();
      Object.entries({ ...form, username: normalizedUsername }).forEach(([key, value]) => {
        if (value !== '' && value != null) body.append(key, value);
      });
      body.append('cnic_front', files.cnic_front);
      body.append('cnic_back', files.cnic_back);
      body.append('cv', files.cv);
      body.append('profile_picture', files.profile_picture);

      // Let the browser set multipart Content-Type + boundary
      const { data } = await api.post('/api/auth/signup', body);

      localStorage.setItem('token', data.token);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to create account.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <Navbar />
      <main className="card wide">
        <div className="brand-hero">
          <img src={logo} alt="Textured Lab" />
          <p className="brand-name">Textured Lab</p>
        </div>

        <h1>Join the lab</h1>
        <p className="muted">Create your employee account and upload documents</p>

        <form onSubmit={handleSubmit} className="form" encType="multipart/form-data">
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
            <span className="field-hint">
              lowercase letters, numbers, dots, and underscores only
            </span>
          </label>

          <div className="grid-2">
            <label>
              First name
              <input
                type="text"
                name="first_name"
                value={form.first_name}
                onChange={handleChange}
                required
              />
            </label>

            <label>
              Father name
              <input
                type="text"
                name="father_name"
                value={form.father_name}
                onChange={handleChange}
                required
              />
            </label>
          </div>

          <label>
            Email
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              required
              autoComplete="email"
            />
          </label>

          <PasswordInput
            name="password"
            value={form.password}
            onChange={handleChange}
            required
            minLength={6}
            autoComplete="new-password"
          />

          <div className="grid-2">
            <label>
              Contact number
              <input
                type="tel"
                name="contact_number"
                value={form.contact_number}
                onChange={handleChange}
                required
              />
            </label>

            <label>
              CNIC number
              <input
                type="text"
                name="cnic_number"
                value={form.cnic_number}
                onChange={handleChange}
                required
              />
            </label>
          </div>

          <label>
            Address
            <input
              type="text"
              name="address"
              value={form.address}
              onChange={handleChange}
              required
            />
          </label>

          <label>
            Department (optional)
            <input
              type="text"
              name="department"
              value={form.department}
              onChange={handleChange}
            />
          </label>

          <div className="grid-2">
            <label>
              CNIC front
              <input
                type="file"
                name="cnic_front"
                accept="image/*"
                onChange={handleFileChange}
                required
              />
            </label>

            <label>
              CNIC back
              <input
                type="file"
                name="cnic_back"
                accept="image/*"
                onChange={handleFileChange}
                required
              />
            </label>
          </div>

          <div className="grid-2">
            <label>
              CV (PDF)
              <input
                type="file"
                name="cv"
                accept=".pdf,application/pdf"
                onChange={handleFileChange}
                required
              />
            </label>

            <label>
              Profile picture
              <input
                type="file"
                name="profile_picture"
                accept="image/*"
                onChange={handleFileChange}
                required
              />
            </label>
          </div>

          {error && <p className="error">{error}</p>}

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="muted center">
          Already registered? <Link to="/">Sign in</Link>
        </p>
      </main>
    </div>
  );
}

export default SignUp;
