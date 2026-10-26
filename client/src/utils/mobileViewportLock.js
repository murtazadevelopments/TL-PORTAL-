/** Block pinch / double-gesture zoom on phones. Vertical scroll still works. */
export function installMobileViewportLock() {
  if (typeof document === 'undefined' || document.documentElement.dataset.noZoom === '1') {
    return;
  }
  document.documentElement.dataset.noZoom = '1';

  const stop = (event) => {
    event.preventDefault();
  };

  document.addEventListener('gesturestart', stop, { passive: false });
  document.addEventListener('gesturechange', stop, { passive: false });
  document.addEventListener('gestureend', stop, { passive: false });
  document.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches && event.touches.length > 1) event.preventDefault();
    },
    { passive: false }
  );
}
