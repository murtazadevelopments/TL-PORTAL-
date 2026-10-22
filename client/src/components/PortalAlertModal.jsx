import { Link, useNavigate } from 'react-router';
import { PHOTO_ALERT_BODY, PHOTO_ALERT_SUBJECT } from '../utils/profileCompleteness';
import './ProfileIncompleteLock.css';

export default function PortalAlertModal({ user, onContinue }) {
  const navigate = useNavigate();
  const fields = Array.isArray(user?.profile_alert_fields) && user.profile_alert_fields.length
    ? user.profile_alert_fields
    : user?.missing_portal_fields || [];
  const hasProfileAlert = Boolean(user?.profile_alert_at) && fields.length > 0;
  const hasPhotoAlert = Boolean(user?.photo_alert_sent_at);
  if (!hasProfileAlert && !hasPhotoAlert) return null;

  function goDashboard() {
    onContinue?.();
    navigate('/dashboard');
  }

  function goProfile() {
    onContinue?.();
    navigate('/account');
  }

  return (
    <div className="profile-lock portal-alert-modal" role="alertdialog" aria-modal="true" aria-labelledby="portal-alert-title">
      <div className="profile-lock-card location-lock-card">
        <p className="profile-lock-kicker location-lock-kicker">Textured Lab Portal</p>
        <h2 id="portal-alert-title">
          {hasProfileAlert ? 'Please complete your portal profile' : PHOTO_ALERT_SUBJECT}
        </h2>
        {hasProfileAlert ? (
          <>
            <p>Please complete the following fields in your portal profile:</p>
            <ul>
              {fields.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </>
        ) : (
          <p>{PHOTO_ALERT_BODY}</p>
        )}
        {hasPhotoAlert && hasProfileAlert ? (
          <p style={{ marginTop: '0.75rem' }}>{PHOTO_ALERT_BODY}</p>
        ) : null}
        <div className="profile-lock-actions" style={{ marginTop: '1.1rem' }}>
          <button type="button" className="btn btn-primary" onClick={goDashboard}>
            Continue to dashboard
          </button>
          <Link to="/account" className="btn btn-ghost" onClick={goProfile}>
            Open profile
          </Link>
        </div>
      </div>
    </div>
  );
}
