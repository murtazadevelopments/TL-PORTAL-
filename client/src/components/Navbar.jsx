import { Link } from 'react-router-dom';
import logo from '../assets/logo.png';
import { canAccessAdmin } from '../utils/permissions';
import './Navbar.css';

function Navbar({ onLogout, showLogout = false, role = null }) {
  return (
    <header className="navbar">
      <Link to={showLogout ? '/dashboard' : '/'} className="navbar-brand">
        <img src={logo} alt="Textured Lab" className="navbar-logo" />
        <span>Textured Lab</span>
      </Link>

      <div className="navbar-actions">
        {showLogout && canAccessAdmin(role) && (
          <Link to="/admin" className="nav-link">
            Admin Panel
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
