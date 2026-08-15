import { Link, useLocation } from 'react-router';
import logo from '../assets/logo.png';
import { canAccessAdmin, isCeo } from '../utils/permissions';
import InstallAppButton from './InstallAppButton';
import './Navbar.css';

function Navbar({ onLogout, showLogout = false, role = null }) {
  const location = useLocation();
  const onAdmin = location.pathname.startsWith('/admin');
  const onDashboard = location.pathname.startsWith('/dashboard');
  const onLoginLogs = location.pathname.startsWith('/admin/login-logs');

  return (
    <header className="navbar">
      <Link to={showLogout ? '/dashboard' : '/'} className="navbar-brand">
        <img src={logo} alt="Textured Lab" className="navbar-logo" />
        <span>Textured Lab</span>
      </Link>

      <div className="navbar-actions">
        {showLogout && <InstallAppButton compact />}

        {showLogout && canAccessAdmin(role) && (
          <>
            <Link
              to="/dashboard"
              className={`nav-link ${onDashboard ? 'nav-link-active' : ''}`}
              aria-current={onDashboard ? 'page' : undefined}
            >
              My Dashboard
            </Link>
            <Link
              to="/admin"
              className={`nav-link ${onAdmin && !onLoginLogs ? 'nav-link-active' : ''}`}
              aria-current={onAdmin && !onLoginLogs ? 'page' : undefined}
            >
              Admin Panel
            </Link>
          </>
        )}

        {showLogout && isCeo(role) && (
          <Link
            to="/admin/login-logs"
            className={`nav-link ${onLoginLogs ? 'nav-link-active' : ''}`}
            aria-current={onLoginLogs ? 'page' : undefined}
          >
            Check Logs
          </Link>
        )}

        {showLogout && (
          <button type="button" className="btn btn-ghost" onClick={onLogout}>
            Logout
          </button>
        )}
      </div>
    </header>
  );
}

export default Navbar;
