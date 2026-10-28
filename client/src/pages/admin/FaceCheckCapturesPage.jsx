import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import api from '../../api/client';
import PhotoLightbox from '../../components/PhotoLightbox';
import { useAuthUser } from '../../context/AuthUserContext';
import { isCeo } from '../../utils/permissions';
import { withAuthDocumentUrl } from '../../utils/documentUrls';
import './AttendanceAdminPage.css';

function karachiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatWhen(value) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Karachi',
      day: '2-digit',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

export function FaceCheckShot({ captureId, cacheKey, name, onOpen }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;
    setFailed(false);
    setSrc(null);
    (async () => {
      try {
        const res = await api.get(`/api/documents/face-checks/${captureId}`, {
          responseType: 'blob',
          params: cacheKey ? { _cb: String(cacheKey).replace(/\W/g, '').slice(-16) } : undefined,
        });
        if (cancelled) return;
        const blob = res.data;
        if (!(blob instanceof Blob) || blob.size < 80 || String(blob.type || '').includes('json')) {
          setFailed(true);
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [captureId, cacheKey]);

  return (
    <button
      type="button"
      className="face-check-shot"
      onClick={() => src && onOpen?.({ src, alt: name || 'Check-in photo' })}
    >
      {src ? (
        <img src={src} alt="" />
      ) : (
        <span>{failed ? 'Photo missing' : 'Loading…'}</span>
      )}
    </button>
  );
}

export default function FaceCheckCapturesPage() {
  const { user, loading: authLoading } = useAuthUser();
  const ceo = isCeo(user?.role);
  const [date, setDate] = useState('');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState({ date: '', search: '' });
  const [captures, setCaptures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);

  const load = useCallback(async (filters) => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (filters.date) params.date = filters.date;
      if (filters.search) params.search = filters.search;
      const { data } = await api.get('/api/admin/attendance/face-checks', { params });
      setCaptures(Array.isArray(data?.captures) ? data.captures : []);
    } catch (err) {
      setCaptures([]);
      setError(err.response?.data?.message || 'Could not load face check photos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ceo) return undefined;
    load(applied);
    return undefined;
  }, [ceo, applied, load]);

  if (authLoading) return null;
  if (!ceo) return <Navigate to="/dashboard" replace />;

  return (
    <div className="admin-page page-panel attendance-admin face-check-page">
      <div className="attendance-hero">
        <div>
          <h1>Face check photos</h1>
          <p className="muted">
            Cross-check who appeared on camera at remote face check-in. Photos are saved only when
            Picture is on for that employee.
          </p>
        </div>
        <Link className="btn btn-ghost" to="/admin/attendance/remote">
          Team attendance
        </Link>
      </div>

      <form
        className="attendance-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ date, search: search.trim() });
        }}
      >
        <label>
          Date
          <input type="date" value={date} max={karachiDateKey()} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Search
          <input
            type="search"
            value={search}
            placeholder="Name or employee ID"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? 'Loading…' : 'Filter'}
        </button>
        {date || search ? (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setDate('');
              setSearch('');
              setApplied({ date: '', search: '' });
            }}
          >
            Clear
          </button>
        ) : null}
      </form>

      {error ? <p className="error">{error}</p> : null}
      {!loading && !error && captures.length === 0 ? (
        <p className="muted">No check-in photos yet. Turn Picture on for a remote employee, then wait for a face check-in.</p>
      ) : null}

      <div className="face-check-grid">
        {captures.map((row) => {
          const profile = withAuthDocumentUrl(row.profile_picture_url, row.user_id);
          return (
            <article key={row.id} className="face-check-card">
              <FaceCheckShot
                captureId={row.id}
                cacheKey={row.captured_at || row.id}
                name={row.name}
                onOpen={setPreview}
              />
              <div className="face-check-meta">
                <div className="face-check-who">
                  {profile ? <img src={profile} alt="" /> : <span>{(row.name || '?')[0]}</span>}
                  <div>
                    <strong>{row.name}</strong>
                    <p className="muted">
                      {row.employee_id || 'No ID'}
                      {row.branch ? ` · ${row.branch}` : ''}
                    </p>
                  </div>
                </div>
                <p className="muted">{formatWhen(row.captured_at)}</p>
                <span className={`badge ${row.status || ''}`}>{row.status || 'saved'}</span>
              </div>
            </article>
          );
        })}
      </div>

      <PhotoLightbox
        open={Boolean(preview?.src)}
        src={preview?.src}
        alt={preview?.alt}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}
