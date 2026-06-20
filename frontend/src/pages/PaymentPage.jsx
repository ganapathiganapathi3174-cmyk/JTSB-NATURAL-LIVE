import { useEffect, useState, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { db } from '../firebase/config.js';
import { doc, onSnapshot } from 'firebase/firestore';

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

export default function PaymentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlMode = searchParams.get('mode') || '';

  const isTopup = urlMode === 'topup';

  const [topupUserId] = useState(() => localStorage.getItem('fb_user_id') || '');
  const [topupAmount, setTopupAmount] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [paymentStep, setPaymentStep] = useState('form');
  const [rateLimitCountdown, setRateLimitCountdown] = useState(0);
  const [razorpayLoaded, setRazorpayLoaded] = useState(false);

  const walletUnsub = useRef(null);
  const confirmTimer = useRef(null);

  useEffect(() => {
    if (!isTopup) {
      navigate('/fb/register', { replace: true });
    }
  }, [isTopup, navigate]);

  useEffect(() => {
    if (isTopup && !topupUserId) {
      navigate('/fb/login', { replace: true });
    }
  }, [isTopup, topupUserId, navigate]);

  useEffect(() => {
    if (rateLimitCountdown <= 0) return;
    const id = setInterval(() => {
      setRateLimitCountdown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [rateLimitCountdown]);

  useEffect(() => {
    if (paymentStep !== 'confirming' || !topupUserId) return;
    const walletRef = doc(db, 'wallet_balances', topupUserId);
    let firstSnapshot = true;
    walletUnsub.current = onSnapshot(walletRef, (snap) => {
      if (firstSnapshot) { firstSnapshot = false; return; }
      if (snap.exists) {
        if (walletUnsub.current) walletUnsub.current();
        if (confirmTimer.current) clearTimeout(confirmTimer.current);
        navigate('/fb/dashboard', { replace: true });
      }
    }, (error) => {
      console.error('Topup listener error:', error);
      if (walletUnsub.current) walletUnsub.current();
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      setError('Unable to verify topup status. Please check your wallet.');
      setPaymentStep('form');
      setLoading(false);
    });
    confirmTimer.current = setTimeout(() => {
      if (walletUnsub.current) walletUnsub.current();
      navigate('/fb/dashboard', { replace: true });
    }, 30000);
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      if (walletUnsub.current) walletUnsub.current();
    };
  }, [paymentStep, topupUserId, navigate]);

  useEffect(() => {
    loadRazorpayScript().then(setRazorpayLoaded);
  }, []);

  async function handleTopup() {
    if (loading) return;
    if (!razorpayLoaded) {
      setError('Razorpay is loading. Please wait...');
      return;
    }

    if (!topupAmount || Number(topupAmount) < 1) {
      setError('Enter a valid topup amount');
      return;
    }
    if (!topupUserId) {
      setError('User session not found. Please login again.');
      return;
    }

    const rl = checkRateLimit('payment_submit');
    if (!rl.allowed) {
      setError(`Too many attempts. Try again in ${rl.retryAfter} seconds.`);
      setRateLimitCountdown(rl.retryAfter);
      return;
    }

    setError('');
    setLoading(true);

    let session;

    try {
      const topupResp = await fetch(`${FUNCTIONS_BASE}/createTopupSessionHttp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: topupUserId,
          amount: Number(topupAmount),
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!topupResp.ok) {
        const errBody = await topupResp.json().catch(() => ({}));
        throw new Error(errBody.error || `Backend error (${topupResp.status})`);
      }
      session = await topupResp.json();
    } catch (err) {
      setError(`Payment service temporarily unavailable. ${err.message}`);
      setLoading(false);
      setPaymentStep('form');
      return;
    }

    const rzpOptions = {
      key: import.meta.env.VITE_RAZORPAY_KEY_ID,
      amount: Number(topupAmount) * 100,
      currency: 'INR',
      name: 'Starlight Ascent',
      description: 'Wallet Topup',
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
      setError('Payment failed. No amount was deducted. Please try again.');
      setLoading(false);
      setPaymentStep('form');
    });
    rzp.open();
    setPaymentStep('pay');
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
          <h1>Wallet Topup</h1>
          <p className="muted">Add funds to your wallet via Razorpay</p>
        </div>

        {paymentStep === 'form' && (
          <>
            {error && <div className="alert alert-error">{error}{rateLimitCountdown > 0 && ` (retry in ${rateLimitCountdown}s)`}</div>}
            {success && <div className="alert alert-success">{success}</div>}
            <div className="payment-steps">
              <h3>How it works:</h3>
              <div className="step-item">
                <div className="step-number">1</div>
                <div className="step-text"><strong>Enter</strong> the topup amount below</div>
              </div>
              <div className="step-item">
                <div className="step-number">2</div>
                <div className="step-text"><strong>Pay</strong> using UPI, card, or net banking via Razorpay</div>
              </div>
            </div>
            <div className="field">
              <label>Amount (INR) *</label>
              <input type="number" value={topupAmount} onChange={e => setTopupAmount(e.target.value)} placeholder="Enter topup amount" min="1" />
            </div>
            <button
              className={`btn btn-primary${loading ? ' btn-loading' : ''} submit-btn-full`}
              onClick={handleTopup}
              disabled={loading || !topupAmount || Number(topupAmount) < 1}
            >
              {loading ? 'Opening Razorpay...' : `Pay ₹${Number(topupAmount) || 0} with Razorpay →`}
            </button>
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
              Back
            </button>
          </div>
        )}

        {paymentStep === 'confirming' && (
          <div style={{ textAlign: 'center', padding: '2rem 0' }}>
            <div style={{ margin: '0 auto 1rem', width: 48, height: 48, border: '4px solid var(--border)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <strong>Topup Confirmed!</strong><br />
            <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>Updating your wallet and redirecting to dashboard...</span>
          </div>
        )}
      </div>
    </div>
  );
}
