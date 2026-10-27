import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authApi } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('campusswap_user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [token, setToken] = useState(() => localStorage.getItem('campusswap_token'));
  const [loading, setLoading] = useState(true);

  // Re-validate token against /auth/me on mount
  useEffect(() => {
    const stored = localStorage.getItem('campusswap_token');
    if (!stored) {
      setLoading(false);
      return;
    }
    authApi.me()
      .then((res) => {
        const freshUser = res.data.data;
        setUser(freshUser);
        localStorage.setItem('campusswap_user', JSON.stringify(freshUser));
      })
      .catch(() => {
        localStorage.removeItem('campusswap_token');
        localStorage.removeItem('campusswap_user');
        setUser(null);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await authApi.login({ email, password });
    const { token: newToken, user: newUser } = res.data.data;
    localStorage.setItem('campusswap_token', newToken);
    localStorage.setItem('campusswap_user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
    return newUser;
  }, []);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* stateless, ignore */ }
    localStorage.removeItem('campusswap_token');
    localStorage.removeItem('campusswap_user');
    setToken(null);
    setUser(null);
  }, []);

  const isAuthenticated = !!token && !!user;
  const isAdmin = user?.role === 'ADMIN';

  return (
    <AuthContext.Provider value={{ user, token, loading, isAuthenticated, isAdmin, login, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
