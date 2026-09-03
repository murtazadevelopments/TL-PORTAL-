import { Link } from 'react-router';
import logo from '../assets/logo.webp';
import HardRefreshButton from './HardRefreshButton';
import './Navbar.css';

/** Slim brand bar for public auth pages only (signed-in app uses AppShell sidebar). */
function Navbar() {
  return (
    <header className="navbar">
      <Link to="/" className="navbar-brand">
        <img src={logo} alt="Textured Lab Portal" className="navbar-logo" width={52} height={52} />
        <span>Textured Lab Portal</span>
      </Link>
      <HardRefreshButton compact />
    </header>
  );
}

export default Navbar;
