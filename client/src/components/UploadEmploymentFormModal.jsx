import { useEffect, useRef, useState } from 'react';
import api from '../api/client';
import './ComposeMessageModal.css';

const MAX_IMAGES = 10;

/**
 * Admin modal: upload an existing PDF, or scan images → PDF on the employee.
 */
export default function UploadEmploymentFormModal({
  open,
  employee,
  onClose,
  onSuccess,
}) {
  const imageInputRef = useRef(null);
  const pdfInputRef = useRef(null);
  const [mode, setMode] = useState(null); // null | 'pdf' | 'images'
  const [pages, setPages] = useState([]);
  const [pdfFile, setPdfFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    setMode(null);
    setPages([]);
    setPdfFile(null);
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

  function chooseMode(next) {
    setError('');
    setPages((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      return [];
    });
    setPdfFile(null);
    setMode(next);
  }

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

  function handlePdfPick(fileList) {
    const file = fileList?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setError('Please choose a PDF file.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('PDF must be 8MB or smaller.');
      return;
    }
    setError('');
    setPdfFile(file);
  }

  async function handleUploadPdf() {
    if (!pdfFile || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const body = new FormData();
      body.append('pdf', pdfFile);
      const { data } = await api.post(
        `/api/admin/employees/${employee.id}/employment-form`,
        body
      );
      onSuccess?.(data);
      onClose?.();
    } catch (err) {
      setError(
        err.response?.data?.message || err.message || 'Failed to upload PDF.'
      );
    } finally {
      setSubmitting(false);
    }
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
              {employee.name || employee.username || 'Employee'}
              {isReplace ? ' — replaces the existing form' : ''}
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            Close
          </button>
        </header>

        <div className="compose-message-form">
          {!mode && (
            <>
              <p className="muted" style={{ margin: 0 }}>
                How do you want to add the form?
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={submitting}
                  onClick={() => chooseMode('pdf')}
                >
                  I already have a PDF
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={submitting}
                  onClick={() => chooseMode('images')}
                >
                  Scan / add images (create PDF)
                </button>
              </div>
            </>
          )}

          {mode === 'pdf' && (
            <>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={submitting}
                onClick={() => chooseMode(null)}
                style={{ alignSelf: 'flex-start' }}
              >
                ← Back
              </button>
              <p className="muted" style={{ margin: 0 }}>
                Choose the employment form PDF to upload.
              </p>
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf"
                hidden
                onChange={(e) => {
                  handlePdfPick(e.target.files);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="btn btn-ghost"
                disabled={submitting}
                onClick={() => pdfInputRef.current?.click()}
              >
                {pdfFile ? 'Change PDF' : 'Choose PDF'}
              </button>
              {pdfFile && (
                <p className="muted" style={{ margin: 0 }}>
                  Selected: {pdfFile.name}
                </p>
              )}
              {error && <p className="error">{error}</p>}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!pdfFile || submitting}
                  onClick={handleUploadPdf}
                >
                  {submitting ? 'Uploading…' : isReplace ? 'Replace PDF' : 'Upload PDF'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={submitting}
                  onClick={onClose}
                >
                  Cancel
                </button>
              </div>
            </>
          )}

          {mode === 'images' && (
            <>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={submitting}
                onClick={() => chooseMode(null)}
                style={{ alignSelf: 'flex-start' }}
              >
                ← Back
              </button>
              <p className="muted" style={{ margin: 0 }}>
                {pages.length} / {MAX_IMAGES} images — then create &amp; upload PDF
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
                        style={{
                          width: '100%',
                          height: 110,
                          objectFit: 'cover',
                          display: 'block',
                        }}
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
                ref={imageInputRef}
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
                  onClick={() => imageInputRef.current?.click()}
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
                      ? 'Create & Replace PDF'
                      : 'Create & Upload PDF'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={submitting}
                  onClick={onClose}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
