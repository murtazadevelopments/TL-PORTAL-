import { Link } from 'react-router';
import {
  isProfileIncompleteLocked,
  missingEmployeePortalFields,
  profileLockHomePath,
  PROFILE_ALERT_MAX,
} from '../utils/profileCompleteness';
import './ProfileIncompleteLock.css';

export default function ProfileIncompleteLock({ user, onContinue }) {
  if (!isProfileIncompleteLocked(user)) return null;
  const missing = missingEmployeePortalFields(user);
  const home = profileLockHomePath(user);
  const hasText = missing.some((field) => !field.document);
  const hasDocs = missing.some((field) => field.document);

  return (
    <div className="profile-lock" role="alertdialog" aria-modal="true" aria-labelledby="profile-lock-title">
      <div className="profile-lock-card">
        <p className="profile-lock-kicker">Access limited</p>
        <h2 id="profile-lock-title">Complete your profile to continue</h2>
        <p>
          After {PROFILE_ALERT_MAX} reminders, the dashboard stays closed until you fill the employee
          fields that are still missing. Admin-assigned fields are not required here.
        </p>
        <ul>
          {missing.map((field) => (
            <li key={field.key}>{field.label}</li>
          ))}
        </ul>
        <div className="profile-lock-actions">
          {hasText && (
            <Link to="/account" className="btn btn-primary" onClick={onContinue}>
              Complete profile
            </Link>
          )}
          {hasDocs && (
            <Link
              to="/account/documents"
              className={hasText ? 'btn btn-ghost' : 'btn btn-primary'}
              onClick={onContinue}
            >
              Upload documents
            </Link>
          )}
          {!hasText && !hasDocs && (
            <Link to={home} className="btn btn-primary" onClick={onContinue}>
              Continue
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
