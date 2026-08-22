import { useEffect, useMemo, useRef, useState } from 'react';
import './AvatarEditor.css';

const OUTPUT_SIZE = 512;
const FRAME = 240;
const NUDGE = 8;

/**
 * Cover scale so the image fully fills the circular frame at the given zoom.
 */
function coverMetrics(naturalW, naturalH, zoom) {
  if (!naturalW || !naturalH) {
    return { coverScale: 1, drawW: FRAME, drawH: FRAME, maxX: 0, maxY: 0 };
  }
  const coverScale = Math.max(FRAME / naturalW, FRAME / naturalH) * zoom;
  const drawW = naturalW * coverScale;
  const drawH = naturalH * coverScale;
  return {
    coverScale,
    drawW,
    drawH,
    maxX: Math.max(0, (drawW - FRAME) / 2),
    maxY: Math.max(0, (drawH - FRAME) / 2),
  };
}

/** Prefer upper portion of portrait photos so faces land in the circle. */
function faceBiasOffset(naturalW, naturalH) {
  const { maxX, maxY } = coverMetrics(naturalW, naturalH, 1);
  if (naturalH > naturalW && maxY > 0) {
    // Positive Y shifts the bitmap down → shows more of the top (face)
    return { x: 0, y: Math.round(maxY * 0.55) };
  }
  return { x: 0, y: 0 };
}

function clampOffset(offset, maxX, maxY) {
  return {
    x: Math.max(-maxX, Math.min(maxX, offset.x)),
    y: Math.max(-maxY, Math.min(maxY, offset.y)),
  };
}

/**
 * Modal to change + manually adjust (move / zoom / rotate) a square profile photo.
 * Preview positioning uses the same cover math as the save canvas (avoids face cut-off).
 */
function AvatarEditor({ open, currentUrl, onClose, onSave, saving = false }) {
  const fileInputRef = useRef(null);
  const imgRef = useRef(null);
  const [sourceUrl, setSourceUrl] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [rotate, setRotate] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const [error, setError] = useState('');
  const [natural, setNatural] = useState({ w: 0, h: 0 });

  const metrics = useMemo(
    () => coverMetrics(natural.w, natural.h, zoom),
    [natural.w, natural.h, zoom]
  );

  const drawPos = useMemo(() => {
    const { drawW, drawH, maxX, maxY } = metrics;
    const clamped = clampOffset(offset, maxX, maxY);
    return {
      x: (FRAME - drawW) / 2 + clamped.x,
      y: (FRAME - drawH) / 2 + clamped.y,
      drawW,
      drawH,
      clamped,
    };
  }, [metrics, offset]);

  function resetAdjust(forNatural = natural) {
    setZoom(1);
    setRotate(0);
    if (forNatural.w && forNatural.h) {
      setOffset(faceBiasOffset(forNatural.w, forNatural.h));
    } else {
      setOffset({ x: 0, y: 0 });
    }
  }

  useEffect(() => {
    if (!open) return;
    setSourceUrl(currentUrl || null);
    setNatural({ w: 0, h: 0 });
    setZoom(1);
    setRotate(0);
    setOffset({ x: 0, y: 0 });
    setError('');
  }, [open, currentUrl]);

  useEffect(() => {
    return () => {
      if (sourceUrl && sourceUrl.startsWith('blob:')) URL.revokeObjectURL(sourceUrl);
    };
  }, [sourceUrl]);

  // Keep offset in range when zoom changes
  useEffect(() => {
    setOffset((prev) => clampOffset(prev, metrics.maxX, metrics.maxY));
  }, [metrics.maxX, metrics.maxY]);

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
    setNatural({ w: 0, h: 0 });
    setZoom(1);
    setRotate(0);
    setOffset({ x: 0, y: 0 });
  }

  function onImageLoad(e) {
    const w = e.currentTarget.naturalWidth;
    const h = e.currentTarget.naturalHeight;
    setNatural({ w, h });
    setZoom(1);
    setRotate(0);
    setOffset(faceBiasOffset(w, h));
  }

  function nudge(dx, dy) {
    setOffset((prev) => clampOffset({ x: prev.x + dx, y: prev.y + dy }, metrics.maxX, metrics.maxY));
  }

  function onPointerDown(e) {
    if (!sourceUrl) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      ox: drawPos.clamped.x,
      oy: drawPos.clamped.y,
    };
  }

  function onPointerMove(e) {
    if (!dragging) return;
    setOffset(
      clampOffset(
        {
          x: dragStart.current.ox + (e.clientX - dragStart.current.x),
          y: dragStart.current.oy + (e.clientY - dragStart.current.y),
        },
        metrics.maxX,
        metrics.maxY
      )
    );
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
    const scaleOut = OUTPUT_SIZE / FRAME;
    const { drawW, drawH, clamped } = drawPos;
    const dx = (FRAME - drawW) / 2 + clamped.x;
    const dy = (FRAME - drawH) / 2 + clamped.y;

    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    ctx.save();
    ctx.translate(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2);
    ctx.rotate((rotate * Math.PI) / 180);
    ctx.translate(-OUTPUT_SIZE / 2, -OUTPUT_SIZE / 2);
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
  const sliderX = Math.max(120, Math.ceil(metrics.maxX) || 120);
  const sliderY = Math.max(120, Math.ceil(metrics.maxY) || 120);

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
          Change the image, then use drag or the manual controls to position the face in the circle.
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
              onLoad={onImageLoad}
              style={{
                position: 'absolute',
                left: drawPos.x,
                top: drawPos.y,
                width: drawPos.drawW,
                height: drawPos.drawH,
                maxWidth: 'none',
                transform: `rotate(${rotate}deg)`,
                transformOrigin: 'center center',
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
            <span>Move horizontal ({Math.round(drawPos.clamped.x)}px)</span>
            <input
              type="range"
              min={-sliderX}
              max={sliderX}
              step="1"
              value={drawPos.clamped.x}
              onChange={(e) =>
                setOffset((prev) =>
                  clampOffset({ ...prev, x: Number(e.target.value) }, metrics.maxX, metrics.maxY)
                )
              }
            />
          </label>

          <label className="avatar-control">
            <span>Move vertical ({Math.round(drawPos.clamped.y)}px)</span>
            <input
              type="range"
              min={-sliderY}
              max={sliderY}
              step="1"
              value={drawPos.clamped.y}
              onChange={(e) =>
                setOffset((prev) =>
                  clampOffset({ ...prev, y: Number(e.target.value) }, metrics.maxX, metrics.maxY)
                )
              }
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
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => nudge(0, -NUDGE)}
                aria-label="Move up"
              >
                ↑
              </button>
              <div className="avatar-nudge-mid">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => nudge(-NUDGE, 0)}
                  aria-label="Move left"
                >
                  ←
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => nudge(NUDGE, 0)}
                  aria-label="Move right"
                >
                  →
                </button>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => nudge(0, NUDGE)}
                aria-label="Move down"
              >
                ↓
              </button>
            </div>
            <button
              type="button"
              className="btn btn-ghost avatar-reset"
              onClick={() => resetAdjust(natural)}
            >
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
