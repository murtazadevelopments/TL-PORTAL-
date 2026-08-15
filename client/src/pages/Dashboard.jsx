import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../api/client';
import Navbar from '../components/Navbar';
import AvatarEditor from '../components/AvatarEditor';

const EMPLOYEE_EDIT_FIELDS = [
  'name',
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

function Dashboard() {
  const navigate = useNavigate();
  const editSectionRef = useRef(null);
  const [profile, setProfile] = useState(null);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [form, setForm] = useState({
    name: '',
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
  });
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [showAvatarEditor, setShowAvatarEditor] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [showIncompleteBanner, setShowIncompleteBanner] = useState(false);
  const [docUploading, setDocUploading] = useState('');
  const [docError, setDocError] = useState('');
  const [docSuccess, setDocSuccess] = useState('');
  const cnicFrontInputRef = useRef(null);
  const cnicBackInputRef = useRef(null);
  const cvInputRef = useRef(null);

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
          contact_number: data.contact_number || '',
          address: data.address || '',
          date_of_birth: data.date_of_birth
            ? String(data.date_of_birth).slice(0, 10)
            : '',
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

  function handlePasswordChange(e) {
    setPasswordForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
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
      const { data } = await api.put('/api/users/me', payload);
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

  async function handleAvatarSave(blob) {
    setAvatarSaving(true);
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
    } catch (err) {
      if (err.response?.status === 401) {
        localStorage.removeItem('token');
        navigate('/');
        return;
      }
      setError(err.response?.data?.message || 'Failed to update profile photo.');
    } finally {
      setAvatarSaving(false);
    }
  }

  async function handleDocumentUpload(field, file) {
    if (!file) return;
    setDocError('');
    setDocSuccess('');
    setDocUploading(field);
    try {
      const body = new FormData();
      body.append(field, file);
      const { data } = await api.put('/api/users/me/documents', body);
      const next = data.user || data;
      setProfile(next);
      setAvatarBroken(false);
      setDocSuccess(
        field === 'cv'
          ? 'CV updated.'
          : field === 'cnic_front'
            ? 'CNIC front updated.'
            : 'CNIC back updated.'
      );
    } catch (err) {
      setDocError(err.response?.data?.message || 'Failed to upload document.');
    } finally {
      setDocUploading('');
    }
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
              <div className="avatar-block">
                {showAvatar ? (
                  <img
                    className="avatar"
                    src={profile.profile_picture_url}
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
              <p className="muted">View or replace your CNIC images and CV.</p>
              {docError && <p className="error">{docError}</p>}
              {docSuccess && <p className="success">{docSuccess}</p>}
              <div className="doc-grid">
                <div className="doc-card doc-card-static">
                  {profile.cnic_front_url ? (
                    <a href={profile.cnic_front_url} target="_blank" rel="noreferrer">
                      <img src={profile.cnic_front_url} alt="CNIC front" />
                    </a>
                  ) : (
                    <span>No CNIC front</span>
                  )}
                  <span>CNIC front</span>
                  <input
                    ref={cnicFrontInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      handleDocumentUpload('cnic_front', file);
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={Boolean(docUploading)}
                    onClick={() => cnicFrontInputRef.current?.click()}
                  >
                    {docUploading === 'cnic_front'
                      ? 'Uploading…'
                      : profile.cnic_front_url
                        ? 'Change'
                        : 'Upload'}
                  </button>
                </div>

                <div className="doc-card doc-card-static">
                  {profile.cnic_back_url ? (
                    <a href={profile.cnic_back_url} target="_blank" rel="noreferrer">
                      <img src={profile.cnic_back_url} alt="CNIC back" />
                    </a>
                  ) : (
                    <span>No CNIC back</span>
                  )}
                  <span>CNIC back</span>
                  <input
                    ref={cnicBackInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      handleDocumentUpload('cnic_back', file);
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={Boolean(docUploading)}
                    onClick={() => cnicBackInputRef.current?.click()}
                  >
                    {docUploading === 'cnic_back'
                      ? 'Uploading…'
                      : profile.cnic_back_url
                        ? 'Change'
                        : 'Upload'}
                  </button>
                </div>

                <div className="doc-card doc-card-static">
                  {profile.cv_url ? (
                    <a
                      className="pdf-badge"
                      href={profile.cv_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      PDF
                    </a>
                  ) : (
                    <span className="pdf-badge">No CV</span>
                  )}
                  <span>{profile.cv_url ? 'View CV' : 'CV'}</span>
                  <input
                    ref={cvInputRef}
                    type="file"
                    accept="application/pdf"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      handleDocumentUpload('cv', file);
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={Boolean(docUploading)}
                    onClick={() => cvInputRef.current?.click()}
                  >
                    {docUploading === 'cv'
                      ? 'Uploading…'
                      : profile.cv_url
                        ? 'Change'
                        : 'Upload'}
                  </button>
                </div>
              </div>
            </section>

            <form
              id="edit-profile"
              ref={editSectionRef}
              onSubmit={handleSave}
              className="form"
            >
              <h2>Edit profile</h2>

              <label>
                Name
                <input
                  type="text"
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  required
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
                CNIC number (optional)
                <input
                  type="text"
                  name="cnic_number"
                  value={form.cnic_number}
                  onChange={handleChange}
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
                <select
                  name="last_job_status"
                  value={form.last_job_status}
                  onChange={handleChange}
                >
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
                <input
                  type="text"
                  name="address"
                  value={form.address}
                  onChange={handleChange}
                />
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

            <section className="form" style={{ marginTop: '2rem' }}>
              <h2>Security</h2>
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
                      onChange={handlePasswordChange}
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
                      onChange={handlePasswordChange}
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
                      onChange={handlePasswordChange}
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
          </>
        )}

        {!loading && !profile && error && <p className="error">{error}</p>}
      </main>

      <AvatarEditor
        open={showAvatarEditor}
        currentUrl={profile?.profile_picture_url || null}
        saving={avatarSaving}
        onClose={() => !avatarSaving && setShowAvatarEditor(false)}
        onSave={handleAvatarSave}
      />
    </div>
  );
}

export default Dashboard;
