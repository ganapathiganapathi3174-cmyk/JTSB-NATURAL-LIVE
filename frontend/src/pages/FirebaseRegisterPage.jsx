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
    <div className="page-wrap" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div className="text-center mb-lg animate-fade-in-up">
        <div className="brand" style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>
          <span className="text-gradient">JTSB Natural</span>
        </div>
        <p className="text-muted text-sm" style={{ margin: 0 }}>Premium FinTech Platform</p>
      </div>

      {paymentStep !== 'form' && (
        <div className="step-indicator animate-fade-in-up">
          <div className="step completed">
            <span className="step-number">✓</span>
            <span>Form</span>
          </div>
          <div className={`step-line completed`} />
          <div className={`step ${paymentStep === 'upi' ? 'active' : ''} ${paymentStep === 'submitted' ? 'completed' : ''}`}>
            <span className="step-number">{paymentStep === 'submitted' ? '✓' : '2'}</span>
            <span>Payment</span>
          </div>
          <div className={`step-line ${paymentStep === 'submitted' ? 'completed' : ''}`} />
          <div className={`step ${paymentStep === 'submitted' ? 'completed' : ''}`}>
            <span className="step-number">{paymentStep === 'submitted' ? '✓' : '3'}</span>
            <span>Done</span>
          </div>
        </div>
      )}

      <div className="card-glass animate-fade-in-up stagger-1" style={{ width: '100%', maxWidth: 460, padding: '2rem' }}>
        <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.5rem', letterSpacing: '-0.03em' }} className="text-gradient">
          {paymentStep === 'form' ? 'Create Account' : paymentStep === 'upi' ? 'Complete Payment' : 'Payment Submitted!'}
        </h1>
        <p className="text-muted text-sm mb-lg" style={{ margin: '0 0 1.5rem' }}>
          {paymentStep === 'form' ? 'One-time payment for lifetime access' : 'Complete your registration'}
        </p>

        {error && (
          <div className="card-dim mb-md" style={{ background: 'var(--danger-light)', border: '1px solid rgba(239,68,68,0.2)', padding: '0.75rem 1rem', fontSize: '0.85rem', color: 'var(--danger)' }}>
            {error}{rateLimitCountdown > 0 && ` (retry in ${rateLimitCountdown}s)`}
          </div>
        )}
        {success && (
          <div className="card-dim mb-md" style={{ background: 'var(--success-light)', border: '1px solid rgba(34,197,94,0.2)', padding: '0.75rem 1rem', fontSize: '0.85rem', color: 'var(--success)' }}>
            {success}
          </div>
        )}

        {paymentStep === 'form' && (
          <form onSubmit={handleProceedToPayment}>
            <div className="field-glass mb-md">
              <input required value={name} onChange={e => setName(e.target.value)} placeholder="Full Name *" />
            </div>
            <div className="field-glass mb-md" style={{ position: 'relative' }}>
              <input required type="email" value={email} onChange={e => { setEmail(e.target.value); setEmailExists(false); }}
                onBlur={e => checkEmailDuplicate(e.target.value)} placeholder="Email Address *"
                autoComplete="email" style={emailExists ? { borderColor: 'var(--danger)' } : {}} />
              {checkingEmail && <span className="text-xs text-muted" style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)' }}>checking...</span>}
              {emailExists && <p className="text-xs" style={{ margin: '0.25rem 0 0', color: 'var(--danger)' }}>Already registered. <Link to="/fb/login">Login?</Link></p>}
            </div>
            <div className="field-glass mb-md" style={{ position: 'relative' }}>
              <input required inputMode="numeric" value={phone} onChange={e => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setPhoneExists(false); }}
                onBlur={e => checkPhoneDuplicate(e.target.value)} placeholder="Phone Number * (10 digits)"
                autoComplete="tel" style={phoneExists ? { borderColor: 'var(--danger)' } : {}} />
              {checkingPhone && <span className="text-xs text-muted" style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)' }}>checking...</span>}
              {phoneExists && <p className="text-xs" style={{ margin: '0.25rem 0 0', color: 'var(--danger)' }}>Mobile number already registered.</p>}
            </div>
            <div className="field-glass mb-md" style={{ position: 'relative' }}>
              <input required type={showPassword ? 'text' : 'password'} value={password} minLength={6}
                onChange={e => setPassword(e.target.value)} placeholder="Password * (min 8 chars, upper+lower+number)"
                style={{ paddingRight: '2.5rem' }} />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: '0.65rem', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--muted)', padding: '0.25rem', lineHeight: 1 }}>
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
            <div className="field-glass mb-lg">
              <input value={referralCode} onChange={e => setReferralCode(e.target.value.toUpperCase())} placeholder="Referral Code (optional)" />
            </div>
            <button className={`btn btn-primary w-full${loading ? ' btn-loading' : ''}`} type="submit" disabled={!canSubmit || emailExists || phoneExists}>
              {loading ? 'Processing...' : 'Proceed to Payment →'}
            </button>
          </form>
        )}

        {paymentStep === 'upi' && pendingRegId && (
          <div>
            <UpiPayment
              type="registration"
              pendingRegId={pendingRegId}
              allowedPackage={allowedPackage}
              onSuccess={handleUpiSuccess}
              onError={(msg) => setError(msg)}
            />
            <div className="text-center mt-md">
              <button className="btn btn-ghost btn-sm" onClick={() => setPaymentStep('form')}>
                ← Back to Form
              </button>
            </div>
          </div>
        )}

        {paymentStep === 'upi' && !pendingRegId && (
          <div className="card-dim text-center" style={{ padding: '1.5rem', background: 'var(--danger-light)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <p className="text-sm" style={{ color: 'var(--danger)' }}>Session expired. Please refresh and try again.</p>
          </div>
        )}

        {paymentStep === 'submitted' && (
          <div className="text-center" style={{ padding: '1rem 0' }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--success), #4ADE80)', color: 'var(--text)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.75rem', margin: '0 auto 1.25rem', boxShadow: '0 0 30px rgba(34,197,94,0.3)'
            }}>✓</div>
            <h2 style={{ margin: 0, fontSize: '1.25rem' }} className="text-gradient-success">Payment Submitted!</h2>
            <p className="text-muted text-sm" style={{ marginTop: '0.75rem', lineHeight: 1.6 }}>
              Your payment is being verified. You will be able to login once your account is approved.
            </p>
            <Link to="/fb/login" className="btn btn-primary" style={{ marginTop: '1rem', display: 'inline-flex' }}>
              Go to Login
            </Link>
          </div>
        )}

        {paymentStep === 'form' && (
          <div className="flex items-center justify-center gap-sm mt-lg">
            <span className="text-muted text-sm">Already have an account?</span>
            <Link to="/fb/login" style={{ fontWeight: 600, fontSize: '0.85rem' }}>Login</Link>
          </div>
        )}
      </div>
    </div>
  );
}
