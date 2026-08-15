import { Link } from 'react-router';
import logo from '../assets/logo.png';
import './Navbar.css';

/** Slim brand bar for public auth pages only (signed-in app uses AppShell sidebar). */
function Navbar() {
  return (
    <header className="navbar">
      <Link to="/" className="navbar-brand">
        <img src={logo} alt="Textured Lab Portal" className="navbar-logo" />
        <span>Textured Lab Portal</span>
      </Link>
    </header>
  );
}

export default Navbar;
