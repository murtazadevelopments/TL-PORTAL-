import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../../api/client';
import { isCeo } from '../../utils/permissions';
import './AdminDashboard.css';

function formatWhen(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });
  } catch {
    return String(value);
  }
}

export default function EmployeeExportLogsPage() {
  const navigate = useNavigate();
  const [role, setRole] = useState(null);
  const [checking, setChecking] = useState(true);
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    let active = true;
    async function verify() {
      try {
        const { data } = await api.get('/api/users/me');
        if (!active) return;
        if (!isCeo(data.role)) {
          navigate('/dashboard', { replace: true });
          return;
        }
        setRole(data.role);
      } catch {
        if (!active) return;
        localStorage.removeItem('token');
        navigate('/', { replace: true });
      } finally {
        if (active) setChecking(false);
      }
    }
    verify();
    return () => {
      active = false;
    };
  }, [navigate]);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/admin/export-logs', {
        params: { page, limit: 25, q: q || undefined },
      });
      setLogs(Array.isArray(data?.logs) ? data.logs : []);
      setPagination(data?.pagination || { page: 1, limit: 25, total: 0, totalPages: 1 });
    } catch (err) {
      if (err.response?.status === 403) {
        setError('Only the CEO can view export logs.');
        navigate('/dashboard', { replace: true });
        return;
      }
      setError(err.response?.data?.message || 'Failed to load export logs.');
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [page, q, navigate]);

  useEffect(() => {
    if (!checking && isCeo(role)) loadLogs();
  }, [checking, role, loadLogs]);

  function applySearch(e) {
    e.preventDefault();
    setPage(1);
    setQ(searchInput.trim());
  }

  if (checking) {
    return (
      <div className="admin-page page-panel">
        <div className="admin-loading">
          <div className="spinner" />
          Checking access…
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page page-panel">
      <div className="admin-toolbar" style={{ marginTop: 0 }}>
        <div>
          <h1>Export logs</h1>
          <p className="muted" style={{ margin: 0 }}>
            Who exported employee data, when, and whether it was all employees or a specific branch
            or team. Visible only to the CEO.
          </p>
        </div>
      </div>

      <form className="admin-toolbar filters-toolbar" onSubmit={applySearch}>
        <input
          className="admin-search"
          type="search"
          placeholder="Search name, username, employee ID, or limit…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          aria-label="Search export logs"
        />
        <button type="submit" className="btn btn-primary">
          Search
        </button>
      </form>

      <div className="table-shell">
        {loading && (
          <div className="admin-loading">
            <div className="spinner" />
            Loading logs…
          </div>
        )}
        {!loading && error && <div className="admin-empty error">{error}</div>}
        {!loading && !error && logs.length === 0 && (
          <div className="admin-empty">No employee data exports recorded yet.</div>
        )}
        {!loading && !error && logs.length > 0 && (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Exported by</th>
                <th>Employee ID</th>
                <th>File</th>
                <th>Data limit</th>
                <th>Records</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((row) => (
                <tr key={row.id}>
                  <td className="cell-name">
                    {row.actor_name || row.actor_username || '—'}
                    {row.actor_username ? (
                      <div className="muted" style={{ fontWeight: 500 }}>
                        {row.actor_username}
                      </div>
                    ) : null}
                  </td>
                  <td>{row.actor_employee_id || '—'}</td>
                  <td>{row.format || '—'}</td>
                  <td>{row.data_limit || 'All employees'}</td>
                  <td>{row.row_count ?? '—'}</td>
                  <td>{formatWhen(row.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && pagination.total > 0 && (
        <div className="admin-toolbar" style={{ justifyContent: 'space-between' }}>
          <p className="muted" style={{ margin: 0 }}>
            {pagination.total} export{pagination.total === 1 ? '' : 's'} · page {pagination.page} of{' '}
            {pagination.totalPages}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
