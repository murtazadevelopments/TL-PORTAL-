import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../../api/client';
import AvatarEditor from '../../components/AvatarEditor';
import { useInactivityGuard } from '../../components/InactivityGuard';
import { useAuthUser } from '../../context/AuthUserContext';
import { withAuthDocumentUrl } from '../../utils/documentUrls';

const EMPLOYEE_EDIT_FIELDS = [
  'name',
  'email',
  'contact_number',
  'address',
  'date_of_birth',
  'reference_person_name',
  'emergency_contact_name',
  'emergency_contact_number',
  'bank_name',
  'account_title',
  'iban',
  'account_number',
  'education',
  'last_job_status',
  'cnic_number',
];

const FIELD_LABELS = {
  date_of_birth: 'Date of birth',
  reference_person_name: 'Reference person',
  emergency_contact_name: 'Emergency contact name',
  emergency_contact_number: 'Emergency contact number',
  bank_name: 'Bank name',
  account_title: 'Account title',
  iban: 'IBAN',
  account_number: 'Account number',
};

const INCOMPLETE_CHECK_FIELDS = [
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

const EMPTY_FORM = {
  name: '',
  email: '',
  contact_number: '',
  address: '',
  date_of_birth: '',
  reference_person_name: '',
  emergency_contact_name: '',
  emergency_contact_number: '',
  bank_name: '',
  account_title: '',
  iban: '',
  account_number: '',
  education: '',
  last_job_status: '',
  cnic_number: '',
};

export default function AccountProfile() {
  const navigate = useNavigate();
  const { setBusy } = useInactivityGuard();
  const { refreshUser } = useAuthUser();
  const editSectionRef = useRef(null);
  const [profile, setProfile] = useState(null);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAvatarEditor, setShowAvatarEditor] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [showIncompleteBanner, setShowIncompleteBanner] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadProfile() {
      try {
        const { data } = await api.get('/api/users/me');
        if (!active) return;
        setProfile(data);
        setAvatarBroken(false);
        setForm({
          name: data.name || '',
          email: data.email || '',
          contact_number: data.contact_number || '',
          address: data.address || '',
          date_of_birth: data.date_of_birth ? String(data.date_of_birth).slice(0, 10) : '',
          reference_person_name: data.reference_person_name || '',
          emergency_contact_name: data.emergency_contact_name || '',
          emergency_contact_number: data.emergency_contact_number || '',
          bank_name: data.bank_name || '',
          account_title: data.account_title || '',
          iban: data.iban || '',
          account_number: data.account_number || '',
          education: data.education || '',
          last_job_status: data.last_job_status || '',
          cnic_number: data.cnic_number || '',
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
    const payload = {};
    for (const key of EMPLOYEE_EDIT_FIELDS) payload[key] = form[key];
    try {
      const { data } = await api.put('/api/users/me', payload);
      setProfile(data);
      setForm((prev) => ({
        ...prev,
        email: data.email || prev.email,
        cnic_number: data.cnic_number || '',
        name: data.name || prev.name,
      }));
      setSuccess('Profile updated.');
      refreshUser();
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

  async function handleAvatarSave(blob) {
    setAvatarSaving(true);
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const body = new FormData();
      body.append('profile_picture', blob, 'profile.jpg');
      const { data } = await api.put('/api/users/me/avatar', body);
      setProfile(data);
      setAvatarBroken(false);
      setShowAvatarEditor(false);
      setSuccess('Profile photo updated.');
      refreshUser();
    } catch (err) {
      if (err.response?.status === 401) {
        localStorage.removeItem('token');
        navigate('/');
        return;
      }
      setError(err.response?.data?.message || 'Failed to update profile photo.');
    } finally {
      setAvatarSaving(false);
      setBusy(false);
    }
  }

  const avatarSrc = withAuthDocumentUrl(
    profile?.profile_picture_url,
    profile?.updated_at || profile?.id
  );
  const showAvatar = Boolean(avatarSrc) && !avatarBroken;

  return (
    <>
      <main className="card wide page-panel">
        <h1>Profile</h1>
        <p className="muted">Your Textured Lab Portal employee profile</p>

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
              <button
                type="button"
                className="btn btn-primary"
                onClick={() =>
                  editSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              >
                Complete profile
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => {
                  sessionStorage.setItem('profileIncompleteDismissed', '1');
                  setShowIncompleteBanner(false);
                }}
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
              <div className="avatar-block">
                {showAvatar ? (
                  <img
                    className="avatar"
                    src={avatarSrc}
                    alt=""
                    onError={() => setAvatarBroken(true)}
                  />
                ) : (
                  <div className="avatar placeholder">
                    {(profile.name || '?').charAt(0).toUpperCase()}
                  </div>
                )}
                <button
                  type="button"
                  className="btn btn-ghost avatar-edit-btn"
                  onClick={() => setShowAvatarEditor(true)}
                >
                  Change / adjust photo
                </button>
              </div>
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

            <form id="edit-profile" ref={editSectionRef} onSubmit={handleSave} className="form">
              <h2>Edit profile</h2>
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
                CNIC number
                <input
                  type="text"
                  name="cnic_number"
                  value={form.cnic_number}
                  onChange={handleChange}
                  placeholder="e.g. 42101-1234567-1"
                />
              </label>
              <label>
                Education
                <input
                  type="text"
                  name="education"
                  value={form.education}
                  onChange={handleChange}
                />
              </label>
              <label>
                Last job status
                <select name="last_job_status" value={form.last_job_status} onChange={handleChange}>
                  <option value="">Select status</option>
                  <option value="still_employed">Still employed elsewhere</option>
                  <option value="resigned">Resigned</option>
                  <option value="terminated">Terminated</option>
                  <option value="fresh_graduate">Fresh graduate</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                Address
                <input type="text" name="address" value={form.address} onChange={handleChange} />
              </label>
              <label>
                Date of birth
                <input
                  type="date"
                  name="date_of_birth"
                  value={form.date_of_birth}
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
                  <input type="text" name="bank_name" value={form.bank_name} onChange={handleChange} />
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

      <AvatarEditor
        open={showAvatarEditor}
        currentUrl={avatarSrc || null}
        saving={avatarSaving}
        onClose={() => !avatarSaving && setShowAvatarEditor(false)}
        onSave={handleAvatarSave}
      />
    </>
  );
}
