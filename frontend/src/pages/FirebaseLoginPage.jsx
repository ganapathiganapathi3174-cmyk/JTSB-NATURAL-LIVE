import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FirebaseUser, comparePassword } from '../db/firebase-db.js';
import { checkRateLimit } from '../utils/rateLimiter.js';

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
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0);

  useEffect(() => {
    if (rateLimitCountdown <= 0) return;
    const id = setInterval(() => {
      setRateLimitCountdown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [rateLimitCountdown]);

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
      localStorage.setItem('fb_login_at', String(Date.now()));
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
    const rl = checkRateLimit('login:' + loginInput.toLowerCase());
    if (!rl.allowed) {
      setError(`Too many attempts. Try again in ${rl.retryAfter} seconds.`);
      setRateLimitCountdown(rl.retryAfter);
      return;
    }
    setLoading(true);

    const inputVal = loginInput.trim();
    const passVal = password;

    try {
      console.log('Login attempt:', inputVal);
      // Find user by email
      const user = await withTimeout(
        FirebaseUser.findByEmail(inputVal.toLowerCase()),
        LOGIN_TIMEOUT
      ).catch(() => null);
      
      if (!user) {
        setError('No account found with this email. Please register first.');
        setLoading(false);
        return;
      }

      const canLogin = user.membershipPaid === true || user.payment_status === 'approved' || user.payment_status === 'success';

      if (user.account_status === 'blocked') {
        setError('Your account has been blocked. Please contact admin.');
        setLoading(false);
        return;
      }

      if (user.account_status === 'suspended') {
        setError('Your account has been suspended. Please contact admin.');
        setLoading(false);
        return;
      }

      if (!canLogin) {
        if (user.account_status === 'inactive' && (user.inactive_reason === 'own_topup_completed' || user.sponsor_awaiting_credit || user.sponsorRenewalRequired)) {
          setError('Your account requires sponsor renewal. Please complete a topup and contact admin for reactivation.');
        } else if (user.reviewRequired) {
          setError('Your account is under review. An administrator will review your account shortly.');
        } else if (user.inactiveReason) {
          setError('Account inactive: ' + user.inactiveReason);
        } else {
          setError('Your payment is being processed. Please try logging in again in a few moments.');
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
      const pwMatch = await comparePassword(passVal, user.password);
      if (!pwMatch) {
        setError('Invalid password. Please try again.');
        setLoading(false);
        return;
      }

      // Login success
      localStorage.setItem('fb_user_id', user.id);
      localStorage.setItem('fb_login_at', String(Date.now()));
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
        
        {error && <div className="alert alert-error">{error}{rateLimitCountdown > 0 && ` (retry in ${rateLimitCountdown}s)`}</div>}
        
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Email</label>
            <input required value={loginInput} onChange={e => setLoginInput(e.target.value)} placeholder="Enter your email" />
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
