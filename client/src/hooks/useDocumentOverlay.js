import { useCallback, useEffect, useRef } from 'react';

/**
 * Full-screen document overlay: lock scroll, close on Escape, and make Back
 * close the overlay instead of leaving a blank page.
 *
 * Extra history uses the same URL and React Router's idx so the route stays put.
 */
export function useDocumentOverlay(open, onClose) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const pushedRef = useRef(false);

  const requestClose = useCallback(() => {
    if (pushedRef.current && window.history.state?.tlDocOverlay) {
      pushedRef.current = false;
      window.history.back();
      return;
    }
    onCloseRef.current?.();
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const prevState = window.history.state;
    if (!prevState?.tlDocOverlay) {
      const idx = typeof prevState?.idx === 'number' ? prevState.idx + 1 : 1;
      window.history.pushState(
        {
          ...(prevState && typeof prevState === 'object' ? prevState : {}),
          idx,
          tlDocOverlay: true,
        },
        ''
      );
      pushedRef.current = true;
    }

    function onPop() {
      pushedRef.current = false;
      onCloseRef.current?.();
    }

    function onKey(e) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      requestClose();
    }

    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (pushedRef.current && window.history.state?.tlDocOverlay) {
        pushedRef.current = false;
        window.history.back();
      }
    };
  }, [open, requestClose]);

  return { requestClose };
}
