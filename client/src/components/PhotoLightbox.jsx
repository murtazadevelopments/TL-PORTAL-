import { useDocumentOverlay } from '../hooks/useDocumentOverlay';
import './PhotoLightbox.css';

export default function PhotoLightbox({ open, src, alt = '', onClose }) {
  const { requestClose } = useDocumentOverlay(Boolean(open && src), onClose);

  if (!open || !src) return null;

  return (
    <div
      className="photo-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Profile picture"
      onClick={requestClose}
    >
      <button
        type="button"
        className="photo-lightbox-close"
        onClick={(e) => {
          e.stopPropagation();
          requestClose();
        }}
        aria-label="Close"
      >
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
