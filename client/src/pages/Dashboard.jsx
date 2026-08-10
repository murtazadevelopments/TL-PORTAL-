import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import Navbar from '../components/Navbar';

const EMPLOYEE_EDIT_FIELDS = [
  'first_name',
  'father_name',
  'contact_number',
  'address',
  'date_of_joining',
  'reference_person_name',
  'emergency_contact_name',
  'emergency_contact_number',
  'bank_name',
  'account_title',
  'iban',
  'account_number',
];

const FIELD_LABELS = {
  date_of_joining: 'Date of joining',
  reference_person_name: 'Reference person',
  emergency_contact_name: 'Emergency contact name',
  emergency_contact_number: 'Emergency contact number',
  bank_name: 'Bank name',
  account_title: 'Account title',
  iban: 'IBAN',
  account_number: 'Account number',
};

const INCOMPLETE_CHECK_FIELDS = [
  'date_of_joining',
  'reference_person_name',
  'emergency_contact_name',
  'emergency_contact_number',
  'bank_name',
  'account_title',
  'iban',
  'account_number',
];

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function Dashboard() {
  const navigate = useNavigate();
  const editSectionRef = useRef(null);
  const [profile, setProfile] = useState(null);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [form, setForm] = useState({
    first_name: '',
    father_name: '',
    contact_number: '',
    address: '',
    date_of_joining: '',
    reference_person_name: '',
    emergency_contact_name: '',
    emergency_contact_number: '',
    bank_name: '',
    account_title: '',
    iban: '',
    account_number: '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showIncompleteBanner, setShowIncompleteBanner] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      try {
        const { data } = await api.get('/users/me');
        if (!active) return;
        setProfile(data);
        setAvatarBroken(false);
        setForm({
          first_name: data.first_name || '',
          father_name: data.father_name || '',
          contact_number: data.contact_number || '',
          address: data.address || '',
          date_of_joining: data.date_of_joining
            ? String(data.date_of_joining).slice(0, 10)
            : '',
          reference_person_name: data.reference_person_name || '',
          emergency_contact_name: data.emergency_contact_name || '',
          emergency_contact_number: data.emergency_contact_number || '',
          bank_name: data.bank_name || '',
          account_title: data.account_title || '',
          iban: data.iban || '',
          account_number: data.account_number || '',
        });

        const dismissed = sessionStorage.getItem('profileIncompleteDismissed') === '1';
        const missing = INCOMPLETE_CHECK_FIELDS.filter((key) => isBlank(data[key]));
        setShowIncompleteBanner(!dismissed && missing.length > 0);
      } catch (err) {
        if (!active) return;
        if (err.response?.status === 401) {
          localStorage.removeItem('token');
          navigate('/');
          return;
        }
        setError(err.response?.data?.message || 'Failed to load profile.');
      } finally {
        if (active) setLoading(false);
      }
    }

    loadProfile();
    return () => {
      active = false;
    };
  }, [navigate]);

  const missingEmployeeFields = useMemo(() => {
    if (!profile) return [];
    return INCOMPLETE_CHECK_FIELDS.filter((key) => isBlank(profile[key])).map(
      (key) => FIELD_LABELS[key]
    );
  }, [profile]);

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);

    // Send only employee-editable fields (never admin-locked fields)
    const payload = {};
    for (const key of EMPLOYEE_EDIT_FIELDS) {
      payload[key] = form[key];
    }

    try {
      const { data } = await api.put('/users/me', payload);
      setProfile(data);
      setSuccess('Profile updated.');

      const missing = INCOMPLETE_CHECK_FIELDS.filter((key) => isBlank(data[key]));
      if (missing.length === 0) {
        setShowIncompleteBanner(false);
        sessionStorage.removeItem('profileIncompleteDismissed');
      }
    } catch (err) {
      if (err.response?.status === 401) {
        localStorage.removeItem('token');
        navigate('/');
        return;
      }
      setError(err.response?.data?.message || 'Failed to update profile.');
    } finally {
      setSaving(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem('token');
    navigate('/');
  }

  function dismissIncompleteBanner() {
    sessionStorage.setItem('profileIncompleteDismissed', '1');
    setShowIncompleteBanner(false);
  }

  function goToEditProfile() {
    editSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const showAvatar = profile?.profile_picture_url && !avatarBroken;

  return (
    <div className="page">
      <Navbar showLogout onLogout={handleLogout} role={profile?.role} />

      <main className="card wide">
        <h1>Dashboard</h1>
        <p className="muted">Your Textured Lab employee profile</p>

        {loading && <p className="muted">Loading profile…</p>}

        {!loading && profile && showIncompleteBanner && missingEmployeeFields.length > 0 && (
          <div className="alert-banner" role="status">
            <div>
              <strong>Your profile is incomplete.</strong>
              <p className="muted" style={{ margin: '0.35rem 0 0' }}>
                Please fill in: {missingEmployeeFields.join(', ')}
              </p>
            </div>
            <div className="alert-actions">
              <button type="button" className="btn btn-primary" onClick={goToEditProfile}>
                Complete profile
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={dismissIncompleteBanner}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {!loading && profile && (
          <>
            <section className="profile-header">
              {showAvatar ? (
                <img
                  className="avatar"
                  src={profile.profile_picture_url}
                  alt=""
                  onError={() => setAvatarBroken(true)}
                />
              ) : (
                <div className="avatar placeholder">
                  {(profile.first_name || '?').charAt(0).toUpperCase()}
                </div>
              )}

              <div className="meta">
                <p>
                  <span className="label">Employee ID</span>
                  <strong>{profile.employee_id || 'Not assigned'}</strong>
                </p>
                <p>
                  <span className="label">Username</span>
                  <strong>{profile.username}</strong>
                </p>
                <p>
                  <span className="label">Email</span>
                  <strong>{profile.email}</strong>
                </p>
                <p>
                  <span className="label">CNIC</span>
                  <strong>{profile.cnic_number}</strong>
                </p>
                <p>
                  <span className="label">Role</span>
                  <strong>{profile.role}</strong>
                </p>
              </div>
            </section>

            {/* Admin-assigned fields — read-only for employees */}
            <section className="readonly-grid">
              <h2>Work assignment</h2>
              <p className="muted">These fields are managed by admin and cannot be edited here.</p>
              <div className="detail-grid readonly-cards">
                <p>
                  <span className="label">Status</span>
                  <strong>{profile.status || '—'}</strong>
                </p>
                <p>
                  <span className="label">Department</span>
                  <strong>{profile.department || '—'}</strong>
                </p>
                <p>
                  <span className="label">Designation</span>
                  <strong>{profile.designation || '—'}</strong>
                </p>
                <p>
                  <span className="label">Branch</span>
                  <strong>{profile.branch || '—'}</strong>
                </p>
                <p>
                  <span className="label">Shift</span>
                  <strong>{profile.shift || '—'}</strong>
                </p>
                <p>
                  <span className="label">Salary</span>
                  <strong>{profile.salary ?? '—'}</strong>
                </p>
              </div>
            </section>

            <section className="docs">
              <h2>Documents</h2>
              <div className="doc-grid">
                <a
                  className="doc-card"
                  href={profile.cnic_front_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {profile.cnic_front_url ? (
                    <img src={profile.cnic_front_url} alt="CNIC front" />
                  ) : (
                    <span>No CNIC front</span>
                  )}
                  <span>CNIC front</span>
                </a>

                <a
                  className="doc-card"
                  href={profile.cnic_back_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {profile.cnic_back_url ? (
                    <img src={profile.cnic_back_url} alt="CNIC back" />
                  ) : (
                    <span>No CNIC back</span>
                  )}
                  <span>CNIC back</span>
                </a>

                <a className="doc-card" href={profile.cv_url} target="_blank" rel="noreferrer">
                  <span className="pdf-badge">PDF</span>
                  <span>View CV</span>
                </a>
              </div>
            </section>

            <form
              id="edit-profile"
              ref={editSectionRef}
              onSubmit={handleSave}
              className="form"
            >
              <h2>Edit profile</h2>

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
                Contact number
                <input
                  type="tel"
                  name="contact_number"
                  value={form.contact_number}
                  onChange={handleChange}
                />
              </label>

              <label>
                Address
                <input
                  type="text"
                  name="address"
                  value={form.address}
                  onChange={handleChange}
                />
              </label>

              <label>
                Date of joining
                <input
                  type="date"
                  name="date_of_joining"
                  value={form.date_of_joining}
                  onChange={handleChange}
                />
              </label>

              <label>
                Reference person
                <input
                  type="text"
                  name="reference_person_name"
                  value={form.reference_person_name}
                  onChange={handleChange}
                />
              </label>

              <div className="grid-2">
                <label>
                  Emergency contact name
                  <input
                    type="text"
                    name="emergency_contact_name"
                    value={form.emergency_contact_name}
                    onChange={handleChange}
                  />
                </label>

                <label>
                  Emergency contact number
                  <input
                    type="tel"
                    name="emergency_contact_number"
                    value={form.emergency_contact_number}
                    onChange={handleChange}
                  />
                </label>
              </div>

              <h2>Bank details</h2>

              <div className="grid-2">
                <label>
                  Bank name
                  <input
                    type="text"
                    name="bank_name"
                    value={form.bank_name}
                    onChange={handleChange}
                  />
                </label>

                <label>
                  Account title
                  <input
                    type="text"
                    name="account_title"
                    value={form.account_title}
                    onChange={handleChange}
                  />
                </label>
              </div>

              <div className="grid-2">
                <label>
                  IBAN
                  <input type="text" name="iban" value={form.iban} onChange={handleChange} />
                </label>

                <label>
                  Account number
                  <input
                    type="text"
                    name="account_number"
                    value={form.account_number}
                    onChange={handleChange}
                  />
                </label>
              </div>

              {error && <p className="error">{error}</p>}
              {success && <p className="success">{success}</p>}

              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </form>
          </>
        )}

        {!loading && !profile && error && <p className="error">{error}</p>}
      </main>
    </div>
  );
}

export default Dashboard;
