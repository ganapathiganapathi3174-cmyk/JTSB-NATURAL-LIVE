import { useEffect, useState, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FirebaseUser } from '../db/firebase-db.js';
import { checkRateLimit } from '../utils/rateLimiter.js';

const AMOUNT = Number(import.meta.env.VITE_PAYMENT_AMOUNT) || 120;

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

export default function PaymentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const referredBy = searchParams.get('ref') || '';
  const [manualReferralCode, setManualReferralCode] = useState('');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [paymentStep, setPaymentStep] = useState('form');
  const [verificationCode, setVerificationCode] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [paymentSessionId, setPaymentSessionId] = useState('');
  const [emailExists, setEmailExists] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [phoneExists, setPhoneExists] = useState(false);
  const [checkingPhone, setCheckingPhone] = useState(false);
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0);
  const [razorpayLoaded, setRazorpayLoaded] = useState(false);

  useEffect(() => {
    if (rateLimitCountdown <= 0) return;
    const id = setInterval(() => {
      setRateLimitCountdown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [rateLimitCountdown]);
  const emailTimer = useRef(null);
  const phoneTimer = useRef(null);

  useEffect(() => {
    loadRazorpayScript().then(setRazorpayLoaded);
  }, []);

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

  function validateForm() {
    if (!fullName.trim() || fullName.trim().length < 2) {
      setError('Full name must be at least 2 characters');
      return false;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address');
      return false;
    }
    if (emailExists) {
      setError('This email is already registered. Please use another email or login.');
      return false;
    }
    if (!phoneNumber || !/^[6-9]\d{9}$/.test(phoneNumber)) {
      setError('Please enter a valid 10-digit Indian mobile number');
      return false;
    }
    if (phoneExists) {
      setError('This mobile number is already registered.');
      return false;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return false;
    }
    return true;
  }

  async function validateReferralCodeBeforePayment(code) {
    if (!code || !code.trim()) return true;
    try {
      const { checkReferralLinkExpiry } = await import('../db/firebase-db.js');
      const result = await checkReferralLinkExpiry(code.trim().toUpperCase());
      if (!result.valid) {
        if (result.reason === 'expired') setError('Referral link has expired. Please use a valid referral code.');
        else if (result.reason === 'limit_reached') setError('Invalid Referral Code');
        else setError('Invalid referral code');
        return false;
      }
      if (!result.referrer || result.referrer.payment_status !== 'approved' || result.referrer.account_status !== 'active') {
        setError('Referral code is no longer valid');
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  async function handlePayWithRazorpay() {
    if (!razorpayLoaded) {
      setError('Razorpay is loading. Please wait...');
      return;
    }
    if (!validateForm()) return;

    const refCode = (manualReferralCode || referredBy || '').trim();
    if (refCode) {
      const validRef = await validateReferralCodeBeforePayment(refCode);
      if (!validRef) return;
    }

    const rl = checkRateLimit('payment_submit');
    if (!rl.allowed) {
      setError(`Too many attempts. Try again in ${rl.retryAfter} seconds.`);
      setRateLimitCountdown(rl.retryAfter);
      return;
    }

    setError('');
    setLoading(true);
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timed out. Check your network or disable QUIC in chrome://flags')), 15000)
      );
      const session = await Promise.race([
        FirebaseUser.createPaymentSession({
          name: fullName.trim(),
          email: email.trim().toLowerCase(),
          phone: phoneNumber.trim(),
          amount: AMOUNT,
        }),
        timeoutPromise,
      ]);
      setPaymentSessionId(session.sessionId);

      const rzpOptions = {
        key: import.meta.env.VITE_RAZORPAY_KEY_ID || 'rzp_test_xxxxxxxxxxxx',
        amount: AMOUNT * 100,
        currency: 'INR',
        name: 'Starlight Ascent',
        description: 'Registration Payment',
        prefill: {
          name: fullName.trim(),
          email: email.trim().toLowerCase(),
          contact: phoneNumber.trim(),
        },
        handler: async function (response) {
          try {
            const codePromise = FirebaseUser.generateVerificationCode(
              session.sessionId,
              response.razorpay_order_id,
              response.razorpay_payment_id,
            );
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Code generation timed out')), 10000)
            );
            const codeResult = await Promise.race([codePromise, timeoutPromise]);
            setGeneratedCode(codeResult?.code || '');
          } catch (codeErr) {
            console.warn('Direct code generation failed, webhook may handle it:', codeErr);
          }
          setPaymentStep('verify');
          setLoading(false);
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
      rzp.on('payment.failed', function (response) {
        setError('Payment failed: ' + (response.error?.description || 'Unknown error'));
        setLoading(false);
        setPaymentStep('form');
      });
      rzp.open();
      setPaymentStep('pay');
    } catch (err) {
      setError(err.message || 'Failed to initiate payment');
      setLoading(false);
      setPaymentStep('form');
    }
  }

  async function handleVerifyAndRegister() {
    const code = verificationCode.trim();
    if (!code || !/^JTSB-[A-Z0-9]{6}$/i.test(code)) {
      setError('Enter a valid verification code (format: JTSB-XXXXXX)');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const result = await FirebaseUser.verifyPaymentCode(paymentSessionId, code.toUpperCase(), {
        name: fullName.trim(),
        email: email.trim().toLowerCase(),
        phone: phoneNumber.trim(),
        password: password,
        referredBy: manualReferralCode || referredBy || null,
      });
      if (result.success) {
        setSuccess('Payment verified! Creating your account...');
        setPaymentStep('done');
        setTimeout(() => {
          navigate(`/fb/login?email=${encodeURIComponent(email.trim().toLowerCase())}`);
        }, 2000);
      } else {
        setError(result.error || 'Verification failed. Please try again.');
      }
    } catch (err) {
      setError(err.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">Starlight Ascent</div>
        <div>
          <Link to="/fb/login">Login</Link>
          {' · '}
          <Link to="/fb-admin">Admin</Link>
        </div>
      </div>

      <div className="card payment-card">
        <div className="payment-header">
          <h1>Register - Starlight Ascent</h1>
          <p className="muted">
            One-time payment of ₹{AMOUNT} for lifetime access
          </p>
        </div>

        {referredBy && (
          <div className="alert alert-success mb-md">
            You were referred by someone! They will get credit for your signup.
          </div>
        )}

        {paymentStep === 'form' && (
          <>
            <div className="payment-steps">
              <h3>How it works:</h3>
              <div className="step-item">
                <div className="step-number">1</div>
                <div className="step-text">
                  <strong>Fill in</strong> your registration details below
                </div>
              </div>
              <div className="step-item">
                <div className="step-number">2</div>
                <div className="step-text">
                  <strong>Pay ₹{AMOUNT}</strong> using UPI, card, or net banking via Razorpay
                </div>
              </div>
              <div className="step-item">
                <div className="step-number">3</div>
                <div className="step-text">
                  <strong>Enter the verification code</strong> from your payment confirmation to complete registration
                </div>
              </div>
            </div>

            {error && <div className="alert alert-error">{error}{rateLimitCountdown > 0 && ` (retry in ${rateLimitCountdown}s)`}</div>}
            {success && <div className="alert alert-success">{success}</div>}

            <form onSubmit={(e) => { e.preventDefault(); handlePayWithRazorpay(); }}>
              <div className="field">
                <label>Full Name *</label>
                <input
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Enter your full name"
                />
              </div>

              <div className="field">
                <label>Email Address *</label>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={(e) => checkEmailDuplicate(e.target.value)}
                  placeholder="your.email@example.com"
                  autoComplete="email"
                  className={emailExists ? 'input-error' : ''}
                />
                {checkingEmail && <div className="hint" style={{ color: 'var(--accent)', marginTop: '0.25rem' }}>Checking email...</div>}
                {emailExists && <div className="field-error">This email is already registered. Please use another email or login.</div>}
              </div>

              <div className="field">
                <label>Phone Number *</label>
                <input
                  required
                  inputMode="numeric"
                  value={phoneNumber}
                  onChange={(e) => {
                    setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 10));
                    setPhoneExists(false);
                  }}
                  onBlur={(e) => checkPhoneDuplicate(e.target.value)}
                  placeholder="10-digit mobile number"
                  autoComplete="tel"
                  className={phoneExists ? 'input-error' : ''}
                />
                {checkingPhone && <div className="hint" style={{ color: 'var(--accent)', marginTop: '0.25rem' }}>Checking mobile number...</div>}
                {phoneExists && <div className="field-error">This mobile number is already registered.</div>}
                <div className="hint">Example: 9876543210</div>
              </div>

              <div className="field">
                <label>Password *</label>
                <input
                  required
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a password"
                  minLength={6}
                />
                <div className="hint">Use this password to login</div>
              </div>

              <div className="field">
                <label>Referral Code (optional)</label>
                <input
                  value={manualReferralCode || referredBy}
                  onChange={(e) => {
                    setManualReferralCode(e.target.value.toUpperCase().trim());
                  }}
                  placeholder="Enter referral code if you have one"
                />
                <div className="hint">
                  Have a referral code? Enter it here to get bonus referrals
                </div>
              </div>

              <button
                className={`btn btn-primary${loading ? ' btn-loading' : ''} submit-btn-full`}
                type="submit"
                disabled={loading}
              >
                {loading ? 'Opening Razorpay...' : `Pay ₹${AMOUNT} with Razorpay →`}
              </button>
            </form>
          </>
        )}

        {paymentStep === 'pay' && (
          <div className="payment-status">
            {error && <div className="alert alert-error">{error}</div>}
            <div className="alert alert-info">
              <strong>Payment window opened!</strong><br />
              Complete the payment in the Razorpay popup to continue.
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => setPaymentStep('form')}
              disabled={loading}
            >
              Back to Form
            </button>
          </div>
        )}

        {paymentStep === 'verify' && (
          <div className="verify-section">
            <h3>Enter Verification Code</h3>
            <p className="muted">
              A verification code has been sent to the payment confirmation screen.
              Enter it below to complete your registration.
            </p>

            {error && <div className="alert alert-error">{error}</div>}
            {success && <div className="alert alert-success">{success}</div>}

            {generatedCode && (
              <div className="alert alert-success" style={{ fontSize: '1.2rem', textAlign: 'center', padding: '1rem' }}>
                Your verification code: <strong>{generatedCode}</strong>
              </div>
            )}

            <div className="field">
              <label>Verification Code *</label>
              <input
                required
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
                placeholder="JTSB-XXXXXX"
                className="code-input"
              />
              <div className="hint">
                Check your payment confirmation for the code (format: JTSB-XXXXXX)
              </div>
            </div>

            <button
              className={`btn btn-primary${loading ? ' btn-loading' : ''} submit-btn-full`}
              onClick={handleVerifyAndRegister}
              disabled={loading || !verificationCode.trim()}
            >
              {loading ? 'Verifying...' : 'Verify & Register →'}
            </button>

            <div className="verify-help">
              <button
                className="btn btn-link"
                onClick={() => {
                  setPaymentStep('form');
                  setVerificationCode('');
                  setError('');
                }}
              >
                ← Start over
              </button>
            </div>
          </div>
        )}

        {paymentStep === 'done' && (
          <div className="payment-success-note">
            <strong>Payment verified! Account created successfully.</strong><br />
            You will be redirected to the login page shortly.
          </div>
        )}
      </div>
    </div>
  );
}
