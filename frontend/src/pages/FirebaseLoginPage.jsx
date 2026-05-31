import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FirebaseUser } from '../db/firebase-db.js';

const LOGIN_TIMEOUT = 15000; // 15 seconds

function withTimeout(promise, timeoutMs = LOGIN_TIMEOUT) {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Login is taking too long. Please check your connection and try again.')), timeoutMs)
    )
  ]);
}

export default function FirebaseLoginPage() {
  const navigate = useNavigate();
  const [loginInput, setLoginInput] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSetPasswordField, setShowSetPasswordField] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [setPasswordFor, setSetPasswordFor] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSetPassword(e) {
    e.preventDefault();
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      await withTimeout(FirebaseUser.updatePassword(setPasswordFor.id, newPassword));
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
      console.log('Login attempt:', inputVal);
      // Try email and UTR in parallel with timeout
      const [userByEmail, userByUtr] = await withTimeout(
        Promise.all([
          FirebaseUser.findByEmail(inputVal.toLowerCase()).catch(() => null),
          inputVal.length >= 10 ? FirebaseUser.findByUtr(inputVal).catch(() => null) : Promise.resolve(null),
        ]),
        LOGIN_TIMEOUT
      );
      
      const user = userByEmail || userByUtr;
      console.log('User found:', user?.email || user?.utr_number);
      
      if (!user) {
        setError('No account found with this email or UTR. Please register first.');
        setLoading(false);
        return;
      }

      // Admin approval check (new field — existing users without it are treated as approved)
      const adminApproval = user.admin_approval_status;
      if (adminApproval === 'PENDING') {
        setError('Your account is waiting for admin approval');
        setLoading(false);
        return;
      }
      if (adminApproval === 'REJECTED') {
        setError('Your account has been rejected by admin');
        setLoading(false);
        return;
      }

      // Check account is active (first payment approved and account activated)
      const isActive = user.account_status === 'active';
      if (!isActive) {
        if (user.account_status === 'inactive' && (user.inactive_reason === 'own_topup_completed' || user.sponsor_awaiting_credit)) {
          setError('Your account is inactive (own topup completed). Please contact admin for reactivation.');
        } else if (user.account_status === 'inactive') {
          setError('Your account is inactive. Please contact admin.');
        } else {
          setError('Your account is pending approval. Please wait for admin to approve your payment.');
        }
        setLoading(false);
        return;
      }

      // If no password, allow to set one
      if (!user.password) {
        setSetPasswordFor(user);
        setShowSetPasswordField(true);
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
      <div className="card auth-card">
        <h1>Login</h1>
        
        {showSetPasswordField && setPasswordFor ? (
          <div className="alert alert-success">
            <strong>Your account is approved!</strong><br/>
            Set a password to login.
            <form onSubmit={handleSetPassword} className="mt-md">
              <div className="field">
                <label>New Password</label>
                <div className="password-field-wrap">
                  <input type={showPassword ? 'text' : 'password'} value={newPassword} minLength={6} 
                    onChange={e => setNewPassword(e.target.value)} required className="w-full" style={{ paddingRight: '2.5rem' }} />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="password-toggle-btn"
                  >
                    {showPassword ? '👁' : '👁️'}
                  </button>
                </div>
              </div>
              <button type="submit" className={`btn btn-primary${loading ? ' btn-loading' : ''} w-full`} disabled={loading}>
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
            <div className="password-field-wrap">
              <input required type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} className="w-full" style={{ paddingRight: '2.5rem' }} />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="password-toggle-btn"
              >
                {showPassword ? '👁' : '👁️'}
              </button>
            </div>
          </div>
          <button className={`btn btn-primary${loading ? ' btn-loading' : ''} w-full`} type="submit" disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
        
        <p className="muted mt-md">
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
