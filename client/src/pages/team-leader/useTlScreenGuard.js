import { useEffect } from 'react';

/**
 * Cross-device screen-capture deterrence for Team Leader Dashboard
 * (Mac, Windows, Android, iOS browsers).
 *
 * Note: hardware OS screenshots cannot be fully blocked by any website.
 */
export function useTlScreenGuard({ enabled = true } = {}) {
  useEffect(() => {
    if (!enabled) return undefined;

    const root = document.documentElement;
    const body = document.body;
    root.classList.add('tl-no-capture');
    body?.classList.add('tl-no-capture-body');

    function blockCaptureKeys(e) {
      const key = String(e.key || '');
      const code = String(e.code || '');
      const lower = key.toLowerCase();

      // Windows / Linux Print Screen
      if (key === 'PrintScreen' || code === 'PrintScreen' || code === 'F13') {
        e.preventDefault();
        e.stopPropagation();
        try {
          void navigator.clipboard.writeText('');
        } catch {
          /* ignore */
        }
        return;
      }

      // macOS Cmd+Shift+3/4/5 and Windows-style in-browser combos
      if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
        if (['3', '4', '5', 's', 'S', 'g', 'G', 'a', 'A'].includes(key)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }

      if ((e.metaKey || e.ctrlKey) && lower === 'p') {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    function blockContextMenu(e) {
      if (e.target?.closest?.('input, textarea, button')) return;
      e.preventDefault();
      e.stopPropagation();
    }

    function blockSelect(e) {
      if (e.target?.closest?.('input, textarea')) return;
      e.preventDefault();
    }

    function blockCopyCut(e) {
      if (e.target?.closest?.('input, textarea')) return;
      e.preventDefault();
      try {
        e.clipboardData?.setData('text/plain', '');
      } catch {
        /* ignore */
      }
    }

    function blockDrag(e) {
      if (e.target?.closest?.('input, textarea')) return;
      e.preventDefault();
    }

    window.addEventListener('keydown', blockCaptureKeys, true);
    window.addEventListener('keyup', blockCaptureKeys, true);
    document.addEventListener('contextmenu', blockContextMenu, true);
    document.addEventListener('selectstart', blockSelect, true);
    document.addEventListener('copy', blockCopyCut, true);
    document.addEventListener('cut', blockCopyCut, true);
    document.addEventListener('dragstart', blockDrag, true);

    return () => {
      root.classList.remove('tl-no-capture', 'tl-capture-blur');
      body?.classList.remove('tl-no-capture-body');
      window.removeEventListener('keydown', blockCaptureKeys, true);
      window.removeEventListener('keyup', blockCaptureKeys, true);
      document.removeEventListener('contextmenu', blockContextMenu, true);
      document.removeEventListener('selectstart', blockSelect, true);
      document.removeEventListener('copy', blockCopyCut, true);
      document.removeEventListener('cut', blockCopyCut, true);
      document.removeEventListener('dragstart', blockDrag, true);
    };
  }, [enabled]);
}
