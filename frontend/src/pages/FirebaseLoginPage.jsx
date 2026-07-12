import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FirebaseUser, comparePassword } from '../db/firebase-db.js';
import { checkRateLimit } from '../utils/rateLimiter.js';

const LOGIN_TIMEOUT = 15000;

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

      if (!user.password) {
        setSetPasswordFor(user);
        setShowSetPasswordField(true);
        setLoading(false);
        return;
      }

      const pwMatch = await comparePassword(passVal, user.password);
      if (!pwMatch) {
        setError('Invalid password. Please try again.');
        setLoading(false);
        return;
      }

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
    <div className="flex flex-center" style={{ minHeight: '100vh' }}>
      <div className="glass-card" style={{ maxWidth: 420, width: '100%' }}>
        <div className="text-center mb-lg">
          <div className="text-xl font-bold mb-xs">
            <span className="text-gradient">StarlightAscent</span>
          </div>
          <p className="text-muted text-sm">Premium FinTech Platform</p>
        </div>

        <h2 className="text-xl font-bold mb-xs">Welcome Back</h2>
        <p className="text-muted text-sm mb-md">Sign in to your account</p>

        {showSetPasswordField && setPasswordFor ? (
          <div className="card-dim mb-md">
            <p className="text-sm font-semibold mb-sm" style={{ color: 'var(--success)' }}>
              Your account is approved! Set a password to login.
            </p>
            <form onSubmit={handleSetPassword}>
              <div className="field-glass mb-md">
                <input type={showPassword ? 'text' : 'password'} value={newPassword} minLength={6}
                  onChange={e => setNewPassword(e.target.value)} required placeholder="New Password" />
              </div>
              <button type="submit" className={`btn-primary btn-lg${loading ? ' btn-loading' : ''} w-full`} disabled={loading}>
                {loading ? 'Setting...' : 'Set Password & Login'}
              </button>
            </form>
          </div>
        ) : (
          <>
            {error && (
              <div className="alert-error mb-md">
                {error}{rateLimitCountdown > 0 && ` (retry in ${rateLimitCountdown}s)`}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="field-glass mb-md">
                <input required value={loginInput} onChange={e => setLoginInput(e.target.value)} placeholder="Enter your email" />
              </div>
              <div className="field-glass mb-lg">
                <div className="flex items-center gap-xs" style={{ position: 'relative' }}>
                  <input required type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="Password" className="flex-1" style={{ paddingRight: '2.5rem' }} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="btn-ghost btn-icon" style={{ position: 'absolute', right: '0.5rem' }}>
                    {showPassword ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>
              <button className={`btn-primary btn-lg${loading ? ' btn-loading' : ''} w-full`} type="submit" disabled={loading}>
                {loading ? 'Logging in...' : 'Sign In'}
              </button>
            </form>

            <div className="text-muted text-sm text-center mt-lg">or</div>

            <div className="flex flex-col items-center gap-sm mt-md">
              <span className="text-muted text-sm">
                New user? <Link to="/fb/register" className="font-semibold">Create Account</Link>
              </span>
              <span className="text-muted text-sm">
                Admin? <Link to="/fb-admin" className="font-semibold">Admin Login</Link>
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
