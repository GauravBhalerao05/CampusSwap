import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useState } from 'react';

export default function Navbar() {
  const { user, isAuthenticated, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <nav className="navbar-cs">
      <div className="container">
        <div className="d-flex align-items-center justify-content-between w-100">
          {/* Brand */}
          <Link to="/" className="navbar-brand-cs text-decoration-none">
            🎓 CampusSwap
          </Link>

          {/* Mobile toggle */}
          <button
            className="btn btn-sm d-md-none"
            style={{ color: 'var(--cs-text-muted)', border: '1px solid var(--cs-border)', borderRadius: 'var(--cs-radius-sm)' }}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '✕' : '☰'}
          </button>

          {/* Links */}
          <div className={`${expanded ? 'd-flex' : 'd-none'} d-md-flex align-items-center gap-1 flex-column flex-md-row w-100 w-md-auto mt-3 mt-md-0`}
               style={{ justifyContent: 'flex-end' }}>
            <NavLink to="/listings" className={({ isActive }) => `nav-link-cs ${isActive ? 'active' : ''}`} end>
              Browse
            </NavLink>

            {isAuthenticated && (
              <>
                <NavLink to="/my-listings" className={({ isActive }) => `nav-link-cs ${isActive ? 'active' : ''}`}>
                  My Listings
                </NavLink>
                <NavLink to="/transactions" className={({ isActive }) => `nav-link-cs ${isActive ? 'active' : ''}`}>
                  Transactions
                </NavLink>
                <NavLink to="/messages" className={({ isActive }) => `nav-link-cs ${isActive ? 'active' : ''}`}>
                  Messages
                </NavLink>
                {isAdmin && (
                  <NavLink to="/admin" className={({ isActive }) => `nav-link-cs ${isActive ? 'active' : ''}`}>
                    Admin
                  </NavLink>
                )}
                <div className="dropdown ms-md-2 position-relative">
                  <button
                    className="btn btn-sm d-flex align-items-center gap-2"
                    style={{
                      background: 'var(--cs-surface2)',
                      border: '1px solid var(--cs-border)',
                      color: 'var(--cs-text)',
                      borderRadius: 'var(--cs-radius-sm)',
                      padding: '0.45rem 0.9rem'
                    }}
                    type="button"
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                  >
                    <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,var(--cs-primary),var(--cs-primary-dark))', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 700, flexShrink: 0 }}>
                      {user?.fullName?.[0]?.toUpperCase() || '?'}
                    </span>
                    <span className="d-none d-lg-inline" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {user?.fullName}
                    </span>
                  </button>
                  <ul className={`dropdown-menu dropdown-menu-end ${dropdownOpen ? 'show' : ''}`} style={{ position: 'absolute', right: 0 }}>
                    <li><span className="dropdown-item-text" style={{ color: 'var(--cs-text-muted)', fontSize: '0.8rem' }}>{user?.email}</span></li>
                    <li><hr className="dropdown-divider" /></li>
                    <li><Link className="dropdown-item" to="/listings/new" onClick={() => setDropdownOpen(false)}>+ New Listing</Link></li>
                    <li><hr className="dropdown-divider" /></li>
                    <li>
                      <button className="dropdown-item text-danger" onClick={() => { setDropdownOpen(false); handleLogout(); }}>
                        Sign out
                      </button>
                    </li>
                  </ul>
                </div>
              </>
            )}

            {!isAuthenticated && (
              <>
                <NavLink to="/login" className={({ isActive }) => `nav-link-cs ${isActive ? 'active' : ''}`}>
                  Sign in
                </NavLink>
                <Link to="/register" className="btn btn-primary btn-sm ms-2" style={{ borderRadius: 'var(--cs-radius-sm)' }}>
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
