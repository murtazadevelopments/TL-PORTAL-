import { Link, useLocation } from 'react-router-dom';
import logo from '../assets/logo.png';
import { canAccessAdmin } from '../utils/permissions';
import './Navbar.css';

function Navbar({ onLogout, showLogout = false, role = null }) {
  const location = useLocation();
  const onAdmin = location.pathname.startsWith('/admin');
  const onDashboard = location.pathname.startsWith('/dashboard');

  return (
    <header className="navbar">
      <Link to={showLogout ? '/dashboard' : '/'} className="navbar-brand">
        <img src={logo} alt="Textured Lab" className="navbar-logo" />
        <span>Textured Lab</span>
      </Link>

      <div className="navbar-actions">
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
              className={`nav-link ${onAdmin ? 'nav-link-active' : ''}`}
              aria-current={onAdmin ? 'page' : undefined}
            >
              Admin Panel
            </Link>
          </>
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
