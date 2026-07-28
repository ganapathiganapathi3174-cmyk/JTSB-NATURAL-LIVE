import { createContext, useContext, useState, useMemo } from 'react';
const TOKEN_KEY = 'jsreeapex_token';

const USER_KEY = 'jsreeapex_user';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(() => {
    try {
      const u = localStorage.getItem(USER_KEY);
      return u ? JSON.parse(u) : null;
    } catch { return null; }
  });

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
