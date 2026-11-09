import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../api/client';

const AuthUserContext = createContext(null);

export function AuthUserProvider({ children }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshInflight = useRef(null);
  const refreshUser = useCallback(async () => {
    if (refreshInflight.current) return refreshInflight.current;
    setError('');
    const run = (async () => {
      try {
        const { data } = await api.get('/api/users/me');
        setUser(data);
        setPermissions(Array.isArray(data.permissions) ? data.permissions : []);
        return data;
      } catch (err) {
        const code = err.response?.data?.code;
        if (
          err.response?.status === 401 ||
          (err.response?.status === 403 &&
            (code === 'ACCOUNT_BLOCKED' ||
              code === 'ACCOUNT_DEACTIVATED' ||
              code === 'ACCOUNT_LOCKED' ||
              code === 'ACCOUNT_RESIGNED'))
        ) {
          localStorage.removeItem('token');
          navigate('/', { replace: true });
          return null;
        }
        setError(err.response?.data?.message || 'Failed to load account.');
        return null;
      } finally {
        refreshInflight.current = null;
      }
    })();
    refreshInflight.current = run;
    return run;
  }, [navigate]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const data = await refreshUser();
      if (!active) return;
      if (!data) {
        setLoading(false);
        return;
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [refreshUser]);

  /**
   * @param {{ clearPush?: boolean }} [options]
   * clearPush: only for explicit user Logout — never for inactivity / 401 / expiry.
   */
  const logout = useCallback((options = {}) => {
    const clearPush = options.clearPush === true;
    void (async () => {
      if (clearPush) {
        try {
          const { clearDevicePushSubscription } = await import('../utils/pushNotifications');
          // DELETE runs before token clear; short timeout; never blocks logout.
          await clearDevicePushSubscription({ timeoutMs: 2500 });
        } catch {
          /* ignore */
        }
      }
      localStorage.removeItem('token');
      setUser(null);
      setPermissions([]);
      navigate('/', { replace: true });
    })();
  }, [navigate]);

  const value = useMemo(
    () => ({
      user,
      setUser,
      permissions,
      loading,
      error,
      refreshUser,
      logout,
      role: user?.role ?? null,
    }),
    [user, permissions, loading, error, refreshUser, logout]
  );

  return <AuthUserContext.Provider value={value}>{children}</AuthUserContext.Provider>;
}

export function useAuthUser() {
  const ctx = useContext(AuthUserContext);
  if (!ctx) {
    throw new Error('useAuthUser must be used within AuthUserProvider');
  }
  return ctx;
}
