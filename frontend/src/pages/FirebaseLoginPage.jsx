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
    <div className="page-wrap" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div className="text-center mb-lg animate-fade-in-up">
        <div className="brand" style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>
          <span className="text-gradient">JTSB Natural</span>
        </div>
        <p className="text-muted text-sm" style={{ margin: 0 }}>Premium FinTech Platform</p>
      </div>

      <div className="card-glass animate-fade-in-up stagger-1" style={{ width: '100%', maxWidth: 420, padding: '2rem' }}>
        <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.5rem', letterSpacing: '-0.03em' }} className="text-gradient">Welcome Back</h1>
        <p className="text-muted text-sm mb-lg" style={{ margin: '0 0 1.5rem' }}>Sign in to your account</p>

        {showSetPasswordField && setPasswordFor ? (
          <div className="card-dim mb-md" style={{ background: 'var(--success-light)', border: '1px solid rgba(34,197,94,0.2)' }}>
            <p style={{ fontSize: '0.85rem', margin: '0 0 0.75rem', color: '#16A34A', fontWeight: 600 }}>
              Your account is approved! Set a password to login.
            </p>
            <form onSubmit={handleSetPassword}>
              <div className="field-glass mb-md">
                <input type={showPassword ? 'text' : 'password'} value={newPassword} minLength={6}
                  onChange={e => setNewPassword(e.target.value)} required placeholder="New Password" />
              </div>
              <button type="submit" className={`btn btn-primary${loading ? ' btn-loading' : ''} w-full`} disabled={loading}>
                {loading ? 'Setting...' : 'Set Password & Login'}
              </button>
            </form>
          </div>
        ) : (
          <>
            {error && (
              <div className="card-dim mb-md" style={{ background: 'var(--danger-light)', border: '1px solid rgba(239,68,68,0.2)', padding: '0.75rem 1rem', fontSize: '0.85rem', color: 'var(--danger)' }}>
                {error}{rateLimitCountdown > 0 && ` (retry in ${rateLimitCountdown}s)`}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="field-glass mb-md">
                <input required value={loginInput} onChange={e => setLoginInput(e.target.value)} placeholder="Enter your email" />
              </div>
              <div className="field-glass mb-lg" style={{ position: 'relative' }}>
                <input required type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Password" style={{ paddingRight: '2.5rem' }} />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  style={{ position: 'absolute', right: '0.65rem', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--muted)', padding: '0.25rem', lineHeight: 1 }}>
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
              <button className={`btn btn-primary${loading ? ' btn-loading' : ''} w-full`} type="submit" disabled={loading}>
                {loading ? 'Logging in...' : 'Sign In'}
              </button>
            </form>

            <div className="section-divider mt-lg">or</div>

            <div className="flex flex-col items-center gap-sm mt-md">
              <span className="text-muted text-sm">
                New user? <Link to="/fb/register" style={{ fontWeight: 600 }}>Create Account</Link>
              </span>
              <span className="text-muted text-sm">
                Admin? <Link to="/fb-admin" style={{ fontWeight: 600 }}>Admin Login</Link>
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
