import { useCallback, useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import api from '../api/client';
import './EmploymentFormViewer.css';

GlobalWorkerOptions.workerSrc = pdfWorker;

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

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

function clampZoom(value) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

function touchDistance(a, b) {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.hypot(dx, dy);
}

export default function EmploymentFormViewer({ open, src, title, onClose }) {
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const pdfRef = useRef(null);
  const renderTaskRef = useRef(null);
  const pinchRef = useRef(null);

  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);

  const paint = useCallback(async () => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!pdf || !canvas || !stage) return;

    if (renderTaskRef.current) {
      try {
        renderTaskRef.current.cancel();
      } catch {
        /* ignore */
      }
      renderTaskRef.current = null;
    }

    await new Promise((resolve) => requestAnimationFrame(resolve));
    const pdfPage = await pdf.getPage(page);
    const unscaled = pdfPage.getViewport({ scale: 1 });
    const availW = Math.max(120, stage.clientWidth - 24);
    const availH = Math.max(120, stage.clientHeight - 24);
    const fit = Math.min(availW / unscaled.width, availH / unscaled.height);
    const cssW = unscaled.width * fit * zoom;
    const cssH = unscaled.height * fit * zoom;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.25);
    const viewport = pdfPage.getViewport({ scale: fit * zoom * dpr });

    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const task = pdfPage.render({
      canvas,
      viewport,
      background: 'rgb(255,255,255)',
    });
    renderTaskRef.current = task;
    try {
      await task.promise;
    } catch (err) {
      if (err?.name !== 'RenderingCancelledException') throw err;
    } finally {
      if (renderTaskRef.current === task) renderTaskRef.current = null;
    }
  }, [page, zoom]);

  useEffect(() => {
    if (!open || !src) return undefined;
    let cancelled = false;
    setStatus('loading');
    setError('');
    setPage(1);
    setPageCount(0);
    setZoom(1);

    (async () => {
      try {
        const path = documentPath(src);
        const { data } = await api.get(path, { responseType: 'arraybuffer' });
        if (cancelled) return;
        const pdf = await getDocument({ data: new Uint8Array(data).slice() }).promise;
        if (cancelled) {
          pdf.destroy();
          return;
        }
        pdfRef.current = pdf;
        setPageCount(pdf.numPages || 1);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setError(err.response?.data?.message || err.message || 'Could not open the form.');
      }
    })();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          /* ignore */
        }
        renderTaskRef.current = null;
      }
      pdfRef.current?.destroy();
      pdfRef.current = null;
    };
  }, [open, src]);

  useEffect(() => {
    if (!open || status !== 'ready') return undefined;
    let cancelled = false;
    (async () => {
      try {
        await paint();
      } catch (err) {
        if (!cancelled && err?.name !== 'RenderingCancelledException') {
          setStatus('error');
          setError('Could not display this page.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, status, paint]);

  useEffect(() => {
    if (!open || status !== 'ready') return undefined;
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return undefined;
    let timer = 0;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        paint().catch(() => {});
      }, 80);
    });
    observer.observe(stage);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [open, status, paint]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'ArrowRight') {
        setZoom(1);
        setPage((n) => Math.min(pageCount || n, n + 1));
      }
      if (e.key === 'ArrowLeft') {
        setZoom(1);
        setPage((n) => Math.max(1, n - 1));
      }
      if (e.key === '+' || e.key === '=') setZoom((z) => clampZoom(z + 0.25));
      if (e.key === '-' || e.key === '_') setZoom((z) => clampZoom(z - 0.25));
    }
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose, pageCount]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!open || !stage) return undefined;
    function onTouchStart(e) {
      if (e.touches.length === 2) {
        pinchRef.current = {
          dist: touchDistance(e.touches[0], e.touches[1]),
          zoom,
        };
      }
    }
    function onTouchMove(e) {
      if (e.touches.length !== 2 || !pinchRef.current) return;
      e.preventDefault();
      const dist = touchDistance(e.touches[0], e.touches[1]);
      const next = pinchRef.current.zoom * (dist / Math.max(1, pinchRef.current.dist));
      setZoom(clampZoom(next));
    }
    function onTouchEnd() {
      pinchRef.current = null;
    }
    stage.addEventListener('touchstart', onTouchStart, { passive: true });
    stage.addEventListener('touchmove', onTouchMove, { passive: false });
    stage.addEventListener('touchend', onTouchEnd);
    stage.addEventListener('touchcancel', onTouchEnd);
    return () => {
      stage.removeEventListener('touchstart', onTouchStart);
      stage.removeEventListener('touchmove', onTouchMove);
      stage.removeEventListener('touchend', onTouchEnd);
      stage.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [open, zoom]);

  if (!open) return null;

  return (
    <div className="ef-viewer" role="dialog" aria-modal="true" aria-labelledby="ef-viewer-title">
      <header className="ef-viewer-top">
        <div className="ef-viewer-heading">
          <h2 id="ef-viewer-title">{title || 'Employment form'}</h2>
          {status === 'ready' && pageCount > 0 && (
            <p className="ef-viewer-page-label">
              Page {page} of {pageCount}
            </p>
          )}
        </div>
        <button type="button" className="ef-viewer-close" onClick={onClose} aria-label="Close">
          Close
        </button>
      </header>

      <div
        ref={stageRef}
        className={`ef-viewer-stage${zoom > 1 ? ' is-zoomed' : ''}`}
      >
        {status === 'loading' && <p className="ef-viewer-status">Opening form…</p>}
        {status === 'error' && <p className="ef-viewer-status error">{error}</p>}
        <canvas
          ref={canvasRef}
          className="ef-viewer-page"
          hidden={status !== 'ready'}
        />
      </div>

      <footer className="ef-viewer-bar">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={status !== 'ready' || page <= 1}
          onClick={() => {
            setZoom(1);
            setPage((n) => Math.max(1, n - 1));
          }}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setZoom(1)}
          disabled={status !== 'ready' || zoom === 1}
        >
          Fit page
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={status !== 'ready' || page >= pageCount}
          onClick={() => {
            setZoom(1);
            setPage((n) => Math.min(pageCount, n + 1));
          }}
        >
          Next
        </button>
        <div className="ef-viewer-zoom">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={status !== 'ready' || zoom <= MIN_ZOOM}
            onClick={() => setZoom((z) => clampZoom(z - 0.25))}
            aria-label="Zoom out"
          >
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={status !== 'ready' || zoom >= MAX_ZOOM}
            onClick={() => setZoom((z) => clampZoom(z + 0.25))}
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      </footer>
    </div>
  );
}
