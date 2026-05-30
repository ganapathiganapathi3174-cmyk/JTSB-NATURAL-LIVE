import { createContext, useContext, useState, useMemo, useEffect } from 'react';
import { userApi, setClientUserToken, setClientUser } from '../api/client.js';

const TOKEN_KEY = 'jtsb_token';
const USER_KEY = 'jtsb_user';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(() => {
    try {
      const u = localStorage.getItem(USER_KEY);
      return u ? JSON.parse(u) : null;
    } catch { return null; }
  });

  // When token changes: persist + attach to API client
  useEffect(() => {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
      setClientUserToken(userApi, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      setClientUserToken(userApi, null);
    }
  }, [token]);

  // When user changes: persist + attach to API client
  useEffect(() => {
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      setClientUser(userApi, user);
    } else {
      localStorage.removeItem(USER_KEY);
      setClientUser(userApi, null);
    }
  }, [user]);

  const logout = () => { setToken(null); setUser(null); };

  const value = useMemo(() => ({
    token, user, setToken, setUser, logout,
    isAuthenticated: !!token && !!user,
  }), [token, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
