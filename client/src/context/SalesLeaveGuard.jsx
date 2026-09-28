import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

function isSalesBoardPath(pathname) {
  return pathname === '/sales-targets' || pathname.startsWith('/sales-targets/');
}

function samePageHref(href) {
  if (!href) return true;
  try {
    const next = new URL(href, window.location.origin);
    return (
      next.origin === window.location.origin &&
      next.pathname === window.location.pathname &&
      next.search === window.location.search
    );
  } catch {
    return false;
  }
}

function isSalesBoardHref(href) {
  try {
    const next = new URL(href, window.location.origin);
    return isSalesBoardPath(window.location.pathname) && isSalesBoardPath(next.pathname);
  } catch {
    return false;
  }
}

function pushGuardHistory() {
  const prev = window.history.state;
  const idx = typeof prev?.idx === 'number' ? prev.idx + 1 : 1;
  window.history.pushState(
    {
      ...(prev && typeof prev === 'object' ? prev : {}),
      idx,
      salesPinGuard: true,
    },
    ''
  );
}

const SalesLeaveGuardContext = createContext({
  blocked: false,
  tryLeave: () => true,
  register: () => () => {},
  release: () => {},
});

export function SalesLeaveGuardProvider({ children }) {
  const handlerRef = useRef(null);
  const popCleanupRef = useRef(null);
  const [blocked, setBlocked] = useState(false);

  const disarmHistory = useCallback(() => {
    popCleanupRef.current?.();
    popCleanupRef.current = null;
  }, []);

  const armHistory = useCallback(() => {
    disarmHistory();
    if (!window.history.state?.salesPinGuard) {
      pushGuardHistory();
    }
    const onPop = () => {
      if (!handlerRef.current) return;
      if (!window.history.state?.salesPinGuard) {
        pushGuardHistory();
      }
      handlerRef.current({ type: 'back' });
    };
    window.addEventListener('popstate', onPop);
    popCleanupRef.current = () => window.removeEventListener('popstate', onPop);
  }, [disarmHistory]);

  const release = useCallback(() => {
    handlerRef.current = null;
    disarmHistory();
    setBlocked(false);
  }, [disarmHistory]);

  const register = useCallback(
    (handler) => {
      handlerRef.current = handler;
      setBlocked(true);
      armHistory();
      return () => {
        if (handlerRef.current === handler) {
          handlerRef.current = null;
          disarmHistory();
          setBlocked(false);
        }
      };
    },
    [armHistory, disarmHistory]
  );

  const tryLeave = useCallback((action) => {
    if (!handlerRef.current) return true;
    if (action?.type === 'href' && (samePageHref(action.href) || isSalesBoardHref(action.href))) return true;
    handlerRef.current(action);
    return false;
  }, []);

  return (
    <SalesLeaveGuardContext.Provider value={{ blocked, tryLeave, register, release }}>
      {children}
    </SalesLeaveGuardContext.Provider>
  );
}

export function useSalesLeaveGuard() {
  return useContext(SalesLeaveGuardContext);
}

export function useRegisterSalesLeaveLock(active, onLeave) {
  const { register, release } = useSalesLeaveGuard();
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;

  useEffect(() => {
    if (!active) return undefined;
    return register((action) => onLeaveRef.current(action));
  }, [active, register]);

  return { release };
}
