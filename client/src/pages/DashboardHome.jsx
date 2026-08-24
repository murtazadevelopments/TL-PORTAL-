import { useState } from 'react';
import { Link } from 'react-router';
import { useAuthUser } from '../context/AuthUserContext';
import { withAuthDocumentUrl } from '../utils/documentUrls';

const INCOMPLETE_CHECK_FIELDS = [
  'reference_person_name',
  'emergency_contact_name',
  'emergency_contact_number',
  'bank_name',
  'account_title',
  'iban',
  'account_number',
];

const FIELD_LABELS = {
  reference_person_name: 'Reference person',
  emergency_contact_name: 'Emergency contact name',
  emergency_contact_number: 'Emergency contact number',
  bank_name: 'Bank name',
  account_title: 'Account title',
  iban: 'IBAN',
  account_number: 'Account number',
};

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

export default function DashboardHome() {
  const { user, loading, error } = useAuthUser();
  const [avatarBroken, setAvatarBroken] = useState(false);

  const missing = user
    ? (Array.isArray(user.missing_portal_fields) && user.missing_portal_fields.length
        ? user.missing_portal_fields
        : INCOMPLETE_CHECK_FIELDS.filter((key) => isBlank(user[key])).map((key) => FIELD_LABELS[key]))
    : [];
  const hrAsked = Boolean(user?.profile_alert_at);

  const avatarSrc = withAuthDocumentUrl(
    user?.profile_picture_url,
    user?.updated_at || user?.id
  );
  const showAvatar = Boolean(avatarSrc) && !avatarBroken;

  return (
    <div className="card wide page-panel">
      <h1>Dashboard</h1>
      <p className="muted">Welcome to Textured Lab Portal</p>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}

      {user && missing.length > 0 && (
        <div className="alert-banner" role="status">
          <div>
            <strong>{hrAsked ? 'HR asked you to complete your profile.' : 'Your profile is incomplete.'}</strong>
            <p className="muted" style={{ margin: '0.35rem 0 0' }}>
              Please fill in: {missing.join(', ')}
            </p>
          </div>
          <div className="alert-actions">
            <Link to="/account" className="btn btn-primary">
              Complete profile
            </Link>
          </div>
        </div>
      )}

      {user && (
        <>
          <section className="profile-header dashboard-profile-header" style={{ marginTop: '1.25rem' }}>
            <div className="avatar-block">
              {showAvatar ? (
                <img
                  className="avatar"
                  src={avatarSrc}
                  alt=""
                  onError={() => setAvatarBroken(true)}
                />
              ) : (
                <div className="avatar placeholder" aria-hidden="true">
                  {(user.name || user.username || '?').charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <div className="meta">
              <p>
                <span className="label">Hello</span>
                <strong>{user.name || user.username}</strong>
              </p>
              <p>
                <span className="label">Employee ID</span>
                <strong>{user.employee_id || 'Not assigned'}</strong>
              </p>
              <p>
                <span className="label">Role</span>
                <strong>{user.role}</strong>
              </p>
            </div>
          </section>

          <section className="readonly-grid">
            <h2>Work assignment</h2>
            <p className="muted">Managed by admin — view only here.</p>
            <div className="detail-grid readonly-cards">
              <p>
                <span className="label">Status</span>
                <strong>{user.status || '—'}</strong>
              </p>
              <p>
                <span className="label">Department</span>
                <strong>{user.department || '—'}</strong>
              </p>
              <p>
                <span className="label">Designation</span>
                <strong>{user.designation || '—'}</strong>
              </p>
              <p>
                <span className="label">Branch</span>
                <strong>{user.branch || '—'}</strong>
              </p>
              <p>
                <span className="label">Shift</span>
                <strong>{user.shift || '—'}</strong>
              </p>
              <p>
                <span className="label">Work location</span>
                <strong>
                  {user.employment_type === 'remote'
                    ? 'Remote'
                    : user.employment_type === 'onsite'
                      ? 'Onsite'
                      : user.employment_type || '—'}
                </strong>
              </p>
              <p>
                <span className="label">Salary</span>
                <strong>{user.salary ?? '—'}</strong>
              </p>
            </div>
          </section>

          <p className="muted" style={{ marginTop: '1.5rem' }}>
            <Link to="/account">Edit profile</Link>
            {user.employment_type === 'remote' ? (
              <>
                {' · '}
                <Link to="/attendance">Attendance</Link>
              </>
            ) : null}
            {' · '}
            <Link to="/account/documents">My documents</Link>
            {' · '}
            <Link to="/account/security">Security</Link>
          </p>
        </>
      )}
    </div>
  );
}
