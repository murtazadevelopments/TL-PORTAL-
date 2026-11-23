import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import api from '../../api/client';
import AvatarEditor from '../../components/AvatarEditor';
import { useInactivityGuard } from '../../components/InactivityGuard';
import { useAuthUser } from '../../context/AuthUserContext';
import { withAuthDocumentUrl } from '../../utils/documentUrls';
import {
  missingEmployeePortalFields,
  isProfileIncompleteLocked,
  isPhotoAlertLocked,
} from '../../utils/profileCompleteness';
import { useFlashSuccess } from '../../utils/successPopup';
import {
  CNIC_FORMAT_HINT,
  CNIC_INVALID_MESSAGE,
  formatCnic,
  normalizeCnicForSubmit,
} from '../../utils/cnicFormat';
import {
  CONTACT_FORMAT_HINT,
  CONTACT_INVALID_MESSAGE,
  formatContactDisplay,
  formatContactNumber,
  normalizeContactForSubmit,
} from '../../utils/contactFormat';
import '../../components/ProfileIncompleteLock.css';

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
  employment_type: '',
  cnic_number: '',
};

function formFromProfile(data) {
  if (!data) return { ...EMPTY_FORM };
  return {
    name: data.name || '',
    email: data.email || '',
    contact_number: formatContactDisplay(data.contact_number || ''),
    address: data.address || '',
    date_of_birth: data.date_of_birth ? String(data.date_of_birth).slice(0, 10) : '',
    reference_person_name: data.reference_person_name || '',
    emergency_contact_name: data.emergency_contact_name || '',
    emergency_contact_number: formatContactDisplay(data.emergency_contact_number || ''),
    bank_name: data.bank_name || '',
    account_title: data.account_title || '',
    iban: data.iban || '',
    account_number: data.account_number || '',
    education: data.education || '',
    last_job_status: data.last_job_status || '',
    employment_type: data.employment_type || '',
    cnic_number: formatCnic(data.cnic_number || ''),
  };
}

