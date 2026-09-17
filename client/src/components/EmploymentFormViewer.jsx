import { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import './EmploymentFormViewer.css';

function documentPath(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/api/')) {
    return raw.includes('?') ? raw.slice(0, raw.indexOf('?')) : raw;
  }
  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.pathname.startsWith('/api/documents/')) return parsed.pathname;
  } catch {
    /* ignore */
  }
  return raw;
}

export default function EmploymentFormViewer({ open, src, title, onClose }) {
  const [blobUrl, setBlobUrl] = useState('');
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !src) return undefined;
    let cancelled = false;
    let created = '';
    setStatus('loading');
    setError('');
    setZoom(1);

    (async () => {
      try {
        const path = documentPath(src);
        const { data } = await api.get(path, { responseType: 'blob' });
        if (cancelled) return;
        created = URL.createObjectURL(data);
        setBlobUrl(created);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setError(err.response?.data?.message || err.message || 'Could not open the PDF.');
      }
    })();

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [open, src]);

  const viewerSrc = useMemo(() => {
    if (!blobUrl) return '';
    return `${blobUrl}#toolbar=1&navpanes=0&scrollbar=1&view=FitH&zoom=page-width`;
  }, [blobUrl]);

  if (!open) return null;

  function bumpZoom(delta) {
    setZoom((prev) => Math.min(3, Math.max(0.5, Number((prev + delta).toFixed(2)))));
  }

  return (
    <div className="modal-backdrop modal-backdrop-stack" role="presentation" onClick={onClose}>
      <div
        className="modal-panel modal-panel-center employment-form-viewer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="employment-form-viewer-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h2 id="employment-form-viewer-title">{title || 'Employment form'}</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="employment-form-viewer-toolbar">
          <button type="button" className="btn btn-ghost" onClick={() => bumpZoom(-0.25)} disabled={zoom <= 0.5}>
            Zoom out
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setZoom(1)}>
            Fit screen
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => bumpZoom(0.25)} disabled={zoom >= 3}>
            Zoom in
          </button>
          <span className="muted">{Math.round(zoom * 100)}%</span>
        </div>

        {status === 'loading' && <p className="muted">Loading PDF…</p>}
        {status === 'error' && <p className="error">{error}</p>}
        {status === 'ready' && viewerSrc && (
          <div className="employment-form-viewer-scroll">
            <div
              className="employment-form-viewer-stage"
              style={{
                width: `${zoom * 100}%`,
                height: `${Math.max(70, zoom * 100)}%`,
              }}
            >
              <iframe title={title || 'Employment form'} src={viewerSrc} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
