import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { useDocumentOverlay } from '../hooks/useDocumentOverlay';
import RouteErrorBoundary from './RouteErrorBoundary';
import './CnicProtectedViewer.css';

function cnicSideLabel(docType) {
  return String(docType || '').includes('back') ? 'CNIC BACK' : 'CNIC FRONT';
}

function isCaptureChord(e) {
  if (e.key === 'PrintScreen' || e.code === 'PrintScreen') return true;
  if (e.metaKey && e.shiftKey) return true;
  if (e.ctrlKey && e.shiftKey && String(e.key).toLowerCase() === 's') return true;
  return false;
}

function drawWatermark(ctx, width, height, lines) {
  const text = lines.filter(Boolean).join('  ·  ');
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-Math.PI / 6);
  ctx.textAlign = 'center';
  ctx.font = `800 ${Math.max(16, Math.round(width / 22))}px Inter, system-ui, sans-serif`;
  const stepX = Math.max(280, ctx.measureText(text).width + 36);
  const stepY = 56;
  for (let y = -height; y <= height; y += stepY) {
    for (let x = -width; x <= width; x += stepX) {
      ctx.globalAlpha = 0.34;
      ctx.fillStyle = '#0b1220';
      ctx.fillText(text, x + 1, y + 1);
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(text, x, y);
    }
  }
  ctx.restore();
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

