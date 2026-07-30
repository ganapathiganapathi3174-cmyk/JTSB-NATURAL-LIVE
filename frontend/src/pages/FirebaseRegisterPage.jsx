import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { checkRateLimit } from '../utils/rateLimiter.js';
import PaymentFlow from '../components/PaymentFlow.jsx';

const API_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';

export default function FirebaseRegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlReferralCode = searchParams.get('ref') || '';

  const [step, setStep] = useState('form');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState(urlReferralCode);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [pendingRegId, setPendingRegId] = useState(null);

  useEffect(() => {
    if (rateLimitCountdown <= 0) return;
    const id = setInterval(() => setRateLimitCountdown(p => Math.max(0, p - 1)), 1000);
    return () => clearInterval(id);
  }, [rateLimitCountdown]);

  const canSubmit = useMemo(() => {
    return name.trim().length > 0 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
      /^[6-9]\d{9}$/.test(phone.trim()) &&
      password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password) &&
      !loading;
  }, [name, email, phone, password, loading]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim() || name.trim().length < 2) { setError('Full name must be at least 2 characters'); return; }
    const ev = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ev)) { setError('Please enter a valid email address'); return; }
    if (!/^[6-9]\d{9}$/.test(phone.trim())) { setError('Please enter a valid 10-digit Indian mobile number'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (!/[A-Z]/.test(password)) { setError('Password must include at least one uppercase letter'); return; }
    if (!/[a-z]/.test(password)) { setError('Password must include at least one lowercase letter'); return; }
    if (!/[0-9]/.test(password)) { setError('Password must include at least one number'); return; }

    const rl = checkRateLimit('payment_submit');
    if (!rl.allowed) { setError(`Too many attempts. Try again in ${rl.retryAfter} seconds.`); setRateLimitCountdown(rl.retryAfter); return; }

    setLoading(true);
    try {
      // Step 1: Create pending registration
      const preResp = await fetch(`${API_BASE}/preRegister`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: ev, phone: phone.trim(), password, referralCode: referralCode.trim() || null }),
      });
      if (!preResp.ok) { const b = await preResp.json().catch(() => ({})); throw new Error(b.error || `Backend error (${preResp.status})`); }
      const session = await preResp.json();

      setPendingRegId(session.pendingRegId);
      setLoading(false);
      setStep('payment');
    } catch (err) {
      const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
      setError(isTimeout ? `Request timed out. ${err.message}` : err.message || 'Registration failed');
      setLoading(false);
    }
  }

  if (step === 'done') {
    return (
      <div className="auth-page animate-fade-in-up">
        <div className="auth-container">
          <div className="auth-card">
            <div className="result-card">
              <div className="result-icon success">✓</div>
              <h2 className="font-bold mb-xs" style={{ fontSize: '1.125rem' }}>Payment Submitted!</h2>
              <p className="text-sm text-muted" style={{ marginBottom: '1.25rem', lineHeight: 1.6 }}>
                Your payment is being verified. You will be able to login once your account is approved.
              </p>
              <Link to="/fb/login" className="btn-primary btn-lg" style={{ display: 'inline-flex' }}>
                Go to Login
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page animate-fade-in-up">
      <div className="auth-container" style={{ maxWidth: 480 }}>
        <div className="auth-card">
          <div className="auth-header">
            <div className="auth-logo">✦</div>
            <h1 className="auth-title">{step === 'form' ? 'Create Account' : 'Complete Payment'}</h1>
            <p className="auth-subtitle">{step === 'form' ? 'One-time payment for lifetime access' : 'Pay via UPI and enter your UTR'}</p>
          </div>

          {step === 'payment' && (
            <div className="payment-step-indicator mb-md">
              <div className="step completed"><span className="step-number">✓</span><span>Form</span></div>
              <div className="step-line completed" />
              <div className="step active"><span className="step-number">2</span><span>Pay</span></div>
              <div className="step-line" />
              <div className="step"><span className="step-number">3</span><span>Done</span></div>
            </div>
          )}

          {error && <div className="alert-error mb-md">{error}{rateLimitCountdown > 0 && ` (retry in ${rateLimitCountdown}s)`}</div>}

          {step === 'form' && (
            <form onSubmit={handleSubmit}>
              <div className="mb-md">
                <input required value={name} onChange={e => setName(e.target.value)} placeholder="Full Name *" className="glass-input" />
              </div>
              <div className="mb-md">
                <input required type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="Email Address *" autoComplete="email" className="glass-input" />
              </div>
              <div className="mb-md">
                <input required inputMode="numeric" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="Phone Number * (10 digits)" autoComplete="tel" className="glass-input" />
              </div>
              <div className="mb-md">
                <div style={{ position: 'relative' }}>
                  <input required type={showPassword ? 'text' : 'password'} value={password} minLength={6}
                    onChange={e => setPassword(e.target.value)} placeholder="Password * (min 8 chars, upper+lower+number)" className="glass-input" style={{ paddingRight: '2.5rem' }} />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="btn-ghost btn-icon" style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)' }}>
                    {showPassword ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>
              <div className="mb-lg">
                <input value={referralCode} onChange={e => setReferralCode(e.target.value.toUpperCase())} placeholder="Referral Code (optional)" className="glass-input" />
              </div>
              <button className={`btn-primary btn-lg w-full${loading ? ' btn-loading' : ''}`} type="submit" disabled={!canSubmit}>
                {loading ? 'Processing...' : 'Proceed to Payment →'}
              </button>
            </form>
          )}

          {step === 'payment' && pendingRegId && (
            <PaymentFlow
              type="registration"
              pendingRegId={pendingRegId}
              onSuccess={() => setStep('done')}
              onError={(msg) => setError(msg)}
            />
          )}

          {step === 'payment' && !pendingRegId && (
            <div className="alert-error mb-md">
              <p className="text-sm" style={{ color: 'var(--danger)' }}>Session expired. Please refresh and try again.</p>
            </div>
          )}

          {step === 'form' && (
            <div className="auth-footer">
              <span className="text-muted text-sm">Already have an account?</span>
              {' '}<Link to="/fb/login" className="font-semibold text-sm">Login</Link>
            </div>
          )}

          {step === 'payment' && (
            <div className="text-center mt-md">
              <button className="btn-ghost text-sm" onClick={() => { setStep('form'); setPendingRegId(null); }} type="button">
                ← Back to Form
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
