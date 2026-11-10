import { Link } from 'react-router';
import { PHOTO_ALERT_BODY, PHOTO_ALERT_MAX } from '../utils/profileCompleteness';
import './ProfileIncompleteLock.css';

export default function PhotoAlertLock({ user, onContinue }) {
  if (!user) return null;

  return (
    <div
      className="profile-lock"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="photo-lock-title"
    >
      <div className="profile-lock-card">
        <p className="profile-lock-kicker">Access limited</p>
        <h2 id="photo-lock-title">Update your profile picture to continue</h2>
        <p>
          After {PHOTO_ALERT_MAX} photo alerts, the dashboard stays closed until you upload a new
          profile picture that shows your face clearly.
        </p>
        <p>{PHOTO_ALERT_BODY}</p>
        <div className="profile-lock-actions">
          <Link to="/account" className="btn btn-primary" onClick={onContinue}>
            Change profile picture
          </Link>
        </div>
      </div>
    </div>
  );
}
