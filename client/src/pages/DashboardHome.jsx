import { useState } from 'react';
import { Link } from 'react-router';
import { useAuthUser } from '../context/AuthUserContext';
import { withAuthDocumentUrl } from '../utils/documentUrls';
import { missingEmployeePortalFields } from '../utils/profileCompleteness';

export default function DashboardHome() {
  const { user, loading, error } = useAuthUser();
  const [avatarBroken, setAvatarBroken] = useState(false);

  const missingFields = user
    ? (Array.isArray(user.missing_portal_fields) && user.missing_portal_fields.length
        ? user.missing_portal_fields
        : missingEmployeePortalFields(user).map((field) => field.label))
    : [];
  const missingDocs = user
    ? missingEmployeePortalFields(user).some((field) => field.document)
    : false;
  const missingText = user
    ? missingEmployeePortalFields(user).some((field) => !field.document)
    : false;
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

      {user && missingFields.length > 0 && (
        <div className="alert-banner" role="status">
          <div>
            <strong>{hrAsked ? 'HR asked you to complete your profile.' : 'Your profile is incomplete.'}</strong>
            <p className="muted" style={{ margin: '0.35rem 0 0' }}>
              Please fill in: {missingFields.join(', ')}
            </p>
          </div>
          <div className="alert-actions">
            {missingText && (
              <Link to="/account" className="btn btn-primary">
                Complete profile
              </Link>
            )}
            {missingDocs && (
              <Link to="/account/documents" className={missingText ? 'btn btn-ghost' : 'btn btn-primary'}>
                Upload documents
              </Link>
            )}
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
            </div>
          </section>

          <section className="dash-shortcuts-wrap">
            <h2>Quick actions</h2>
            <p className="muted">Jump to the pages you use most.</p>
            <nav className="dash-shortcuts" aria-label="Quick actions">
            <Link to="/account" className="dash-shortcut">
              <span className="dash-shortcut-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                  <path
                    d="M5 20.2c.8-3.3 3.6-5.2 7-5.2s6.2 1.9 7 5.2"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <span className="dash-shortcut-copy">
                <strong>Edit profile</strong>
                <em>Name, bank, contacts</em>
              </span>
            </Link>
            {user.employment_type === 'remote' || user.employment_type === 'onsite' ? (
              <Link to="/attendance" className="dash-shortcut">
                <span className="dash-shortcut-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
                    <path
                      d="M12 8v4.2l2.6 1.6"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <span className="dash-shortcut-copy">
                  <strong>Attendance</strong>
                  <em>
                    {user.employment_type === 'onsite'
                      ? 'Office check-in'
                      : 'Check in and hours'}
                  </em>
                </span>
              </Link>
            ) : null}
            <Link to="/account/documents" className="dash-shortcut">
              <span className="dash-shortcut-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M7 4.5h7.2L18.5 9v10.5H7V4.5Z"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinejoin="round"
                  />
                  <path d="M14 4.5V9h4.5" stroke="currentColor" strokeWidth="1.7" />
                </svg>
              </span>
              <span className="dash-shortcut-copy">
                <strong>My documents</strong>
                <em>CV and uploads</em>
              </span>
            </Link>
            <Link to="/account/security" className="dash-shortcut">
              <span className="dash-shortcut-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <rect
                    x="6"
                    y="10.5"
                    width="12"
                    height="9"
                    rx="1.6"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                  <path
                    d="M9 10.5V8.2a3 3 0 0 1 6 0v2.3"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <span className="dash-shortcut-copy">
                <strong>Security</strong>
                <em>Password and passkeys</em>
              </span>
            </Link>
            </nav>
          </section>
        </>
      )}
    </div>
  );
}
