import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FirebaseUser, checkReferralLinkExpiry, comparePassword } from '../db/firebase-db.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import UpiPayment from '../components/UpiPayment.jsx';

const FUNCTIONS_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';

export default function FirebaseRegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlReferralCode = searchParams.get('ref') || '';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState(urlReferralCode);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [emailExists, setEmailExists] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [phoneExists, setPhoneExists] = useState(false);
  const [checkingPhone, setCheckingPhone] = useState(false);
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0);
  const [paymentStep, setPaymentStep] = useState('form');
  const [showPassword, setShowPassword] = useState(false);
  const [pendingRegId, setPendingRegId] = useState(null);
  const [allowedPackage, setAllowedPackage] = useState(null);

  const emailTimer = useRef(null);
  const phoneTimer = useRef(null);

  useEffect(() => {
    return () => {
      if (emailTimer.current) clearTimeout(emailTimer.current);
      if (phoneTimer.current) clearTimeout(phoneTimer.current);
    };
  }, []);

  useEffect(() => {
    if (rateLimitCountdown <= 0) return;
    const id = setInterval(() => {
      setRateLimitCountdown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [rateLimitCountdown]);

  const canSubmit = useMemo(() => {
    const nameValid = name.trim().length > 0;
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    const phoneValid = /^[6-9]\d{9}$/.test(phone.trim());
    const passwordValid = password.length >= 6;
    return nameValid && emailValid && phoneValid && passwordValid && !loading && !emailExists && !phoneExists;
  }, [name, email, phone, password, loading, emailExists, phoneExists]);

  function checkEmailDuplicate(emailVal) {
    if (emailTimer.current) clearTimeout(emailTimer.current);
    const trimmed = emailVal.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailExists(false);
      setCheckingEmail(false);
      return;
    }
    setCheckingEmail(true);
    emailTimer.current = setTimeout(async () => {
      try {
        const existing = await FirebaseUser.findByEmail(trimmed);
        setEmailExists(!!existing);
      } catch {
        setEmailExists(false);
      } finally {
        setCheckingEmail(false);
      }
    }, 500);
  }

  function checkPhoneDuplicate(phoneVal) {
    if (phoneTimer.current) clearTimeout(phoneTimer.current);
    const trimmed = phoneVal.trim();
    if (trimmed.length < 10) {
      setPhoneExists(false);
      setCheckingPhone(false);
      return;
    }
    setCheckingPhone(true);
    phoneTimer.current = setTimeout(async () => {
      try {
        const existing = await FirebaseUser.findByPhone(trimmed);
        setPhoneExists(!!existing);
      } catch {
        setPhoneExists(false);
      } finally {
        setCheckingPhone(false);
      }
    }, 500);
  }

  async function validateReferralCode(code) {
    if (!code || !code.trim()) return true;
    try {
      const result = await checkReferralLinkExpiry(code.trim().toUpperCase());
      if (!result.valid) {
        if (result.reason === 'expired') setError('Referral link has expired');
        else if (result.reason === 'limit_reached') setError('Invalid Referral Code');
        else setError('Invalid referral code');
        return false;
      }
      if (!result.referrer || (result.referrer.payment_status !== 'approved' && result.referrer.payment_status !== 'success' && result.referrer.membershipStatus !== 'active') || result.referrer.account_status !== 'active') {
        setError('Referral code is no longer valid');
        return false;
      }
      return true;
    } catch {
      setError('Referral validation failed');
      return false;
    }
  }

  async function handleProceedToPayment(e) {
    e.preventDefault();
    setError('');

    if (!name.trim() || name.trim().length < 2) {
      setError('Full name must be at least 2 characters');
      return;
    }

    const emailVal = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      setError('Please enter a valid email address');
      return;
    }
    if (emailExists) {
      setError('This email is already registered. Please use another email or login.');
      return;
    }

    if (!/^[6-9]\d{9}$/.test(phone.trim())) {
      setError('Please enter a valid 10-digit Indian mobile number');
      return;
    }
    if (phoneExists) {
      setError('This mobile number is already registered.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (!/[A-Z]/.test(password)) {
      setError('Password must include at least one uppercase letter');
      return;
    }
    if (!/[a-z]/.test(password)) {
      setError('Password must include at least one lowercase letter');
      return;
    }
    if (!/[0-9]/.test(password)) {
      setError('Password must include at least one number');
      return;
    }

    const refCode = referralCode.trim();
    if (refCode) {
      const validRef = await validateReferralCode(refCode);
      if (!validRef) return;
    }

    const rl = checkRateLimit('payment_submit');
    if (!rl.allowed) {
      setError(`Too many attempts. Try again in ${rl.retryAfter} seconds.`);
      setRateLimitCountdown(rl.retryAfter);
      return;
    }

    setLoading(true);

    try {
      const preRegResp = await fetch(`${FUNCTIONS_BASE}/preRegister`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: emailVal,
          phone: phone.trim(),
          password,
          referralCode: refCode || null,
        }),
        signal: (() => { const c = new AbortController(); setTimeout(() => c.abort(), 90000); return c.signal; })(),
      });

      if (!preRegResp.ok) {
        const errBody = await preRegResp.json().catch(() => ({}));
        throw new Error(errBody.error || `Backend error (${preRegResp.status})`);
      }
      const session = await preRegResp.json();
      setPendingRegId(session.pendingRegId);
      if (session.allowedPackage) setAllowedPackage(session.allowedPackage);
      setLoading(false);
      setPaymentStep('upi');
    } catch (err) {
      const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError' || (err.message && (err.message.toLowerCase().includes('timed out') || err.message.toLowerCase().includes('timeout')));
      setError(isTimeout ? `Request timed out. ${err.message}` : err.message || 'Registration failed');
      setLoading(false);
    }
  }

  function handleUpiSuccess(data) {
    setPaymentStep('submitted');
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">Starlight Ascent</div>
        <Link to="/fb/login">Login</Link>
      </div>
      <div className="auth-card">
        <h1>Create Account</h1>
        <p className="muted">One-time payment for lifetime access</p>

        {error && <div className="alert alert-error">{error}{rateLimitCountdown > 0 && ` (retry in ${rateLimitCountdown}s)`}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        {paymentStep === 'form' && (
          <form onSubmit={handleProceedToPayment}>
            <div className="field">
              <label>Full Name *</label>
              <input
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Enter your full name"
                style={!name.trim() ? {} : { borderColor: 'var(--success)' }}
              />
            </div>
            <div className="field">
              <label>Email Address *</label>
              <input
                required
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onBlur={e => checkEmailDuplicate(e.target.value)}
                placeholder="your.email@example.com"
                autoComplete="email"
                className={emailExists ? 'input-error' : ''}
              />
              {checkingEmail && <div className="hint">Checking email...</div>}
              {emailExists && <div className="field-error">This email is already registered. Please use another email or login.</div>}
            </div>
            <div className="field">
              <label>Phone Number *</label>
              <input
                required
                inputMode="numeric"
                value={phone}
                onChange={e => {
                  setPhone(e.target.value.replace(/\D/g, '').slice(0, 10));
                  setPhoneExists(false);
                }}
                onBlur={e => checkPhoneDuplicate(e.target.value)}
                placeholder="10-digit mobile number"
                autoComplete="tel"
                className={phoneExists ? 'input-error' : ''}
              />
              {checkingPhone && <div className="hint">Checking mobile number...</div>}
              {phoneExists && <div className="field-error">This mobile number is already registered.</div>}
            </div>
            <div className="field">
              <label>Password *</label>
              <div className="password-field-wrap">
                <input
                  required
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  minLength={6}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full"
                  style={{ paddingRight: '2.5rem' }}
                  placeholder="Create a password (min 6 characters)"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="password-toggle-btn"
                >
                  {showPassword ? '👁' : '👁️'}
                </button>
              </div>
            </div>
            <div className="field">
              <label>Referral Code (optional)</label>
              <input
                value={referralCode}
                onChange={e => setReferralCode(e.target.value.toUpperCase())}
                placeholder="Enter referral code if you have one"
              />
            </div>
            <button
              className={`btn btn-primary w-full${loading ? ' btn-loading' : ''}`}
              type="submit"
              disabled={!canSubmit || emailExists || phoneExists}
            >
              {loading ? 'Processing...' : 'Proceed to Payment →'}
            </button>
          </form>
        )}

        {paymentStep === 'upi' && pendingRegId && (
          <div className="upi-payment-wrap">
            <UpiPayment
              type="registration"
              pendingRegId={pendingRegId}
              allowedPackage={allowedPackage}
              onSuccess={handleUpiSuccess}
              onError={(msg) => setError(msg)}
            />
            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
              <button
                className="btn btn-ghost"
                onClick={() => setPaymentStep('form')}
              >
                Back to Form
              </button>
            </div>
          </div>
        )}

        {paymentStep === 'upi' && !pendingRegId && (
          <div className="alert alert-error">
            Session expired. Please refresh and try again.
          </div>
        )}

        {paymentStep === 'submitted' && (
          <div style={{ textAlign: 'center', padding: '2rem 0' }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              background: 'var(--success, #16a34a)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.75rem', margin: '0 auto 1.25rem',
            }}>✓</div>
            <h2 style={{ margin: 0 }}>Payment Submitted!</h2>
            <p className="muted" style={{ marginTop: '0.75rem', lineHeight: 1.6 }}>
              Your payment is being verified. You will be able to login once your account is approved.
            </p>
            <Link to="/fb/login" className="btn btn-primary" style={{ marginTop: '1rem', display: 'inline-block' }}>
              Go to Login
            </Link>
          </div>
        )}

        <p className="muted mt-md">
          Already have an account? <Link to="/fb/login">Login</Link>
        </p>
      </div>
    </div>
  );
}
