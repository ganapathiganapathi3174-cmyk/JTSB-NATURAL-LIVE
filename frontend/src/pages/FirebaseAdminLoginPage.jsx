import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { checkRateLimit } from '../utils/rateLimiter.js';

const ADMIN_KEY = 'fb_admin_token';

export default function FirebaseAdminLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const rl = checkRateLimit('adminLogin:' + email.trim().toLowerCase());
    if (!rl.allowed) {
      setError(`Too many attempts. Try again in ${rl.retryAfter} seconds.`);
      return;
    }
    setLoading(true);

    try {
      const API_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';
      const res = await fetch(`${API_BASE}/adminLogin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid credentials');
      const now = Date.now();
      localStorage.setItem(ADMIN_KEY, data.token);
      localStorage.setItem('fb_admin_login_at', String(now));
      if (data.admin) {
        localStorage.setItem('fb_admin_name', data.admin.name || 'Admin');
        localStorage.setItem('fb_admin_email', data.admin.email || '');
        sessionStorage.setItem('fb_admin_name', data.admin.name || 'Admin');
        sessionStorage.setItem('fb_admin_email', data.admin.email || '');
      }
      navigate('/fb-admin/dashboard');
    } catch (err) {
      setError(err.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-center" style={{ minHeight: '100vh' }}>
      <div className="glass-card" style={{ maxWidth: 400, width: '100%' }}>
        <div className="text-center mb-md">
          <h1 className="text-xl font-bold mb-xs">StarlightAscent</h1>
          <p className="text-muted text-sm">Admin Login</p>
        </div>
        {error && <div className="alert-error mb-md">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field mb-md">
            <label>Email</label>
            <input
              required
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>
          <div className="field mb-lg">
            <label>Password</label>
            <input
              required
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>
          <div className="flex flex-center">
            <button className={`btn-primary${loading ? ' btn-loading' : ''}`} type="submit" disabled={loading}>
              {loading ? 'Logging in...' : 'Log In'}
            </button>
          </div>
        </form>
        <p className="text-muted text-sm mt-lg text-center">
          <a href="/fb/login" className="font-semibold">User Login</a>
        </p>
      </div>
    </div>
  );
}
