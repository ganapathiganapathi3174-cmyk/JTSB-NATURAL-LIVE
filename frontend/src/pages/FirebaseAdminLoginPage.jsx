import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase/config.js';

const ADMIN_KEY = 'fb_admin_token';
const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || '';

export default function FirebaseAdminLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setWarning('');
    setLoading(true);

    try {
      // Simple admin auth (in production, use Firebase Auth with custom claims)
      if (email.toLowerCase() !== ADMIN_EMAIL) {
        throw new Error('Invalid credentials');
      }
      if (password !== ADMIN_PASSWORD) {
        throw new Error('Invalid credentials');
      }

      // Sign in with Firebase Auth so admin operations (delete, write) work
      try {
        // Try creating first (auto-creates if user doesn't exist in Firebase Auth)
        await signInWithEmailAndPassword(auth, email, password);
      } catch (fbErr) {
        if (fbErr.code === 'auth/user-not-found') {
          try {
            await createUserWithEmailAndPassword(auth, email, password);
          } catch (createErr) {
            console.warn('[ADMIN LOGIN] Firebase Auth creation failed:', createErr.code, createErr.message);
            setWarning(
              'Failed to create Firebase Auth user. Admin delete/write operations may not work. ' +
              'Please ensure Email/Password auth is enabled in Firebase Console → Authentication.'
            );
          }
        } else {
          console.warn('[ADMIN LOGIN] Firebase Auth sign-in failed:', fbErr.code, fbErr.message);
          setWarning(
            'Firebase Auth sign-in failed. Admin delete/write operations may not work. ' +
            'Please ensure this admin user exists in Firebase Console → Authentication.'
          );
        }
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
      <div className="auth-card">
        <div className="card">
          <h1>Admin Login</h1>
        <p className="muted">Restricted access</p>
        {error && <div className="alert alert-error">{error}</div>}
        {warning && <div className="alert alert-error" style={{ fontSize: '0.85rem', opacity: 0.85 }}>{warning}</div>}
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
          <button className={`btn btn-primary w-full${loading ? ' btn-loading' : ''}`} type="submit" disabled={loading}>
            {loading ? 'Logging in...' : 'Log In'}
          </button>
        </form>
        <p className="muted mt-md">
          <a href="/fb/login">User Login</a>
        </p>
      </div>
    </div>
  </div>
  );
}