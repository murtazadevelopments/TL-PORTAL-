import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { canAccessAdmin, hasPermission, isCeo, isTeamLeader, canViewTeamAttendance } from '../utils/permissions';

/**
 * Build sidebar groups from role/permissions. Same gates as existing UI.
 */
export function buildSidebarGroups(
  role,
  permissions,
  { tlDashboardAccess = false, unreadMessages = 0, employmentType = null } = {}
) {
  const dashboardItems = [{ to: '/dashboard', label: 'Overview', end: true }];
  if (employmentType === 'remote' || employmentType === 'onsite') {
    dashboardItems.push({ to: '/attendance', label: 'My Attendance' });
  }

  const groups = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      items: dashboardItems,
    },
  ];

  if (isCeo(role) || isTeamLeader(role) || tlDashboardAccess) {
    groups.push({
      id: 'team-leader',
      label: 'Team Leader Dashboard',
      plainLabel: true,
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
    if (hasPermission(permissions, 'employees:view', role) || hasPermission(permissions, 'hr:add_employee', role)) {
      employeeItems.push(
        { to: '/admin/employees', label: 'All Employees', end: true, match: 'employees-all' },
        {
          to: '/admin/employees?status=pending',
          label: 'Pending Approvals',
          match: 'employees-pending',
        }
      );
    }
    if (canViewTeamAttendance(role, permissions)) {
      employeeItems.push({ to: '/admin/attendance', label: 'Team Attendance' });
    }
    if (
      hasPermission(permissions, 'accounts:unlock', role) ||
      hasPermission(permissions, 'employees:deactivate', role)
    ) {
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
    if (hasPermission(permissions, 'hr:add_employee', role)) {
      adminItems.push({ to: '/admin/shifts', label: 'Manage Shifts' });
    }
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

function groupHasActive(group, pathname, search) {
  return group.items.some((item) => isItemActive(item, pathname, search));
}

function groupUnreadBadge(group) {
  return group.items.reduce((sum, item) => sum + (Number(item.badge) || 0), 0);
}

function Chevron({ open }) {
  return (
    <svg
      className={`sidebar-chevron${open ? ' is-open' : ''}`}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path
        d="M4 6.5 L8 10.5 L12 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function SidebarNav({
  role,
  permissions,
  tlDashboardAccess,
  unreadMessages = 0,
  employmentType = null,
  onNavigate,
}) {
  const location = useLocation();
  const groups = useMemo(
    () =>
      buildSidebarGroups(role, permissions, {
        tlDashboardAccess,
        unreadMessages,
        employmentType,
      }),
    [role, permissions, tlDashboardAccess, unreadMessages, employmentType]
  );

  const activeGroupId = useMemo(() => {
    const match = groups.find((g) => groupHasActive(g, location.pathname, location.search));
    return match?.id || groups[0]?.id || null;
  }, [groups, location.pathname, location.search]);

  const [openId, setOpenId] = useState(activeGroupId);

  useEffect(() => {
    setOpenId(activeGroupId);
  }, [activeGroupId]);

  function toggleGroup(id) {
    setOpenId((prev) => (prev === id ? null : id));
  }

  return (
    <nav className="sidebar-nav" aria-label="Main">
      {groups.map((group) => {
        const panelId = `sidebar-panel-${group.id}`;
        const headerId = `sidebar-header-${group.id}`;
        const isOpen = openId === group.id;
        const sectionActive = groupHasActive(group, location.pathname, location.search);
        const unread = groupUnreadBadge(group);
        const only = group.items.length === 1 ? group.items[0] : null;
        const onlyActive = only
          ? isItemActive(only, location.pathname, location.search)
          : false;

        if (only) {
          return (
            <div
              key={group.id}
              className={`sidebar-group sidebar-group-single${onlyActive ? ' is-current' : ''}`}
            >
              <NavLink
                to={only.to}
                end={Boolean(only.end)}
                className={`sidebar-accordion-btn sidebar-accordion-link${onlyActive ? ' is-current' : ''}`}
                onClick={onNavigate}
              >
                <span
                  className={`sidebar-accordion-title${group.plainLabel ? ' is-plain' : ''}`}
                >
                  {group.label}
                </span>
                {only.badge != null && (
                  <span className="sidebar-badge" aria-label={`${only.badge} unread`}>
                    {only.badge > 99 ? '99+' : only.badge}
                  </span>
                )}
              </NavLink>
            </div>
          );
        }

        return (
          <div
            key={group.id}
            className={`sidebar-group${isOpen ? ' is-open' : ''}${sectionActive ? ' is-current' : ''}`}
          >
            <button
              type="button"
              id={headerId}
              className={`sidebar-accordion-btn${sectionActive ? ' is-current' : ''}`}
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => toggleGroup(group.id)}
            >
              <span className="sidebar-accordion-title">{group.label}</span>
              {unread > 0 && !isOpen && (
                <span className="sidebar-badge" aria-label={`${unread} unread`}>
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
              <Chevron open={isOpen} />
            </button>
            <div
              id={panelId}
              role="region"
              aria-labelledby={headerId}
              className={`sidebar-group-panel${isOpen ? ' is-open' : ''}`}
              hidden={!isOpen}
            >
              <ul className="sidebar-list">
                {group.items.map((item) => {
                  const active = isItemActive(item, location.pathname, location.search);
                  return (
                    <li key={`${item.to}:${item.match || item.label}`}>
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
          </div>
        );
      })}
    </nav>
  );
}
