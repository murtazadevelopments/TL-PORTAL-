import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import logo from '../assets/logo.png';
import { AuthUserProvider, useAuthUser } from '../context/AuthUserContext';
import SidebarNav from '../components/SidebarNav';
import './AppShell.css';

function ShellInner() {
  const { user, role, permissions, loading, logout } = useAuthUser();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname, location.search]);

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
          onNavigate={() => setDrawerOpen(false)}
        />

        <div className="sidebar-footer">
          <button type="button" className="btn btn-ghost sidebar-logout" onClick={logout}>
            Logout
          </button>
        </div>
      </aside>

      <main className="app-main">
        <Outlet />
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
