import { useEffect, useRef, useState } from 'react';
import api from '../api/client';
import './ComposeMessageModal.css';

const MAX_IMAGES = 10;

/**
 * Admin modal: scan/upload employment form pages → single PDF on the employee.
 */
export default function UploadEmploymentFormModal({
  open,
  employee,
  onClose,
  onSuccess,
}) {
  const inputRef = useRef(null);
  const [pages, setPages] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    setPages([]);
    setError('');
    setSubmitting(false);
    return () => {
      setPages((prev) => {
        prev.forEach((p) => URL.revokeObjectURL(p.previewUrl));
        return [];
      });
    };
  }, [open]);

  if (!open || !employee) return null;

  const isReplace = Boolean(employee.employment_form_url);

  function addFiles(fileList) {
    const incoming = Array.from(fileList || []).filter((f) =>
      String(f.type || '').startsWith('image/')
    );
    if (!incoming.length) {
      setError('Please choose image files only.');
      return;
    }
    setError('');
    setPages((prev) => {
      const room = MAX_IMAGES - prev.length;
      if (room <= 0) return prev;
      const next = incoming.slice(0, room).map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      return [...prev, ...next];
    });
  }

  function removePage(id) {
    setPages((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  async function handleCreatePdf() {
    if (!pages.length || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const body = new FormData();
      pages.forEach((p) => body.append('images', p.file));
      const { data } = await api.post(
        `/api/admin/employees/${employee.id}/employment-form`,
        body
      );
      onSuccess?.(data);
      onClose?.();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.message ||
          'Failed to create employment form PDF.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  const atLimit = pages.length >= MAX_IMAGES;

  return (
    <div
      className="modal-backdrop modal-backdrop-stack"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="modal-panel modal-panel-center compose-message-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="employment-form-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="employment-form-title">
              {isReplace ? 'Change Employment Form' : 'Upload Employment Form'}
            </h2>
            <p className="muted" style={{ margin: '0.25rem 0 0' }}>
              {employee.name || employee.username || 'Employee'} —{' '}
              {isReplace
                ? 'new scans will replace the existing PDF'
                : 'scan pages, then create PDF'}
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            Close
          </button>
        </header>

        <div className="compose-message-form">
          <p className="muted" style={{ margin: 0 }}>
            {pages.length} / {MAX_IMAGES} images
          </p>

          {pages.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
                gap: '0.65rem',
              }}
            >
              {pages.map((page, index) => (
                <div
                  key={page.id}
                  style={{
                    position: 'relative',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    overflow: 'hidden',
                    background: 'rgba(5, 8, 16, 0.5)',
                  }}
                >
                  <img
                    src={page.previewUrl}
                    alt={`Page ${index + 1}`}
                    style={{ width: '100%', height: 110, objectFit: 'cover', display: 'block' }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      top: 4,
                      left: 6,
                      fontSize: 11,
                      background: 'rgba(0,0,0,0.65)',
                      padding: '1px 6px',
                      borderRadius: 999,
                    }}
                  >
                    {index + 1}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{
                      position: 'absolute',
                      top: 2,
                      right: 2,
                      padding: '0.15rem 0.4rem',
                      fontSize: 12,
                    }}
                    disabled={submitting}
                    onClick={() => removePage(page.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />

          {!atLimit && (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={submitting}
              onClick={() => inputRef.current?.click()}
            >
              {pages.length ? 'Add Another Image' : 'Add Image'}
            </button>
          )}

          {error && <p className="error">{error}</p>}

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!pages.length || submitting}
              onClick={handleCreatePdf}
            >
              {submitting
                ? isReplace
                  ? 'Replacing PDF…'
                  : 'Creating PDF…'
                : isReplace
                  ? 'Replace PDF'
                  : 'Create PDF'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={submitting} onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
