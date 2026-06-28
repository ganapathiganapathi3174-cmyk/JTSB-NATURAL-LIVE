import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

const ADMIN_KEY = 'fb_admin_token';

function IconDashboard() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function IconPayments() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="5" width="22" height="14" rx="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
      <circle cx="12" cy="13" r="2" />
    </svg>
  );
}

function IconTopups() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconStatus() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="21" x2="9" y2="9" />
    </svg>
  );
}

function IconMessages() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function IconChat() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function IconUPI() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
      <polyline points="16 14 18 16 20 14" />
    </svg>
  );
}

function IconLogout() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

const navItems = [
  { path: '/fb-admin/dashboard', label: 'Dashboard', icon: IconDashboard },
  { path: '/fb-admin/payments', label: 'Payments', icon: IconPayments },
  { path: '/fb-admin/topups', label: 'Topups', icon: IconTopups },
  { path: '/fb-admin/upi-payments', label: 'UPI Payments', icon: IconUPI },
  { path: '/fb-admin/users', label: 'Users', icon: IconUsers },
  { path: '/fb-admin/status', label: 'Status Board', icon: IconStatus },
  { path: '/fb-admin/tools', label: 'Tools', icon: IconStatus },
  { path: '/fb-admin/queue', label: 'Queue', icon: IconStatus },
  { path: '/fb-admin/messages', label: 'Messages', icon: IconMessages },
  { path: '/fb-admin/chat', label: 'Chat', icon: IconChat },
];

export default function AdminSidebar({ pendingCounts = {}, userName }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  function logout() {
    localStorage.removeItem(ADMIN_KEY);
    navigate('/fb-admin');
  }

  function getBadgeCount(path) {
    if (path === '/fb-admin/payments') return pendingCounts.pendingPayments;
    if (path === '/fb-admin/topups') return pendingCounts.pendingTopups;
    return null;
  }

  return (
    <>
      <button className="sidebar-toggle" onClick={() => setOpen(!open)} aria-label="Toggle sidebar">
        {open ? '\u2715' : '\u2630'}
      </button>
      <div className={`sidebar-overlay${open ? ' open' : ''}`} onClick={() => setOpen(false)} />
      <aside className={`admin-sidebar${open ? ' open' : ''}`}>
        <div className="admin-sidebar-header">
          <div className="admin-sidebar-brand">
            <div className="admin-sidebar-brand-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <span className="text-cosmic">Starlight Admin</span>
          </div>
        </div>

        <div className="admin-sidebar-user">
          <div className="admin-sidebar-user-name">{userName || 'Admin'}</div>
          <div className="admin-sidebar-user-role">Administrator</div>
        </div>

        <nav className="admin-sidebar-nav">
          {navItems.map(item => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            const badge = getBadgeCount(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`admin-sidebar-link${isActive ? ' active' : ''}`}
              >
                <span className="admin-sidebar-link-icon"><Icon /></span>
                <span className="admin-sidebar-link-label">{item.label}</span>
                {badge != null && badge > 0 && (
                  <span className="admin-sidebar-badge">{badge > 99 ? '99+' : badge}</span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="admin-sidebar-footer">
          <button className="admin-sidebar-logout" onClick={logout}>
            <span className="admin-sidebar-link-icon"><IconLogout /></span>
            <span>Log out</span>
          </button>
        </div>
      </aside>
    </>
  );
}