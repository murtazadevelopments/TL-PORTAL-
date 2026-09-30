import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../api/client';
import { isCeo } from '../utils/permissions';
import './AdminDashboard.css';

const RANGE_OPTIONS = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

function formatWhen(value) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Karachi',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function tidyText(value) {
  if (!value) return '';
  return String(value)
    .replace(/[\u0600-\u06FF]+/g, '')
    .replace(/[،]+/g, ',')
    .replace(/\s+,/g, ',')
    .replace(/,+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^,|,$/g, '')
    .trim();
}

function locationLine(row) {
  const parts = [];
  for (const part of [tidyText(row.area), tidyText(row.city), tidyText(row.country)]) {
    if (!part) continue;
    const lower = part.toLowerCase();
    if (parts.some((p) => p.toLowerCase().includes(lower) || lower.includes(p.toLowerCase()))) {
      continue;
    }
    parts.push(part);
  }
  const line = parts.join(', ') || tidyText(row.location) || '—';
  if (line.length > 72) return `${line.slice(0, 70).replace(/[, ]+$/, '')}…`;
  return line;
}

function shortIp(ip) {
  if (!ip) return '—';
  const s = String(ip);
  if (s.includes(':') && s.length > 22) return `${s.slice(0, 18)}…`;
  return s;
}

function formatCoords(lat, lng) {
  if (lat == null || lng == null || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) {
    return null;
  }
  const a = Number(lat);
  const b = Number(lng);
  const decimals = 6;
  return `${a.toFixed(decimals)}, ${b.toFixed(decimals)}`;
}

function mapsUrl(lat, lng) {
  if (lat == null || lng == null) return null;
  return `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`;
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
  const [range, setRange] = useState('30d');
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
      const { data } = await api.get('/api/admin/login-logs', { params });
      setLogs(Array.isArray(data?.logs) ? data.logs : []);
      setPagination(data?.pagination || { page: 1, limit: 25, total: 0, totalPages: 1 });
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
  }, [page, q, range, navigate]);

  useEffect(() => {
    if (!checking && isCeo(role)) {
      loadLogs();
    }
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
          <h1>Login Logs</h1>
          <p className="muted" style={{ margin: 0 }}>
            Sign-ins from the last 30 days. Map pins are GPS only. If location is denied, city
            comes from the user’s public IP (not a street pin).
          </p>
        </div>
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
            No login logs found for this filter. New logins are recorded after this feature was
            enabled — sign in once and refresh.
          </div>
        )}

        {!loading && !error && logs.length > 0 && (
          <table className="admin-table login-logs-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Location</th>
                <th>Map</th>
                <th>IP</th>
                <th>Device</th>
                <th>Logged in</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((row) => {
                const place = locationLine(row);
                const gps = row.location_source === 'gps' && formatCoords(row.latitude, row.longitude);
                return (
                  <tr key={row.id}>
                    <td>
                      <div className="login-emp">
                        <strong>{row.employee_name || row.username || '—'}</strong>
                        <span>{row.employee_id || '—'}</span>
                      </div>
                    </td>
                    <td>
                      <div className="login-place" title={place}>
                        {place}
                      </div>
                    </td>
                    <td>
                      {gps ? (
                        <a
                          className="coord-link"
                          href={mapsUrl(row.latitude, row.longitude)}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          View map
                        </a>
                      ) : (
                        <span className="muted">No GPS</span>
                      )}
                    </td>
                    <td title={row.ip_address || ''}>{shortIp(row.ip_address)}</td>
                    <td title={row.user_agent || ''}>
                      {row.device || shortDevice(row.user_agent)}
                    </td>
                    <td className="login-when">{formatWhen(row.logged_in_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {!loading && pagination.total > 0 && (
        <div className="admin-toolbar" style={{ justifyContent: 'space-between' }}>
          <p className="muted" style={{ margin: 0 }}>
            {pagination.total} login{pagination.total === 1 ? '' : 's'} · page {pagination.page} of{' '}
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

export default LoginLogs;