export default function AccountProfile() {
  const navigate = useNavigate();
  const { user: authUser, loading: authLoading, refreshUser } = useAuthUser();
  const { setBusy } = useInactivityGuard();
  const editSectionRef = useRef(null);
  const [profile, setProfile] = useState(null);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  useFlashSuccess(success);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAvatarEditor, setShowAvatarEditor] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [showIncompleteBanner, setShowIncompleteBanner] = useState(false);

  useEffect(() => {
    if (authLoading) return undefined;
    let active = true;
    async function loadProfile() {
      try {
        const data = authUser;
        if (!data) {
          if (active) navigate('/', { replace: true });
          return;
        }
        if (!active) return;
        setProfile(data);
        setAvatarBroken(false);
        setForm(formFromProfile(data));
        const dismissed = sessionStorage.getItem('profileIncompleteDismissed') === '1';
        const missing = missingEmployeePortalFields(data);
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
  }, [navigate, authLoading, authUser]);

  const missingEmployeeFields = useMemo(
    () => (profile ? missingEmployeePortalFields(profile) : []),
    [profile]
  );
  const locked = isProfileIncompleteLocked(profile);
  const photoLocked = isPhotoAlertLocked(profile);
  const missingKeys = new Set(missingEmployeeFields.map((field) => field.key));
  const fieldRequired = (key) => locked && missingKeys.has(key);
  const missingLabels = missingEmployeeFields.map((field) => field.label);
  const missingDocs = missingEmployeeFields.some((field) => field.document);
  const missingText = missingEmployeeFields.some((field) => !field.document);

  function handleChange(e) {
    const { name, value } = e.target;
    if (name === 'cnic_number') {
      setForm((prev) => ({ ...prev, cnic_number: formatCnic(value) }));
      return;
    }
    if (name === 'contact_number' || name === 'emergency_contact_number') {
      setForm((prev) => ({ ...prev, [name]: formatContactNumber(value) }));
      return;
    }
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    const contactValue = String(form.contact_number || '').trim();
    if (contactValue) {
      const normalizedContact = normalizeContactForSubmit(contactValue);
      if (!normalizedContact) {
        setError(CONTACT_INVALID_MESSAGE);
        return;
      }
    }
    const emergencyValue = String(form.emergency_contact_number || '').trim();
    if (emergencyValue && !normalizeContactForSubmit(emergencyValue)) {
      setError(`Emergency ${CONTACT_INVALID_MESSAGE}`);
      return;
    }
    const cnicValue = String(form.cnic_number || '').trim();
    if (cnicValue) {
      const normalizedCnic = normalizeCnicForSubmit(cnicValue);
      if (!normalizedCnic) {
        setError(CNIC_INVALID_MESSAGE);
        return;
      }
    }
    setSaving(true);
    // Send every editable field so the server replaces previous values with this form.
    const payload = {};
    for (const key of EMPLOYEE_EDIT_FIELDS) {
      if (key === 'cnic_number') {
        payload.cnic_number = cnicValue ? normalizeCnicForSubmit(cnicValue) : '';
        continue;
      }
      if (key === 'contact_number') {
        payload.contact_number = contactValue ? normalizeContactForSubmit(contactValue) : '';
        continue;
      }
      if (key === 'emergency_contact_number') {
        payload.emergency_contact_number = emergencyValue
          ? normalizeContactForSubmit(emergencyValue)
          : '';
        continue;
      }
      payload[key] = form[key] == null ? '' : form[key];
    }
    try {
      const { data } = await api.put('/api/users/me', payload);
      setProfile(data);
      setForm(formFromProfile(data));
      setSuccess('Profile updated.');
      const missing = missingEmployeePortalFields(data);
      if (missing.length === 0) {
        setShowIncompleteBanner(false);
        sessionStorage.removeItem('profileIncompleteDismissed');
        await refreshUser();
        if (locked) navigate('/dashboard');
      } else {
        await refreshUser();
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
      await refreshUser();
      if (missingEmployeePortalFields(data).length === 0) {
        setShowIncompleteBanner(false);
        sessionStorage.removeItem('profileIncompleteDismissed');
      }
      if (photoLocked || (locked && missingEmployeePortalFields(data).length === 0)) {
        navigate('/dashboard');
      }
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

        {locked && (
          <div className="profile-lock-banner" role="alert">
            <strong>Dashboard locked until missing employee fields are complete.</strong>
            <p className="muted">
              You can still edit all of your profile details below. Admin-assigned fields are not
              required.
            </p>
          </div>
        )}

        {loading && <p className="muted">Loading profile…</p>}

        {!loading && profile && !locked && showIncompleteBanner && missingLabels.length > 0 && (
          <div className="alert-banner" role="status">
            <div>
              <strong>Your profile is incomplete.</strong>
              <p className="muted" style={{ margin: '0.35rem 0 0' }}>
                Please fill in: {missingLabels.join(', ')}
              </p>
            </div>
            <div className="alert-actions">
              {missingText && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    editSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                >
                  Complete profile
                </button>
              )}
              {missingDocs && (
                <Link to="/account/documents" className={missingText ? 'btn btn-ghost' : 'btn btn-primary'}>
                  Upload documents
                </Link>
              )}
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
                  <strong>{formatCnic(profile.cnic_number) || '—'}</strong>
                </p>
                <p>
                  <span className="label">Role</span>
                  <strong>{profile.role}</strong>
                </p>
              </div>
            </section>

            <form id="edit-profile" ref={editSectionRef} onSubmit={handleSave} className="form">
              <h2>Edit profile</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                You can update your own profile details anytime.
                {locked ? ' Complete the required fields below to unlock the dashboard.' : ''}
              </p>
              <label>
                Name
                <input
                  type="text"
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  required
                  data-input-kind="text"
                />
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
                  data-input-kind="email"
                />
              </label>
              <label>
                Contact number
                <input
                  type="tel"
                  name="contact_number"
                  value={form.contact_number}
                  onChange={handleChange}
                  inputMode="numeric"
                  data-input-kind="contact"
                  maxLength={12}
                  pattern="03\d{2}-\d{7}"
                  title={CONTACT_INVALID_MESSAGE}
                  placeholder={CONTACT_FORMAT_HINT}
                  autoComplete="tel"
                />
                <span className="field-hint">{CONTACT_FORMAT_HINT}</span>
              </label>
              <label>
                CNIC number
                <input
                  type="text"
                  name="cnic_number"
                  value={form.cnic_number}
                  onChange={handleChange}
                  placeholder={CNIC_FORMAT_HINT}
                  inputMode="numeric"
                  data-input-kind="cnic"
                  maxLength={15}
                  pattern="\d{5}-\d{7}-\d"
                  title={CNIC_INVALID_MESSAGE}
                  autoComplete="off"
                />
                <span className="field-hint">{CNIC_FORMAT_HINT}</span>
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
                Employment type
                <input
                  type="text"
                  value={
                    form.employment_type === 'onsite'
                      ? 'Onsite'
                      : form.employment_type === 'remote'
                        ? 'Remote'
                        : form.employment_type || '—'
                  }
                  readOnly
                />
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
                  required={fieldRequired('reference_person_name')}
                  data-input-kind="text"
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
                    required={fieldRequired('emergency_contact_name')}
                    data-input-kind="text"
                  />
                </label>
                <label>
                  Emergency contact number
                  <input
                    type="tel"
                    name="emergency_contact_number"
                    value={form.emergency_contact_number}
                    onChange={handleChange}
                    required={fieldRequired('emergency_contact_number')}
                    inputMode="numeric"
                    data-input-kind="contact"
                    maxLength={12}
                    pattern="03\d{2}-\d{7}"
                    title={CONTACT_INVALID_MESSAGE}
                    placeholder={CONTACT_FORMAT_HINT}
                    autoComplete="tel"
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
                    required={fieldRequired('bank_name')}
                    data-input-kind="text"
                  />
                </label>
                <label>
                  Account title
                  <input
                    type="text"
                    name="account_title"
                    value={form.account_title}
                    onChange={handleChange}
                    required={fieldRequired('account_title')}
                    data-input-kind="text"
                  />
                </label>
              </div>
              <div className="grid-2">
                <label>
                  IBAN
                  <input
                    type="text"
                    name="iban"
                    value={form.iban}
                    onChange={handleChange}
                    required={fieldRequired('iban')}
                  />
                </label>
                <label>
                  Account number
                  <input
                    type="text"
                    name="account_number"
                    value={form.account_number}
                    onChange={handleChange}
                    required={fieldRequired('account_number')}
                    inputMode="numeric"
                    data-input-kind="integer"
                  />
                </label>
              </div>

              {locked && missingDocs && (
                <p className="muted">
                  Missing files:{' '}
                  {missingEmployeeFields
                    .filter((field) => field.document)
                    .map((field) => field.label)
                    .join(', ')}
                  . {missingKeys.has('profile_picture_url') ? 'Use Change photo above. ' : ''}
                  {missingEmployeeFields.some(
                    (field) => field.document && field.key !== 'profile_picture_url'
                  ) ? (
                    <Link to="/account/documents">Upload documents</Link>
                  ) : null}
                </p>
              )}

              {error && <p className="error">{error}</p>}
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
