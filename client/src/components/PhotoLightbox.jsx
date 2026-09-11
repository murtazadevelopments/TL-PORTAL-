import { useEffect } from 'react';
import './PhotoLightbox.css';

export default function PhotoLightbox({ open, src, alt = '', onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !src) return null;

  return (
    <div
      className="photo-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Profile picture"
      onClick={onClose}
    >
      <button type="button" className="photo-lightbox-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <img
        src={src}
        alt={alt}
        className="photo-lightbox-img"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
