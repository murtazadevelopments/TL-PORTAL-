import { useCallback, useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import logo from '../assets/logo.webp';
import { AuthUserProvider, useAuthUser } from '../context/AuthUserContext';
import SidebarNav from '../components/SidebarNav';
import { isCeo, isTeamLeader } from '../utils/permissions';
import { missingEmployeePortalFields, isProfileIncompleteLocked, profileLockHomePath } from '../utils/profileCompleteness';
import api from '../api/client';
import AdminIncompleteGate from '../components/AdminIncompleteGate';
import ProfileIncompleteLock from '../components/ProfileIncompleteLock';
import InstallAppModal from '../components/InstallAppModal';
import BirthdayCelebration from '../components/BirthdayCelebration';
import HardRefreshButton from '../components/HardRefreshButton';
import { enablePushNotificationsSafe } from '../utils/pushNotifications';
import './AppShell.css';

function ShellInner() {
  const { user, role, permissions, loading, logout, refreshUser } = useAuthUser();
  const tlDashboardAccess =
    Boolean(user?.tl_dashboard_access) || isCeo(role) || isTeamLeader(role);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [dismissProfileAlert, setDismissProfileAlert] = useState(false);
  const [ackProfileLock, setAckProfileLock] = useState(false);
  const [ackBirthday, setAckBirthday] = useState(false);
  const [liveNotice, setLiveNotice] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();
  const portalGaps = user ? missingEmployeePortalFields(user) : [];
  const missingDocs = portalGaps.some((field) => field.document);
  const missingText = portalGaps.some((field) => !field.document);
  const profileLocked = isProfileIncompleteLocked(user);

  const refreshUnread = useCallback(async () => {
    try {
      const { data } = await api.get('/api/messages/unread-count');
      setUnreadMessages(Number(data?.count) || 0);
    } catch {
      /* ignore — badge optional */
    }
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    setDismissProfileAlert(false);
  }, [user?.profile_alert_at]);

  useEffect(() => {
    if (!profileLocked) setAckProfileLock(false);
  }, [profileLocked]);

  const birthdayStorageKey =
    user?.is_birthday && user?.id && user?.birthday_on
      ? `tl-birthday-seen:${user.id}:${user.birthday_on}`
      : '';

  useEffect(() => {
    if (!birthdayStorageKey) {
      setAckBirthday(false);
      return;
    }
    setAckBirthday(sessionStorage.getItem(birthdayStorageKey) === '1');
  }, [birthdayStorageKey]);

  const showBirthday = Boolean(user?.is_birthday) && !ackBirthday;

  useEffect(() => {
    if (!profileLocked) return;
    const path = location.pathname;
    const allowed = path === '/account' || path === '/account/documents';
    if (!allowed) {
      navigate(profileLockHomePath(user), { replace: true });
    }
  }, [profileLocked, location.pathname, navigate, user]);

  useEffect(() => {
    if (location.pathname === '/account') {
      refreshUser?.();
    }
  }, [location.pathname, refreshUser]);

  useEffect(() => {
    if (!user) return undefined;
    enablePushNotificationsSafe();
    const onInstalled = () => enablePushNotificationsSafe();
    const onVisible = () => {
      if (document.visibilityState === 'visible') enablePushNotificationsSafe();
    };
    window.addEventListener('appinstalled', onInstalled);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('appinstalled', onInstalled);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    refreshUnread();
    refreshUser?.();
    const id = setInterval(() => {
      refreshUnread();
      refreshUser?.();
    }, 45_000);
    return () => clearInterval(id);
  }, [user, refreshUnread, refreshUser, location.pathname]);

  useEffect(() => {
    if (!user || typeof navigator === 'undefined' || !navigator.serviceWorker) return undefined;
    const onMessage = (event) => {
      if (event.data?.type === 'PORTAL_PUSH') {
        refreshUser?.();
        refreshUnread();
        setLiveNotice({
          title: event.data.title || 'New notification',
          body: event.data.body || '',
          url: event.data.url || '/account/messages',
        });
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [user, refreshUser, refreshUnread]);

  useEffect(() => {
    document.body.classList.toggle('drawer-lock', drawerOpen);
    return () => document.body.classList.remove('drawer-lock');
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  if (loading && !user) {
    return (
      <div className="app-shell-loading">
        <div className="spinner" />
        Loading…
      </div>
    );
  }

  return (
    <div className={`app-shell${drawerOpen ? ' drawer-open' : ''}`}>
      <header className="app-shell-topbar">
        <button
          type="button"
          className="shell-menu-btn"
          aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((o) => !o)}
        >
          <span className="shell-menu-icon" aria-hidden />
        </button>
        <button
          type="button"
          className="shell-menu-btn shell-back-btn"
          aria-label="Go back"
          onClick={() => {
            const idx = window.history.state?.idx;
            if (typeof idx === 'number' && idx > 0) {
              navigate(-1);
              return;
            }
            navigate(profileLocked ? profileLockHomePath(user) : '/dashboard');
          }}
        >
          <span className="shell-back-icon" aria-hidden />
        </button>
        <Link to={profileLocked ? profileLockHomePath(user) : '/dashboard'} className="shell-brand shell-brand-mobile">
          <img src={logo} alt="" className="shell-logo" width={36} height={36} />
          <span>Textured Lab Portal</span>
        </Link>
        <HardRefreshButton compact />
        {user && (
          <span className="shell-user-chip muted">
            {user.name || user.username}
          </span>
        )}
      </header>

      {drawerOpen && (
        <button
          type="button"
          className="shell-backdrop"
          aria-label="Close menu"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <aside className="app-sidebar" aria-label="Sidebar">
        <Link to={profileLocked ? profileLockHomePath(user) : '/dashboard'} className="shell-brand shell-brand-desktop">
          <img src={logo} alt="" className="shell-logo" width={36} height={36} />
          <span>Textured Lab Portal</span>
        </Link>

        <SidebarNav
          role={role}
          permissions={permissions}
          tlDashboardAccess={tlDashboardAccess}
          unreadMessages={unreadMessages}
          employmentType={user?.employment_type || null}
          profileLocked={profileLocked}
          onNavigate={() => setDrawerOpen(false)}
        />

        <div className="sidebar-footer">
          <HardRefreshButton block />
          <button type="button" className="btn btn-ghost sidebar-logout" onClick={logout}>
            Logout
          </button>
        </div>
      </aside>

      <main className="app-main">
        {liveNotice && (
          <div className="portal-live-notice" role="status">
            <div>
              <strong>{liveNotice.title}</strong>
              {liveNotice.body ? <p>{liveNotice.body}</p> : null}
            </div>
            <div className="portal-live-notice-actions">
              <Link to={liveNotice.url} className="btn btn-primary" onClick={() => setLiveNotice(null)}>
                Open
              </Link>
              <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setLiveNotice(null)}>
                ×
              </button>
            </div>
          </div>
        )}
        {user?.profile_alert_at &&
          !profileLocked &&
          !dismissProfileAlert &&
          (Array.isArray(user.profile_alert_fields)
            ? user.profile_alert_fields
            : user.missing_portal_fields || []
          ).length > 0 && (
          <div className="portal-profile-alert" role="alert">
            <div>
              <strong>Complete your profile</strong>
              <p>
                HR asked you to fill:{' '}
                {(Array.isArray(user.profile_alert_fields) && user.profile_alert_fields.length
                  ? user.profile_alert_fields
                  : user.missing_portal_fields
                ).join(', ')}
                . {missingDocs && missingText
                  ? 'Open Profile and Documents to finish these details.'
                  : missingDocs
                    ? 'Open Documents to upload the missing files.'
                    : 'Open Profile to save these details.'}
              </p>
            </div>
            <div className="portal-profile-alert-actions">
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
              <Link to="/account/messages" className="btn btn-ghost">
                View message
              </Link>
              <button
                type="button"
                className="icon-btn"
                aria-label="Dismiss for now"
                onClick={() => setDismissProfileAlert(true)}
              >
                ×
              </button>
            </div>
          </div>
        )}
        <Outlet context={{ refreshUnreadMessages: refreshUnread }} />
      </main>
      {!profileLocked && <InstallAppModal />}
      {showBirthday && (
        <BirthdayCelebration
          user={user}
          onContinue={() => {
            if (birthdayStorageKey) sessionStorage.setItem(birthdayStorageKey, '1');
            setAckBirthday(true);
          }}
        />
      )}
      {profileLocked && !ackProfileLock && !showBirthday && (
        <ProfileIncompleteLock user={user} onContinue={() => setAckProfileLock(true)} />
      )}
      {!profileLocked && <AdminIncompleteGate user={user} />}
    </div>
  );
}

export default function AppShell() {
  return (
    <AuthUserProvider>
      <ShellInner />
    </AuthUserProvider>
  );
}
