import { useState, useEffect, useRef, useCallback } from 'react';

const FUNCTIONS_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';
const UPI_POLL_INTERVAL = 5000;
const UPI_POLL_TIMEOUT = 30 * 60 * 1000;
const PENDING_TIMEOUT_MINUTES = 10;

const TEST_MODE = import.meta.env.VITE_TEST_MODE === 'true' || true;

const TOPUP_AMOUNTS = [
  { amount: 120, label: 'Basic Topup' },
  { amount: 500, label: 'Standard Topup' },
  { amount: 1000, label: 'Premium Topup' },
  ...(TEST_MODE ? [{ amount: 1, label: 'Test Topup' }] : []),
];

function detectUPIApps() {
  const ua = navigator.userAgent.toLowerCase();
  const isAndroid = /android/.test(ua);
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isMobile = isAndroid || isIOS;

  const apps = [
    { id: 'GOOGLE_PAY', name: 'Google Pay', pkg: 'com.google.android.apps.nbu.paisa.user', icon: 'G', color: '#4285F4', universal: false },
    { id: 'PHONE_PE', name: 'PhonePe', pkg: 'com.phonepe.app', icon: 'P', color: '#5F259F', universal: false },
    { id: 'PAYTM', name: 'Paytm', pkg: 'net.one97.paytm', icon: 'PT', color: '#00BAF2', universal: false },
    { id: 'BHIM', name: 'BHIM', pkg: 'in.org.npci.upiapp', icon: 'B', color: '#1F7A1F', universal: false },
    { id: 'AMAZON_PAY', name: 'Amazon Pay', pkg: 'in.amazon.mShop.android.shopping', icon: 'A', color: '#FF9900', universal: false },
    { id: 'GENERIC', name: 'Any UPI App', pkg: '', icon: 'UPI', color: '#6B7280', universal: true },
  ];

  return { apps, isMobile, isAndroid, isIOS };
}

