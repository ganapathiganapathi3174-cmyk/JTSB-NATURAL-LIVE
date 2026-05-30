import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const ADMIN_KEY = 'fb_admin_token';
const ADMIN_EMAIL = 'jayaraj@gmail.com';
const ADMIN_PASSWORD = 'jayaraj7523';

export default function FirebaseAdminLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Simple admin auth (in production, use Firebase Auth with custom claims)
      if (email.toLowerCase() !== ADMIN_EMAIL) {
        throw new Error('Invalid credentials');
      }
      if (password !== ADMIN_PASSWORD) {
        throw new Error('Invalid credentials');
      }

      // Set admin token
      localStorage.setItem(ADMIN_KEY, 'admin-logged-in');
      navigate('/fb-admin/dashboard');
    } catch (err) {
      setError(err.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">Admin Login</div>
      </div>
      <div className="card" style={{ maxWidth: 400, margin: '2rem auto' }}>
        <h1>Admin Login</h1>
        <p className="muted">Restricted access</p>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Email</label>
            <input 
              required 
              type="email" 
              value={email}
              onChange={e => setEmail(e.target.value)} 
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input 
              required 
              type="password" 
              value={password}
              onChange={e => setPassword(e.target.value)} 
            />
          </div>
          <button className={`btn btn-primary${loading ? ' btn-loading' : ''}`} type="submit" disabled={loading}>
            {loading ? 'Logging in...' : 'Log In'}
          </button>
        </form>
        <p className="muted" style={{ marginTop: '1rem' }}>
          <a href="/fb/login">User Login</a>
        </p>
      </div>
    </div>
  );
}