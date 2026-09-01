import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client';
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

export default function CnicProtectedViewer({
  open,
  userId,
  docType,
  title,
  viewerLabel,
  subjectLabel,
  onClose,
}) {
  const canvasRef = useRef(null);
  const bitmapRef = useRef(null);
  const restoreTimerRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
  const sideLabel = cnicSideLabel(docType);

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
    ctx.drawImage(bitmap, 0, 0, width, height);
    drawWatermark(ctx, width, height, [
      sideLabel,
      viewerLabel || 'admin',
      subjectLabel || '',
      new Date().toLocaleString(),
    ]);
  }, [sideLabel, subjectLabel, viewerLabel]);

  useEffect(() => {
    if (!open || !userId || !docType) return undefined;
    let cancelled = false;
    setStatus('loading');
    setError('');
    setPaused(false);

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
        const canvas = canvasRef.current;
        if (canvas) {
          const maxW = Math.min(920, window.innerWidth - 48);
          const scale = Math.min(1, maxW / bitmap.width);
          canvas.width = Math.max(1, Math.round(bitmap.width * scale));
          canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        }
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
  }, [open, userId, docType, paint]);

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
      if (e.key === 'Escape') {
        onClose();
        return;
      }
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
  }, [open, status, onClose, paint]);

  if (!open) return null;

  return (
    <div
      className="cnic-viewer-backdrop"
      role="presentation"
      onClick={onClose}
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
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

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
