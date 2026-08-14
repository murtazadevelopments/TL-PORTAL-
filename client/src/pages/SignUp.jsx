import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';
import Navbar from '../components/Navbar';
import PasswordInput from '../components/PasswordInput';
import logo from '../assets/logo.png';

const LAST_JOB_OPTIONS = [
  { value: 'still_employed', label: 'Still employed elsewhere' },
  { value: 'resigned', label: 'Resigned' },
  { value: 'terminated', label: 'Terminated' },
  { value: 'fresh_graduate', label: 'Fresh graduate' },
  { value: 'other', label: 'Other' },
];

const INITIAL = {
  username: '',
  name: '',
  email: '',
  password: '',
  contact_number: '',
  address: '',
  cnic_number: '',
  department: '',
  education: '',
  last_job_status: '',
  bank_name: '',
  account_title: '',
  account_number: '',
  iban: '',
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
  const [success, setSuccess] = useState('');
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
    setSuccess('');

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

    if (!files.cv || !files.profile_picture) {
      setError('Please upload CV and profile picture.');
      return;
    }

    setLoading(true);

    try {
      const body = new FormData();
      Object.entries({ ...form, username: normalizedUsername }).forEach(([key, value]) => {
        if (value !== '' && value != null) body.append(key, value);
      });
      if (files.cnic_front) body.append('cnic_front', files.cnic_front);
      if (files.cnic_back) body.append('cnic_back', files.cnic_back);
      body.append('cv', files.cv);
      body.append('profile_picture', files.profile_picture);

      const { data } = await api.post('/api/auth/signup', body);

      localStorage.removeItem('token');
      setSuccess(
        data.message ||
          'Your account has been created and is pending admin approval. You can sign in once an administrator activates it.'
      );
      setTimeout(() => navigate('/'), 2500);
    } catch (err) {
      const status = err.response?.status;
      const apiMsg = err.response?.data?.message;
      if (apiMsg) setError(apiMsg);
      else if (status === 503 || !err.response)
        setError('Server unavailable. The API is not running — check Hostinger Node deploy and env vars.');
      else setError('Unable to create account.');
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

          <label>
            Name
            <input type="text" name="name" value={form.name} onChange={handleChange} required />
          </label>

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
            Education
            <input
              type="text"
              name="education"
              value={form.education}
              onChange={handleChange}
              required
              placeholder="e.g. Bachelors in Computer Science"
            />
          </label>

          <label>
            Last job status
            <select
              name="last_job_status"
              value={form.last_job_status}
              onChange={handleChange}
              required
            >
              <option value="">Select status</option>
              {LAST_JOB_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <h2>Banking details</h2>
          <div className="grid-2">
            <label>
              Bank name
              <input
                type="text"
                name="bank_name"
                value={form.bank_name}
                onChange={handleChange}
                required
              />
            </label>
            <label>
              Account title
              <input
                type="text"
                name="account_title"
                value={form.account_title}
                onChange={handleChange}
                required
              />
            </label>
          </div>
          <div className="grid-2">
            <label>
              Account number
              <input
                type="text"
                name="account_number"
                value={form.account_number}
                onChange={handleChange}
                required
              />
            </label>
            <label>
              IBAN
              <input type="text" name="iban" value={form.iban} onChange={handleChange} required />
            </label>
          </div>

          <label>
            CNIC number (optional)
            <input
              type="text"
              name="cnic_number"
              value={form.cnic_number}
              onChange={handleChange}
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
              CNIC front (optional)
              <input
                type="file"
                name="cnic_front"
                accept="image/*"
                onChange={handleFileChange}
              />
            </label>
            <label>
              CNIC back (optional)
              <input
                type="file"
                name="cnic_back"
                accept="image/*"
                onChange={handleFileChange}
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
          {success && <p className="success">{success}</p>}

          <button type="submit" className="btn btn-primary" disabled={loading || Boolean(success)}>
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
