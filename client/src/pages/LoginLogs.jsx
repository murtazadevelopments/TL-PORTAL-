import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';
import Navbar from '../components/Navbar';
import { isCeo } from '../utils/permissions';
import './AdminDashboard.css';

const RANGE_OPTIONS = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom range' },
  { value: 'all', label: 'All time' },
];

function formatWhen(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function shortDevice(ua) {
  if (!ua) return '—';
  const s = String(ua);
  if (s.length <= 72) return s;
  return `${s.slice(0, 72)}…`;
}

function LoginLogs() {
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
  const [range, setRange] = useState('7d');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
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
      const params = {
        page,
        limit: 25,
        q: q || undefined,
        range,
      };
      if (range === 'custom') {
        if (from) params.from = from;
        if (to) params.to = to;
      }
      const { data } = await api.get('/api/admin/login-logs', { params });
      setLogs(Array.isArray(data?.logs) ? data.logs : []);
      setPagination(
        data?.pagination || { page: 1, limit: 25, total: 0, totalPages: 1 }
      );
    } catch (err) {
      if (err.response?.status === 403) {
        setError('Only the CEO can view login logs.');
        navigate('/dashboard', { replace: true });
        return;
      }
      setError(err.response?.data?.message || 'Failed to load login logs.');
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [page, q, range, from, to, navigate]);

  useEffect(() => {
    if (!checking && isCeo(role)) {
      loadLogs();
    }
  }, [checking, role, loadLogs]);

  function handleLogout() {
    localStorage.removeItem('token');
    navigate('/');
  }

  function applySearch(e) {
    e.preventDefault();
    setPage(1);
    setQ(searchInput.trim());
  }

  if (checking) {
    return (
      <div className="page">
        <Navbar showLogout onLogout={handleLogout} />
        <div className="admin-page">
          <div className="admin-loading">
            <div className="spinner" />
            Checking access…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <Navbar showLogout onLogout={handleLogout} role={role} />

      <div className="admin-page">
        <div className="admin-toolbar" style={{ marginTop: 0 }}>
          <div>
            <h1>Login Logs</h1>
            <p className="muted" style={{ margin: 0 }}>
              Recent sign-ins across Portal TL
            </p>
          </div>
          <Link to="/admin" className="btn btn-ghost">
            Back to Admin Panel
          </Link>
        </div>

        <form className="admin-toolbar filters-toolbar" onSubmit={applySearch}>
          <input
            className="admin-search"
            type="search"
            placeholder="Search name, username, or employee ID…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search login logs"
          />
          <select
            className="filter-select"
            value={range}
            onChange={(e) => {
              setRange(e.target.value);
              setPage(1);
            }}
            aria-label="Date range"
          >
            {RANGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {range === 'custom' && (
            <>
              <input
                className="filter-select"
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(1);
                }}
                aria-label="From date"
              />
              <input
                className="filter-select"
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(1);
                }}
                aria-label="To date"
              />
            </>
          )}
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
            <div className="admin-empty">
              No login logs found for this filter. New logins are recorded after
              this feature was enabled — sign in once and refresh.
            </div>
          )}

          {!loading && !error && logs.length > 0 && (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Employee ID</th>
                  <th>IP</th>
                  <th>Location</th>
                  <th>Device</th>
                  <th>Logged in</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((row) => (
                  <tr key={row.id}>
                    <td className="cell-name">
                      {row.employee_name || row.username || '—'}
                    </td>
                    <td>{row.employee_id || '—'}</td>
                    <td>{row.ip_address || '—'}</td>
                    <td>{row.location || '—'}</td>
                    <td title={row.user_agent || ''}>
                      {shortDevice(row.user_agent)}
                    </td>
                    <td>{formatWhen(row.logged_in_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!loading && pagination.total > 0 && (
          <div className="admin-toolbar" style={{ justifyContent: 'space-between' }}>
            <p className="muted" style={{ margin: 0 }}>
              {pagination.total} login{pagination.total === 1 ? '' : 's'} · page{' '}
              {pagination.page} of {pagination.totalPages}
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
                onClick={() =>
                  setPage((p) => Math.min(pagination.totalPages, p + 1))
                }
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default LoginLogs;