export default function UpiPaymentAuto({ type, pendingRegId, userId, onSuccess, onError }) {
  const [selectedAmount, setSelectedAmount] = useState(null);
  const [step, setStep] = useState('select');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [upiOrderId, setUpiOrderId] = useState(null);
  const [upiIntentUrl, setUpiIntentUrl] = useState(null);
  const [deeplinks, setDeeplinks] = useState(null);
  const [upiStatus, setUpiStatus] = useState(null);
  const [polling, setPolling] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState(null);
  const [showAppSelector, setShowAppSelector] = useState(true);
  const [paymentStatus, setPaymentStatus] = useState('pending');
  const [statusMessage, setStatusMessage] = useState('Waiting for payment confirmation...');
  const [showQR, setShowQR] = useState(false);
  const [qrTimer, setQrTimer] = useState(null);
  const [elapsed, setElapsed] = useState(0);

  const pollTimerRef = useRef(null);
  const pollStartRef = useRef(null);
  const elapsedTimerRef = useRef(null);

  useEffect(() => {
    setDeviceInfo(detectUPIApps());
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  const startElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    setElapsed(0);
    elapsedTimerRef.current = setInterval(() => {
      setElapsed(prev => prev + 1);
    }, 60000);
  }, []);

  async function createUPIOrderAndPay(appId) {
    setError('');
    if (!selectedAmount) { setError('Please select an amount'); return; }
    setVerifying(true);
    setShowAppSelector(false);
    try {
      const body = { type, amount: selectedAmount };
      if (type === 'registration') {
        if (!pendingRegId) { setError('Registration session expired. Please refresh.'); setVerifying(false); return; }
        body.pendingRegId = pendingRegId;
      } else {
        if (!userId) { setError('User session not found. Please login again.'); setVerifying(false); return; }
        body.userId = userId;
      }

      const resp = await fetch(`${FUNCTIONS_BASE}/createUPIOrder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to create payment order');

      setUpiOrderId(data.orderId);
      setUpiIntentUrl(data.upiIntentUrl);
      setDeeplinks(data.deeplinks || null);

      const targetUrl = appId && appId !== 'GENERIC' && data.deeplinks?.apps?.[appId]
        ? data.deeplinks.apps[appId].intent
        : data.upiIntentUrl;

      setTimeout(() => {
        if (targetUrl) {
          try { window.location.href = targetUrl; } catch {}
        }
      }, 300);

      setPolling(true);
      setUpiStatus('PENDING');
      setStep('upi_poll');
      setPaymentStatus('pending');
      setStatusMessage('Payment sent to UPI app. Waiting for confirmation...');
      pollStartRef.current = Date.now();
      startElapsedTimer();
      startPolling(data.orderId);
    } catch (err) {
      setError(err.message || 'Failed to create payment order');
      setShowAppSelector(true);
      if (onError) onError(err.message);
    } finally { setVerifying(false); }
  }

  function startPolling(orderId) {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = setTimeout(async () => {
      try {
        const resp = await fetch(`${FUNCTIONS_BASE}/getUPIOrderStatus?orderId=${encodeURIComponent(orderId)}`);
        if (!resp.ok) { startPolling(orderId); return; }
        const data = await resp.json();
        setUpiStatus(data.status);

        if (data.status === 'SUCCESS') {
          setPolling(false);
          setStep('success');
          setPaymentStatus('approved');
          setStatusMessage('Payment successful!');
          if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
          if (onSuccess) onSuccess(data);
          return;
        }
        if (data.status === 'FAILED') {
          setPolling(false);
          setPaymentStatus('failed');
          setStatusMessage('Payment failed. Please try again.');
          if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
          return;
        }
        if (data.status === 'EXPIRED') {
          setPolling(false);
          setPaymentStatus('expired');
          setStatusMessage('Payment time expired. You can retry.');
          if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
          return;
        }
        if (Date.now() - pollStartRef.current > UPI_POLL_TIMEOUT) {
          setPolling(false);
          setPaymentStatus('expired');
          setStatusMessage('Payment confirmation timed out. Please check your payment status.');
          if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
          return;
        }
        if (elapsed >= PENDING_TIMEOUT_MINUTES) {
          setStatusMessage('Payment pending for ' + PENDING_TIMEOUT_MINUTES + ' minutes. Admin has been notified.');
        } else {
          setStatusMessage('Verifying your payment. Please wait. Do not make another payment.');
        }
        startPolling(orderId);
      } catch { startPolling(orderId); }
    }, UPI_POLL_INTERVAL);
  }

  async function retryUPIOrder() {
    if (!upiOrderId) { createUPIOrderAndPay('GENERIC'); return; }
    setError('');
    setVerifying(true);
    try {
      const resp = await fetch(`${FUNCTIONS_BASE}/retryUPIOrder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: upiOrderId }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Retry failed');

      setUpiOrderId(data.orderId);
      setUpiIntentUrl(data.upiIntentUrl);
      setDeeplinks(data.deeplinks || null);

      setTimeout(() => {
        if (data.upiIntentUrl) {
          try { window.location.href = data.upiIntentUrl; } catch {}
        }
      }, 300);

      setPolling(true);
      setUpiStatus('PENDING');
      setStep('upi_poll');
      setPaymentStatus('pending');
      setStatusMessage('Retrying payment...');
      pollStartRef.current = Date.now();
      startElapsedTimer();
      startPolling(data.orderId);
    } catch (err) { setError(err.message || 'Retry failed'); }
    finally { setVerifying(false); }
  }

  function handleReset() {
    setStep('select');
    setSelectedAmount(null);
    setUpiOrderId(null);
    setUpiIntentUrl(null);
    setDeeplinks(null);
    setUpiStatus(null);
    setPolling(false);
    setPaymentStatus('pending');
    setStatusMessage('');
    setShowAppSelector(true);
    setShowQR(false);
    setElapsed(0);
    setError('');
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
  }

  function handleAppFallback() {
    if (upiIntentUrl) {
      try { window.location.href = upiIntentUrl; } catch {}
    }
  }

  if (step === 'success') {
    return (
      <div style={{ textAlign: 'center', padding: '1rem 0' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--success)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', margin: '0 auto 1rem' }}>✓</div>
        <h3 style={{ margin: 0 }}>Payment Successful!</h3>
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          Your payment has been confirmed.
        </p>
      </div>
    );
  }

  if (step === 'upi_poll') {
    const statusColor = paymentStatus === 'approved' ? 'var(--success)' :
      paymentStatus === 'expired' ? '#ef4444' :
      paymentStatus === 'failed' ? '#ef4444' :
      'var(--primary)';

    return (
      <div style={{ textAlign: 'center', padding: '1rem 0' }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: statusColor,
          color: '#fff', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: '1.5rem',
          margin: '0 auto 1rem',
          animation: paymentStatus === 'pending' ? 'pulse 1.5s infinite' : 'none',
        }}>
          {paymentStatus === 'approved' ? '✓' :
           paymentStatus === 'expired' ? '✗' :
           paymentStatus === 'failed' ? '✗' : '⏳'}
        </div>
        <h3 style={{ margin: 0 }}>
          {paymentStatus === 'pending' ? 'Payment Pending Verification' :
           paymentStatus === 'approved' ? 'Payment Approved' :
           paymentStatus === 'expired' ? 'Payment Expired' :
           paymentStatus === 'failed' ? 'Payment Failed' :
           'Processing...'}
        </h3>
        <p className="muted" style={{ marginTop: '0.75rem', maxWidth: 360, marginLeft: 'auto', marginRight: 'auto' }}>
          {statusMessage}
        </p>
        {elapsed > 0 && paymentStatus === 'pending' && (
          <p style={{ fontSize: '0.85rem', color: '#f59e0b', marginTop: '0.5rem' }}>
            ⏱ {elapsed} min / {PENDING_TIMEOUT_MINUTES} min
          </p>
        )}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '1rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-sm" onClick={handleAppFallback}>
            Open UPI App
          </button>
          {(paymentStatus === 'expired' || paymentStatus === 'failed') && (
            <button type="button" className="btn btn-primary btn-sm" onClick={retryUPIOrder} disabled={verifying}>
              {verifying ? 'Retrying...' : 'Retry Payment'}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={handleReset}>
            {paymentStatus === 'expired' || paymentStatus === 'failed' ? 'Try Different Amount' : 'Cancel'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="upi-payment-container">
      {error && (
        <div className="alert alert-error" style={{ marginBottom: '1rem', whiteSpace: 'pre-line' }}>{error}</div>
      )}

      {step === 'select' && (
        <div className="upi-amount-selector">
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>
            {type === 'registration' ? 'Select Registration Plan' : 'Select Topup Amount'}
          </h3>
          <div className="upi-amount-grid">
            {TOPUP_AMOUNTS.map((opt) => (
              <button key={opt.amount} type="button"
                className={`upi-amount-card${selectedAmount === opt.amount ? ' selected' : ''}`}
                onClick={() => { setSelectedAmount(opt.amount); setError(''); }}
                style={{
                  padding: '0.75rem 1rem',
                  border: selectedAmount === opt.amount ? '2px solid var(--primary)' : '2px solid var(--border)',
                  borderRadius: '12px',
                  background: selectedAmount === opt.amount ? 'var(--primary-bg, rgba(99,102,241,0.08))' : 'transparent',
                  cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s',
                  fontWeight: selectedAmount === opt.amount ? 700 : 500,
                }}>
                <div style={{ fontSize: '1.1rem' }}>₹{opt.amount}</div>
                <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '0.15rem' }}>{opt.label}</div>
              </button>
            ))}
          </div>

          {selectedAmount && (
            <div style={{ marginTop: '1rem' }}>
              {showAppSelector && deviceInfo?.isMobile && (
                <div style={{ marginBottom: '1rem' }}>
                  <p style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', textAlign: 'center' }}>
                    Choose your UPI app:
                  </p>
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                    {deviceInfo.apps.filter(a => !a.universal).map(app => (
                      <button key={app.id} type="button"
                        onClick={() => createUPIOrderAndPay(app.id)}
                        disabled={verifying}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '0.4rem',
                          padding: '0.5rem 0.75rem', borderRadius: '8px',
                          border: '1px solid var(--border)', background: 'white',
                          cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500,
                        }}>
                        <span style={{
                          width: 24, height: 24, borderRadius: '50%',
                          background: app.color, color: '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '0.65rem', fontWeight: 700,
                        }}>{app.icon}</span>
                        {app.name}
                      </button>
                    ))}
                  </div>
                  <button type="button"
                    onClick={() => createUPIOrderAndPay('GENERIC')}
                    disabled={verifying}
                    style={{
                      display: 'block', margin: '0.5rem auto 0',
                      padding: '0.4rem 1rem', borderRadius: '6px',
                      border: '1px dashed var(--border)', background: 'transparent',
                      cursor: 'pointer', fontSize: '0.8rem', color: 'var(--muted)',
                    }}>
                    Other UPI App
                  </button>
                </div>
              )}
              {(!deviceInfo?.isMobile || !showAppSelector) && (
                <button type="button"
                  className={`btn btn-primary w-full${verifying ? ' btn-loading' : ''}`}
                  onClick={() => createUPIOrderAndPay('GENERIC')}
                  disabled={verifying}
                  style={{ marginTop: '0.5rem' }}>
                  {verifying ? 'Creating order...' : `Pay ₹${selectedAmount} via UPI`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
