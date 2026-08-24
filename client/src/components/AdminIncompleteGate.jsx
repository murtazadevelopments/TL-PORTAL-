import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import api from '../api/client';
import { isHrAssignee } from '../utils/permissions';
import {
  missingAdminAssignFields,
  missingEmployeePortalFields,
} from '../utils/profileCompleteness';
import './AdminIncompleteGate.css';

export const ADMIN_INCOMPLETE_EVENT = 'tl-admin-incomplete-refresh';

function buildIncomplete(row) {
  const missingAdmin = missingAdminAssignFields(row);
  const missingEmployee = missingEmployeePortalFields(row);
  if (!missingAdmin.length && !missingEmployee.length) return null;
  return {
    id: row.id,
    name: row.name || row.username || 'Employee',
    employeeId: row.employee_id || '',
    missingAdmin,
    missingEmployee,
    missingCount: missingAdmin.length + missingEmployee.length,
  };
}

export default function AdminIncompleteGate({ user }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const hrOnly = isHrAssignee(user);

  const load = useCallback(async () => {
    if (!hrOnly) return;
    try {
      const { data } = await api.get('/api/admin/employees');
      setRows(Array.isArray(data) ? data : []);
    } catch {
      /* list optional */
    }
  }, [hrOnly]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    function onRefresh() {
      load();
    }
    window.addEventListener(ADMIN_INCOMPLETE_EVENT, onRefresh);
    return () => window.removeEventListener(ADMIN_INCOMPLETE_EVENT, onRefresh);
  }, [load]);

  const incomplete = useMemo(
    () => rows.map(buildIncomplete).filter(Boolean),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return incomplete;
    return incomplete.filter((row) => {
      const hay = `${row.name} ${row.employeeId} ${row.missingAdmin.map((f) => f.label).join(' ')} ${row.missingEmployee.map((f) => f.label).join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [incomplete, query]);

  const fillId = new URLSearchParams(location.search).get('fill');
  useEffect(() => {
    if (fillId) setOpen(false);
  }, [fillId]);

  if (!hrOnly || incomplete.length === 0) return null;

  function openEmployee(id) {
    setOpen(false);
    navigate(`/admin/employees?fill=${id}`);
  }

  return (
    <div className={`hr-incomplete-dock${open ? ' open' : ''}`}>
      <button
        type="button"
        className="hr-incomplete-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="hr-incomplete-count">{incomplete.length}</span>
        <span>
          {incomplete.length === 1
            ? 'employee incomplete'
            : 'employees incomplete'}
        </span>
        <span className="hr-incomplete-hint">{open ? 'Hide list' : 'Show all'}</span>
      </button>

      {open && (
        <div className="hr-incomplete-panel" role="dialog" aria-label="Incomplete employees">
          <header>
            <div>
              <p className="hr-incomplete-kicker">HR only</p>
              <h2>Incomplete employee details</h2>
              <p>
                {incomplete.length} {incomplete.length === 1 ? 'person is' : 'people are'} missing
                at least one required field. Search and open anyone — you can keep working in the
                portal.
              </p>
            </div>
            <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close list">
              ×
            </button>
          </header>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, ID, or missing field…"
            aria-label="Search incomplete employees"
          />
          <ul className="hr-incomplete-list">
            {filtered.length === 0 && (
              <li className="hr-incomplete-empty">No matches in this list.</li>
            )}
            {filtered.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>{row.name}</strong>
                  {row.employeeId ? <em>{row.employeeId}</em> : <em>No employee ID</em>}
                  {row.missingAdmin.length > 0 && (
                    <span>HR / admin: {row.missingAdmin.map((f) => f.label).join(', ')}</span>
                  )}
                  {row.missingEmployee.length > 0 && (
                    <span>Employee portal: {row.missingEmployee.map((f) => f.label).join(', ')}</span>
                  )}
                </div>
                <button type="button" className="btn btn-primary" onClick={() => openEmployee(row.id)}>
                  Fill now
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
