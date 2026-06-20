import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FirebaseUser, checkReferralLinkExpiry, FirebaseAuth, comparePassword } from '../db/firebase-db.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { db } from '../firebase/config.js';
import { collection, query, where, onSnapshot } from 'firebase/firestore';

const AMOUNT = Number(import.meta.env.VITE_PAYMENT_AMOUNT) || 120;

const FUNCTIONS_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';

function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) { resolve(true); return; }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

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
  const [razorpayLoaded, setRazorpayLoaded] = useState(false);
  const [paymentStep, setPaymentStep] = useState('form');
  const [showPassword, setShowPassword] = useState(false);
  const [pendingRegId, setPendingRegId] = useState(null);
  const [registrationEmail, setRegistrationEmail] = useState('');

  const emailTimer = useRef(null);
  const phoneTimer = useRef(null);
  const confirmTimer = useRef(null);
  const unsubscribeUserListener = useRef(null);

  useEffect(() => {
    loadRazorpayScript().then(setRazorpayLoaded);
  }, []);

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      if (unsubscribeUserListener.current) unsubscribeUserListener.current();
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

    if (!razorpayLoaded) {
      setError('Razorpay is loading. Please wait...');
      return;
    }

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

    let session;

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
        signal: AbortSignal.timeout(15000),
      });

      if (!preRegResp.ok) {
        const errBody = await preRegResp.json().catch(() => ({}));
        throw new Error(errBody.error || `Backend error (${preRegResp.status})`);
      }
      session = await preRegResp.json();
      setPendingRegId(session.pendingRegId);
      setRegistrationEmail(emailVal);
    } catch (err) {
      setError(`Payment service temporarily unavailable. ${err.message}`);
      setLoading(false);
      setPaymentStep('form');
      return;
    }

    const rzpOptions = {
      key: import.meta.env.VITE_RAZORPAY_KEY_ID,
      amount: AMOUNT * 100,
      currency: 'INR',
      name: 'Starlight Ascent',
      description: 'Registration Payment',
      prefill: {
        name: name.trim(),
        email: emailVal,
        contact: phone.trim(),
      },
      handler: function () {
        setPaymentStep('confirming');
      },
      modal: {
        ondismiss: function () {
          setLoading(false);
          setError('Payment cancelled. Please try again when ready.');
        },
      },
    };
    if (session.razorpayOrderId) {
      rzpOptions.order_id = session.razorpayOrderId;
    }
    const rzp = new window.Razorpay(rzpOptions);
    rzp.on('payment.failed', function () {
      setError('Payment failed. No account was created. Please try again.');
      setLoading(false);
      setPaymentStep('form');
    });
    rzp.open();
    setPaymentStep('pay');
  }

  // Firestore real-time listener: auto-login when webhook creates user
  useEffect(() => {
    if (paymentStep !== 'confirming' || !registrationEmail) return;

    const q = query(collection(db, 'users_new'), where('email', '==', registrationEmail));
    const unsub = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        const userDoc = snap.docs[0];
        const data = userDoc.data();
        if (data.payment_status === 'success' && data.approved === true && data.active === true) {
          if (unsubscribeUserListener.current) unsubscribeUserListener.current();
          if (confirmTimer.current) clearTimeout(confirmTimer.current);
          localStorage.setItem('fb_user_id', userDoc.id);
          localStorage.setItem('fb_login_at', String(Date.now()));
          navigate('/fb/dashboard', { replace: true });
        }
      }
    }, (error) => {
      console.error('Registration listener error:', error);
      if (unsubscribeUserListener.current) unsubscribeUserListener.current();
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      setError('Unable to verify payment status. Please try logging in.');
      setPaymentStep('form');
      setLoading(false);
    });
    unsubscribeUserListener.current = unsub;

    confirmTimer.current = setTimeout(() => {
      if (unsubscribeUserListener.current) unsubscribeUserListener.current();
      setError('Account setup is taking longer than expected. Please try logging in.');
      setPaymentStep('form');
      setLoading(false);
    }, 120000);

    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      unsub();
    };
  }, [paymentStep, registrationEmail, navigate]);

  if (paymentStep === 'confirming') {
    return (
      <div className="app-shell">
        <div className="topbar">
          <div className="brand">Starlight Ascent</div>
        </div>
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div className="loading-spinner" style={{ margin: '2rem auto', width: 48, height: 48, border: '4px solid var(--border)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <h2>Payment Confirmed!</h2>
          <p style={{ color: 'var(--muted)', marginTop: '0.5rem' }}>Creating your account and redirecting to dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">Starlight Ascent</div>
        <Link to="/fb/login">Login</Link>
      </div>
      <div className="auth-card">
        <h1>Create Account</h1>
        <p className="muted">One-time payment of ₹{AMOUNT} for lifetime access</p>

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
              {loading ? 'Opening Razorpay...' : `Proceed to Payment ₹${AMOUNT} →`}
            </button>
          </form>
        )}

        {paymentStep === 'pay' && (
          <div className="payment-status">
            <div className="alert alert-info">
              <strong>Payment window opened!</strong><br />
              Complete the payment in the Razorpay popup to continue.
            </div>
            <button
              className="btn btn-secondary mt-md"
              onClick={() => setPaymentStep('form')}
              disabled={loading}
            >
              Back to Form
            </button>
          </div>
        )}

        <p className="muted mt-md">
          Already have an account? <Link to="/fb/login">Login</Link>
        </p>
      </div>
    </div>
  );
}