function watermarkDate() {
  return new Date().toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function CnicProtectedViewerInner({
  open,
  userId,
  docType,
  title,
  viewerLabel,
  subjectLabel,
  onClose,
}) {
  const { requestClose } = useDocumentOverlay(open, onClose);
  const canvasRef = useRef(null);
  const bitmapRef = useRef(null);
  const restoreTimerRef = useRef(null);
  const zoomRef = useRef(1);
  const rotationRef = useRef(0);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const sideLabel = cnicSideLabel(docType);

  const fitCanvas = useCallback((bitmap) => {
    const canvas = canvasRef.current;
    const source = bitmap || bitmapRef.current;
    if (!canvas || !source) return;
    const sideways = rotationRef.current % 180 !== 0;
    const srcW = sideways ? source.height : source.width;
    const srcH = sideways ? source.width : source.height;
    const maxW = Math.min(920, Math.max(280, window.innerWidth - 72));
    const maxH = Math.max(220, window.innerHeight - 250);
    const scale = Math.min(1, maxW / srcW, maxH / srcH) * zoomRef.current;
    canvas.width = Math.max(1, Math.round(srcW * scale));
    canvas.height = Math.max(1, Math.round(srcH * scale));
  }, []);

  const paint = useCallback((hidden) => {
    const canvas = canvasRef.current;
    const bitmap = bitmapRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    ctx.fillStyle = '#050814';
    ctx.fillRect(0, 0, width, height);
    if (hidden || !bitmap) return;
    const rot = rotationRef.current;
    const sideways = rot % 180 !== 0;
    const drawW = sideways ? height : width;
    const drawH = sideways ? width : height;
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(bitmap, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
    drawWatermark(ctx, width, height, [
      sideLabel,
      `Viewed by: ${viewerLabel || 'admin'}`,
      subjectLabel || '',
      watermarkDate(),
    ]);
  }, [sideLabel, subjectLabel, viewerLabel]);

  const applyView = useCallback(
    (nextZoom, nextRotation) => {
      zoomRef.current = nextZoom;
      rotationRef.current = nextRotation;
      setZoom(nextZoom);
      setRotation(nextRotation);
      fitCanvas();
      paint(paused);
    },
    [fitCanvas, paint, paused]
  );

  const zoomIn = () =>
    applyView(Math.min(ZOOM_MAX, zoomRef.current + ZOOM_STEP), rotationRef.current);
  const zoomOut = () =>
    applyView(Math.max(ZOOM_MIN, zoomRef.current - ZOOM_STEP), rotationRef.current);
  const rotate = () => applyView(zoomRef.current, (rotationRef.current + 90) % 360);
  const resetView = () => applyView(1, 0);

  useEffect(() => {
    if (!open || !userId || !docType) return undefined;
    let cancelled = false;
    setStatus('loading');
    setError('');
    setPaused(false);
    zoomRef.current = 1;
    rotationRef.current = 0;
    setZoom(1);
    setRotation(0);

    async function load() {
      try {
        const { data } = await api.get(`/api/documents/${userId}/${docType}`, {
          responseType: 'blob',
        });
        if (cancelled) return;
        if (data && data.type && String(data.type).includes('json')) {
          const text = await data.text();
          let message = 'Could not open this CNIC.';
          try {
            message = JSON.parse(text).message || message;
          } catch {
            /* ignore */
          }
          throw new Error(message);
        }
        const bitmap = await createImageBitmap(data);
        if (cancelled) {
          bitmap.close();
          return;
        }
        bitmapRef.current = bitmap;
        fitCanvas(bitmap);
        setStatus('ready');
        paint(false);
      } catch (err) {
        if (cancelled) return;
        const fromApi = err.response?.data;
        let message = err.message || 'Could not open this CNIC.';
        if (fromApi instanceof Blob) {
          try {
            const parsed = JSON.parse(await fromApi.text());
            message = parsed.message || message;
          } catch {
            /* ignore */
          }
        } else if (fromApi?.message) {
          message = fromApi.message;
        }
        setError(message);
        setStatus('error');
      }
    }

    load();
    return () => {
      cancelled = true;
      if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
      if (bitmapRef.current) {
        bitmapRef.current.close();
        bitmapRef.current = null;
      }
    };
  }, [open, userId, docType, paint, fitCanvas]);

  useEffect(() => {
    if (!open || status !== 'ready') return undefined;
    function onResize() {
      fitCanvas();
      paint(paused);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, status, paused, fitCanvas, paint]);

  useEffect(() => {
    if (open && status === 'ready') paint(paused);
  }, [open, status, paused, paint]);

  useEffect(() => {
    if (!open || status !== 'ready') return undefined;

    function conceal() {
      if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
      setPaused(true);
      paint(true);
    }

    function restore() {
      if (document.hidden || !document.hasFocus()) return;
      restoreTimerRef.current = setTimeout(() => {
        if (document.hidden || !document.hasFocus()) return;
        setPaused(false);
        paint(false);
      }, 600);
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') return;
      if (isCaptureChord(e)) {
        e.preventDefault();
        conceal();
      }
    }

    function onKeyUp(e) {
      if (e.key === 'PrintScreen' || e.code === 'PrintScreen') {
        conceal();
        return;
      }
      if (!e.metaKey && !e.shiftKey) restore();
    }

    function onVis() {
      if (document.hidden) conceal();
      else restore();
    }

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', conceal);
    window.addEventListener('focus', restore);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('beforeprint', conceal);
    window.addEventListener('afterprint', restore);

    return () => {
      if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', conceal);
      window.removeEventListener('focus', restore);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('beforeprint', conceal);
      window.removeEventListener('afterprint', restore);
    };
  }, [open, status, paint]);

  if (!open) return null;

  return (
    <div
      className="cnic-viewer-backdrop"
      role="presentation"
      onClick={requestClose}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="cnic-viewer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title || sideLabel}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <header className="cnic-viewer-header">
          <div>
            <h2>{title || sideLabel}</h2>
            <p>Screenshots restricted on CNIC front and back. This view is watermarked.</p>
          </div>
          <button type="button" className="icon-btn" onClick={requestClose} aria-label="Close">
            ×
          </button>
        </header>

        {status === 'ready' && (
          <div className="cnic-viewer-toolbar">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={zoomOut}
              disabled={zoom <= ZOOM_MIN}
              aria-label="Zoom out"
              title="Zoom out"
            >
              −
            </button>
            <span className="cnic-viewer-zoom">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={zoomIn}
              disabled={zoom >= ZOOM_MAX}
              aria-label="Zoom in"
              title="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={rotate}
              aria-label="Rotate"
              title="Rotate 90°"
            >
              ⟳ Rotate
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={resetView}
              disabled={zoom === 1 && rotation === 0}
            >
              Reset
            </button>
          </div>
        )}

        <div
          className="cnic-viewer-stage"
          onDragStart={(e) => e.preventDefault()}
          onCopy={(e) => e.preventDefault()}
        >
          {status === 'loading' && <p className="muted">Opening…</p>}
          {status === 'error' && <p className="error">{error}</p>}
          <canvas
            ref={canvasRef}
            className={status === 'ready' ? 'cnic-viewer-canvas' : 'cnic-viewer-canvas is-hidden'}
          />
          <div className="cnic-viewer-shield" data-mark={sideLabel} aria-hidden="true" />
          {paused && status === 'ready' && (
            <div className="cnic-viewer-paused">Screenshot blocked. View hidden until you return to this window.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CnicProtectedViewer(props) {
  return (
    <RouteErrorBoundary
      resetKey={props.open ? `${props.userId || ''}:${props.docType || ''}` : 'closed'}
      onError={props.onClose}
    >
      <CnicProtectedViewerInner {...props} />
    </RouteErrorBoundary>
  );
}
