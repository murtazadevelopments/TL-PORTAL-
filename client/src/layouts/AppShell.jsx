import { useCallback, useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import logo from '../assets/logo.png';
import { AuthUserProvider, useAuthUser } from '../context/AuthUserContext';
import SidebarNav from '../components/SidebarNav';
import { isCeo, isTeamLeader } from '../utils/permissions';
import api from '../api/client';
import './AppShell.css';

function ShellInner() {
  const { user, role, permissions, loading, logout, refreshUser } = useAuthUser();
  const tlDashboardAccess =
    Boolean(user?.tl_dashboard_access) || isCeo(role) || isTeamLeader(role);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [dismissProfileAlert, setDismissProfileAlert] = useState(false);
  const location = useLocation();

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
    if (location.pathname === '/account') {
      refreshUser?.();
    }
  }, [location.pathname, refreshUser]);

  useEffect(() => {
    if (!user) return undefined;
    refreshUnread();
    const id = setInterval(refreshUnread, 60_000);
    return () => clearInterval(id);
  }, [user, refreshUnread, location.pathname]);

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
        <Link to="/dashboard" className="shell-brand shell-brand-mobile">
          <img src={logo} alt="" className="shell-logo" />
          <span>Textured Lab Portal</span>
        </Link>
        <div className="shell-topbar-spacer" />
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
        <Link to="/dashboard" className="shell-brand shell-brand-desktop">
          <img src={logo} alt="" className="shell-logo" />
          <span>Textured Lab Portal</span>
        </Link>

        <SidebarNav
          role={role}
          permissions={permissions}
          tlDashboardAccess={tlDashboardAccess}
          unreadMessages={unreadMessages}
          onNavigate={() => setDrawerOpen(false)}
        />

        <div className="sidebar-footer">
          <button type="button" className="btn btn-ghost sidebar-logout" onClick={logout}>
            Logout
          </button>
        </div>
      </aside>

      <main className="app-main">
        {user?.profile_alert_at &&
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
                . Open Profile to save these details.
              </p>
            </div>
            <div className="portal-profile-alert-actions">
              <Link to="/account" className="btn btn-primary">
                Complete profile
              </Link>
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
