import { useEffect, useRef, useState } from 'react';
import './AvatarEditor.css';

const OUTPUT_SIZE = 512;
const FRAME = 240;
const NUDGE = 8;

const INITIAL = { zoom: 1, x: 0, y: 0, rotate: 0 };

/**
 * Modal to change + manually adjust (move / zoom / rotate) a square profile photo.
 */
function AvatarEditor({ open, currentUrl, onClose, onSave, saving = false }) {
  const fileInputRef = useRef(null);
  const imgRef = useRef(null);
  const [sourceUrl, setSourceUrl] = useState(null);
  const [zoom, setZoom] = useState(INITIAL.zoom);
  const [offset, setOffset] = useState({ x: INITIAL.x, y: INITIAL.y });
  const [rotate, setRotate] = useState(INITIAL.rotate);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const [error, setError] = useState('');
  const [natural, setNatural] = useState({ w: 0, h: 0 });

  function resetAdjust() {
    setZoom(INITIAL.zoom);
    setOffset({ x: INITIAL.x, y: INITIAL.y });
    setRotate(INITIAL.rotate);
  }

  useEffect(() => {
    if (!open) return;
    setSourceUrl(currentUrl || null);
    resetAdjust();
    setError('');
  }, [open, currentUrl]);

  useEffect(() => {
    return () => {
      if (sourceUrl && sourceUrl.startsWith('blob:')) URL.revokeObjectURL(sourceUrl);
    };
  }, [sourceUrl]);

  if (!open) return null;

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be 5MB or smaller.');
      return;
    }
    setError('');
    const url = URL.createObjectURL(file);
    setSourceUrl((prev) => {
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
      return url;
    });
    resetAdjust();
  }

  function nudge(dx, dy) {
    setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
  }

  function onPointerDown(e) {
    if (!sourceUrl) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }

  function onPointerMove(e) {
    if (!dragging) return;
    setOffset({
      x: dragStart.current.ox + (e.clientX - dragStart.current.x),
      y: dragStart.current.oy + (e.clientY - dragStart.current.y),
    });
  }

  function onPointerUp(e) {
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  async function handleSave() {
    if (!sourceUrl || !imgRef.current || !natural.w) {
      setError('Choose an image first.');
      return;
    }

    const img = imgRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');

    const coverScale = Math.max(FRAME / natural.w, FRAME / natural.h) * zoom;
    const drawW = natural.w * coverScale;
    const drawH = natural.h * coverScale;
    const scaleOut = OUTPUT_SIZE / FRAME;

    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    ctx.save();
    ctx.translate(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2);
    ctx.rotate((rotate * Math.PI) / 180);
    ctx.translate(-OUTPUT_SIZE / 2, -OUTPUT_SIZE / 2);

    const dx = (FRAME - drawW) / 2 + offset.x;
    const dy = (FRAME - drawH) / 2 + offset.y;
    ctx.drawImage(img, dx * scaleOut, dy * scaleOut, drawW * scaleOut, drawH * scaleOut);
    ctx.restore();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) {
      setError('Could not process image.');
      return;
    }
    onSave(blob);
  }

  const disabled = !sourceUrl || saving;

  return (
    <div className="avatar-editor-backdrop" onClick={onClose}>
      <div
        className="avatar-editor-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Adjust profile photo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="avatar-editor-header">
          <h2>Profile photo</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p className="muted">
          Change the image, then use drag or the manual controls to position it.
        </p>

        <div
          className={`avatar-editor-stage ${dragging ? 'dragging' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {sourceUrl ? (
            <img
              ref={imgRef}
              src={sourceUrl}
              alt=""
              draggable={false}
              crossOrigin={sourceUrl.startsWith('http') ? 'anonymous' : undefined}
              onLoad={(e) =>
                setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
              }
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom}) rotate(${rotate}deg)`,
              }}
            />
          ) : (
            <span className="muted">No image selected</span>
          )}
        </div>

        <fieldset className="avatar-manual" disabled={disabled}>
          <legend>Manual adjustment</legend>

          <label className="avatar-control">
            <span>Zoom ({zoom.toFixed(2)}×)</span>
            <input
              type="range"
              min="1"
              max="3"
              step="0.05"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>

          <label className="avatar-control">
            <span>Move horizontal ({Math.round(offset.x)}px)</span>
            <input
              type="range"
              min="-120"
              max="120"
              step="1"
              value={offset.x}
              onChange={(e) => setOffset((prev) => ({ ...prev, x: Number(e.target.value) }))}
            />
          </label>

          <label className="avatar-control">
            <span>Move vertical ({Math.round(offset.y)}px)</span>
            <input
              type="range"
              min="-120"
              max="120"
              step="1"
              value={offset.y}
              onChange={(e) => setOffset((prev) => ({ ...prev, y: Number(e.target.value) }))}
            />
          </label>

          <label className="avatar-control">
            <span>Rotate ({rotate}°)</span>
            <input
              type="range"
              min="-180"
              max="180"
              step="1"
              value={rotate}
              onChange={(e) => setRotate(Number(e.target.value))}
            />
          </label>

          <div className="avatar-nudge" aria-label="Nudge position">
            <span className="avatar-nudge-label">Nudge</span>
            <div className="avatar-nudge-pad">
              <button type="button" className="btn btn-ghost" onClick={() => nudge(0, -NUDGE)} aria-label="Move up">
                ↑
              </button>
              <div className="avatar-nudge-mid">
                <button type="button" className="btn btn-ghost" onClick={() => nudge(-NUDGE, 0)} aria-label="Move left">
                  ←
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => nudge(NUDGE, 0)} aria-label="Move right">
                  →
                </button>
              </div>
              <button type="button" className="btn btn-ghost" onClick={() => nudge(0, NUDGE)} aria-label="Move down">
                ↓
              </button>
            </div>
            <button type="button" className="btn btn-ghost avatar-reset" onClick={resetAdjust}>
              Reset adjust
            </button>
          </div>
        </fieldset>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          hidden
          onChange={handleFile}
        />

        {error && <p className="error">{error}</p>}

        <div className="avatar-editor-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => fileInputRef.current?.click()}
            disabled={saving}
          >
            Change image
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || !sourceUrl}
          >
            {saving ? 'Saving…' : 'Save photo'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AvatarEditor;
