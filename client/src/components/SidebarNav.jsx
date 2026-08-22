import { NavLink, useLocation } from 'react-router';
import { canAccessAdmin, hasPermission, isCeo, isTeamLeader } from '../utils/permissions';

/**
 * Build sidebar groups from role/permissions. Same gates as existing UI.
 */
export function buildSidebarGroups(
  role,
  permissions,
  { tlDashboardAccess = false, unreadMessages = 0 } = {}
) {
  const groups = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      items: [{ to: '/dashboard', label: 'Overview', end: true }],
    },
  ];

  if (isCeo(role) || isTeamLeader(role) || tlDashboardAccess) {
    groups.push({
      id: 'team-leader',
      label: 'Team Leader',
      items: [{ to: '/team-leader', label: 'TL Dashboard', end: true }],
    });
  }

  groups.push({
    id: 'account',
    label: 'My Account',
    items: [
      { to: '/account', label: 'Profile', end: true },
      { to: '/account/documents', label: 'My Documents' },
      {
        to: '/account/messages',
        label: 'Messages',
        badge: unreadMessages > 0 ? unreadMessages : null,
      },
      { to: '/account/security', label: 'Security' },
    ],
  });

  if (canAccessAdmin(role)) {
    const employeeItems = [];
    if (hasPermission(permissions, 'employees:view', role)) {
      employeeItems.push(
        { to: '/admin/employees', label: 'All Employees', end: true, match: 'employees-all' },
        {
          to: '/admin/employees?status=pending',
          label: 'Pending Approvals',
          match: 'employees-pending',
        }
      );
    }
    if (hasPermission(permissions, 'accounts:unlock', role)) {
      employeeItems.push({ to: '/admin/locked', label: 'Locked Accounts' });
    }
    if (hasPermission(permissions, 'employees:deactivate', role)) {
      employeeItems.push({ to: '/admin/deactivated', label: 'Deactivated' });
    }
    if (employeeItems.length) {
      groups.push({ id: 'employees', label: 'Employees', items: employeeItems });
    }

    const adminItems = [];
    if (isCeo(role)) {
      adminItems.push({ to: '/admin/roles', label: 'Assign Roles' });
    }
    adminItems.push({ to: '/admin/teams', label: 'Manage Teams' });
    adminItems.push({ to: '/admin/branches', label: 'Manage Branches' });
    if (hasPermission(permissions, 'messages:send', role)) {
      adminItems.push({ to: '/admin/messages', label: 'Compose Message' });
    }
    if (hasPermission(permissions, 'notifications:signup_recipient', role)) {
      adminItems.push({ to: '/admin/notifications', label: 'Notification Settings' });
    }
    if (isCeo(role)) {
      adminItems.push({ to: '/admin/login-logs', label: 'Login Logs' });
    }
    groups.push({ id: 'administration', label: 'Administration', items: adminItems });
  }

  groups.push({
    id: 'settings',
    label: 'Settings',
    items: [{ to: '/settings', label: 'Install & Notifications' }],
  });

  return groups;
}

function isItemActive(item, pathname, search) {
  if (item.match === 'employees-all') {
    return pathname === '/admin/employees' && !new URLSearchParams(search).get('status');
  }
  if (item.match === 'employees-pending') {
    return (
      pathname === '/admin/employees' &&
      new URLSearchParams(search).get('status') === 'pending'
    );
  }
  const path = item.to.split('?')[0];
  if (item.end) return pathname === path;
  return pathname === path || pathname.startsWith(`${path}/`);
}

export default function SidebarNav({
  role,
  permissions,
  tlDashboardAccess,
  unreadMessages = 0,
  onNavigate,
}) {
  const location = useLocation();
  const groups = buildSidebarGroups(role, permissions, {
    tlDashboardAccess,
    unreadMessages,
  });

  return (
    <nav className="sidebar-nav" aria-label="Main">
      {groups.map((group) => (
        <div key={group.id} className="sidebar-group">
          <p className="sidebar-group-label">{group.label}</p>
          <ul className="sidebar-list">
            {group.items.map((item) => {
              const active = isItemActive(item, location.pathname, location.search);
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={Boolean(item.end)}
                    className={`sidebar-link${active ? ' sidebar-link-active' : ''}`}
                    onClick={onNavigate}
                  >
                    <span>{item.label}</span>
                    {item.badge != null && (
                      <span className="sidebar-badge" aria-label={`${item.badge} unread`}>
                        {item.badge > 99 ? '99+' : item.badge}
                      </span>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
