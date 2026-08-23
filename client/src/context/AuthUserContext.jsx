import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import api from '../api/client';

const AuthUserContext = createContext(null);

export function AuthUserProvider({ children }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshUser = useCallback(async () => {
    setError('');
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
            code === 'ACCOUNT_LOCKED'))
      ) {
        localStorage.removeItem('token');
        navigate('/', { replace: true });
        return null;
      }
      setError(err.response?.data?.message || 'Failed to load account.');
      return null;
    }
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

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    setUser(null);
    setPermissions([]);
    navigate('/', { replace: true });
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
