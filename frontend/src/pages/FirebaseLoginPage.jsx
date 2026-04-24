import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FirebaseUser } from '../db/firebase-db.js';

export default function FirebaseLoginPage() {
  const navigate = useNavigate();
  const [loginInput, setLoginInput] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSetPassword, setShowSetPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [setPasswordFor, setSetPasswordFor] = useState(null);

  async function handleSetPassword(e) {
    e.preventDefault();
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      await FirebaseUser.updatePassword(setPasswordFor.id, newPassword);
      // Login after setting password
      localStorage.setItem('fb_user_id', setPasswordFor.id);
      navigate('/fb/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const inputVal = loginInput.trim();
    const passVal = password;

    try {
      // Try to find user by email or UTR
      let user = await FirebaseUser.findByEmail(inputVal.toLowerCase());
      
      // If not found by email, try UTR
      if (!user) {
        user = await FirebaseUser.findByUtr(inputVal);
      }
      
      if (!user) {
        setError('No account found with this email or UTR. Please register first.');
        setLoading(false);
        return;
      }

      // Check approval status first
      const isApproved = user.status === 'approved' || user.payment_status === 'approved';
      if (!isApproved) {
        setError('Your account is pending approval. Please wait for admin to approve.');
        setLoading(false);
        return;
      }

      // If no password, allow to set one
      if (!user.password) {
        setSetPasswordFor(user);
        setShowSetPassword(true);
        setLoading(false);
        return;
      }

      // Check password
      if (user.password !== passVal) {
        setError('Invalid password. Please try again.');
        setLoading(false);
        return;
      }

      // Login success
      localStorage.setItem('fb_user_id', user.id);
      navigate('/fb/dashboard');
      
    } catch (err) {
      console.error('Login error:', err);
      setError('Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">Starlight Ascent</div>
      </div>
      <div className="card" style={{ maxWidth: 440, margin: '2rem auto' }}>
        <h1>Login</h1>
        
        {showSetPassword && setPasswordFor ? (
          <div className="alert alert-success">
            <strong>Your account is approved!</strong><br/>
            Set a password to login.
            <form onSubmit={handleSetPassword} style={{ marginTop: '1rem' }}>
              <div className="field">
                <label>New Password</label>
                <input type="password" value={newPassword} minLength={6} 
                  onChange={e => setNewPassword(e.target.value)} required />
              </div>
              <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%' }}>
                {loading ? 'Setting...' : 'Set Password & Login'}
              </button>
            </form>
          </div>
        ) : (
          <>
        <p className="muted">Login with email and password</p>
        
        {error && <div className="alert alert-error">{error}</div>}
        
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Email or UTR Number</label>
            <input required value={loginInput} onChange={e => setLoginInput(e.target.value)} placeholder="Enter email or UTR number" />
          </div>
          <div className="field">
            <label>Password</label>
            <input required type="password" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
        
        <p className="muted" style={{ marginTop: '1rem' }}>
          New user? <Link to="/fb/register">Register here</Link>
        </p>
        <p className="muted">
          Admin? <Link to="/fb-admin">Admin login</Link>
        </p>
        </>
        )}
      </div>
    </div>
  );
}
