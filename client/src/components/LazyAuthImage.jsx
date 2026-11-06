import { useEffect, useRef, useState } from 'react';
import { withAuthDocumentUrl } from '../utils/documentUrls';

const MAX_IN_FLIGHT = 4;
let inFlight = 0;
const waiters = [];

function acquireSlot() {
  return new Promise((resolve) => {
    const start = () => {
      inFlight += 1;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        inFlight -= 1;
        const next = waiters.shift();
        if (next) next();
      });
    };
    if (inFlight < MAX_IN_FLIGHT) start();
    else waiters.push(start);
  });
}

/**
 * Thumb that waits until it is near the viewport, then loads with at most
 * 4 document requests in flight.
 */
export default function LazyAuthImage({ url, cacheKey, className, alt = '' }) {
  const ref = useRef(null);
  const releaseRef = useRef(null);
  const [src, setSrc] = useState(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !url) return undefined;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        acquireSlot().then((release) => {
          if (cancelled) {
            release();
            return;
          }
          releaseRef.current = release;
          setSrc(withAuthDocumentUrl(url, cacheKey));
        });
      },
      { rootMargin: '120px' }
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
      releaseRef.current?.();
      releaseRef.current = null;
    };
  }, [url, cacheKey]);

  function finish() {
    releaseRef.current?.();
    releaseRef.current = null;
  }

  return (
    <img
      ref={ref}
      className={className}
      alt={alt}
      src={src || undefined}
      onLoad={finish}
      onError={finish}
    />
  );
}
