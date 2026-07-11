import { useState, useEffect, useRef, useCallback } from 'react';
import QrCodeDisplay from './QrCodeDisplay.jsx';

const FUNCTIONS_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';
const UPI_POLL_INTERVAL = 5000;
const UPI_POLL_TIMEOUT = 30 * 60 * 1000;

const MOBILE_NUMBER = '9655897523';
const UPI_ID = 'jayarajj126-3@okicici';
const MERCHANT_NAME = 'JTSB Natural';

function upiParam(val, keepAt) {
  const s = encodeURIComponent(String(val));
  return keepAt ? s.replace(/%40/g, '@') : s;
}

function buildMobileUpiIntent(amount) {
  return 'upi://pay?pa=' + upiParam(MOBILE_NUMBER + '@upi', true) +
    '&pn=' + upiParam(MERCHANT_NAME) +
    '&am=' + Number(amount).toFixed(2) +
    '&cu=INR';
}

function buildFallbackUpiIntent(amount) {
  return 'upi://pay?pa=' + upiParam(UPI_ID, true) +
    '&pn=' + upiParam(MERCHANT_NAME) +
    '&am=' + Number(amount).toFixed(2) +
    '&cu=INR';
}

function buildAppDeeplink(baseUri, scheme) {
  const qs = baseUri.split('?')[1];
  return scheme + '://pay?' + qs;
}

const UPI_APPS = [
  { id: 'GOOGLE_PAY', name: 'Google Pay', icon: 'G', color: '#4285F4', scheme: 'tez' },
  { id: 'PHONE_PE', name: 'PhonePe', icon: 'P', color: '#5F259F', scheme: 'phonepe' },
  { id: 'PAYTM', name: 'Paytm', icon: 'PT', color: '#00BAF2', scheme: 'paytmmp' },
  { id: 'BHIM', name: 'BHIM', icon: 'B', color: '#1F7A1F', scheme: 'bhim' },
];

export default function MobilePaymentOption({ type, amount, pendingRegId, userId, onSuccess, onError }) {
  const [copied, setCopied] = useState(null);
  const [showQR, setShowQR] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [step, setStep] = useState('idle');
  const [upiOrderId, setUpiOrderId] = useState(null);
  const [upiStatus, setUpiStatus] = useState(null);
  const [polling, setPolling] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState('pending');
  const [statusMessage, setStatusMessage] = useState('Waiting for payment confirmation...');
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);

  const pollTimerRef = useRef(null);
  const pollStartRef = useRef(null);
  const elapsedTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  const startElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    setElapsed(0);
    elapsedTimerRef.current = setInterval(() => setElapsed(p => p + 1), 60000);
  }, []);

  function copyToClipboard(text, label) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(label);
        setTimeout(() => setCopied(null), 2000);
      });
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    }
  }

  async function createOrderAndOpenApp(appId) {
    setError('');
    setVerifying(true);
    try {
      const body = { type, amount };
      if (type === 'registration') body.pendingRegId = pendingRegId;
      else body.userId = userId;

      const resp = await fetch(`${FUNCTIONS_BASE}/createUPIOrder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to create payment order');

      setUpiOrderId(data.orderId);

      const mobileIntent = buildMobileUpiIntent(amount);
      const fallbackIntent = buildFallbackUpiIntent(amount);

      let targetUrl = fallbackIntent;
      if (appId && appId !== 'GENERIC') {
        const app = UPI_APPS.find(a => a.id === appId);
        if (app) {
          targetUrl = buildAppDeeplink(mobileIntent, app.scheme);
        }
      }

      setTimeout(() => {
        try { window.location.href = targetUrl; } catch {}
      }, 300);

      setPolling(true);
      setUpiStatus('PENDING');
      setStep('polling');
      setPaymentStatus('pending');
      setStatusMessage('Payment sent to UPI app. Waiting for confirmation...');
      pollStartRef.current = Date.now();
      startElapsedTimer();
      startPolling(data.orderId);
    } catch (err) {
      setError(err.message || 'Failed to create payment order');
      if (onError) onError(err.message);
    } finally {
      setVerifying(false);
    }
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
        setStatusMessage('Verifying your payment. Please wait. Do not make another payment.');
        startPolling(orderId);
      } catch { startPolling(orderId); }
    }, UPI_POLL_INTERVAL);
  }

  async function handleRetry() {
    if (!upiOrderId) { createOrderAndOpenApp('GENERIC'); return; }
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

      const fallbackIntent = buildFallbackUpiIntent(amount);
      setTimeout(() => {
        try { window.location.href = fallbackIntent; } catch {}
      }, 300);

      setPolling(true);
      setUpiStatus('PENDING');
      setStep('polling');
      setPaymentStatus('pending');
      setStatusMessage('Retrying payment...');
      pollStartRef.current = Date.now();
      startElapsedTimer();
      startPolling(data.orderId);
    } catch (err) {
      setError(err.message || 'Retry failed');
    } finally {
      setVerifying(false);
    }
  }

  function handleReset() {
    setStep('idle');
    setUpiOrderId(null);
    setUpiStatus(null);
    setPolling(false);
    setPaymentStatus('pending');
    setStatusMessage('');
    setShowQR(false);
    setElapsed(0);
    setError('');
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
  }

  if (step === 'success') {
    return (
      <div style={{ textAlign: 'center', padding: '1rem 0' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--success)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', margin: '0 auto 1rem' }}>✓</div>
        <h3 style={{ margin: 0 }}>Payment Successful!</h3>
        <p className="muted" style={{ marginTop: '0.5rem' }}>Your payment has been confirmed.</p>
      </div>
    );
  }

  if (step === 'polling') {
    const statusColor = paymentStatus === 'approved' ? 'var(--success)' :
      paymentStatus === 'expired' || paymentStatus === 'failed' ? '#ef4444' : 'var(--primary)';

    return (
      <div style={{ textAlign: 'center', padding: '1rem 0' }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: statusColor, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.5rem', margin: '0 auto 1rem',
          animation: paymentStatus === 'pending' ? 'pulse 1.5s infinite' : 'none',
        }}>
          {paymentStatus === 'approved' ? '✓' : paymentStatus === 'expired' || paymentStatus === 'failed' ? '✗' : '⏳'}
        </div>
        <h3 style={{ margin: 0 }}>
          {paymentStatus === 'pending' ? 'Waiting for Payment Verification' :
           paymentStatus === 'approved' ? 'Payment Approved' :
           paymentStatus === 'expired' ? 'Payment Expired' :
           paymentStatus === 'failed' ? 'Payment Failed' : 'Processing...'}
        </h3>
        <p className="muted" style={{ marginTop: '0.75rem', maxWidth: 360, marginLeft: 'auto', marginRight: 'auto' }}>{statusMessage}</p>
        {elapsed > 0 && paymentStatus === 'pending' && (
          <p style={{ fontSize: '0.85rem', color: '#f59e0b', marginTop: '0.5rem' }}>⏱ {elapsed} min elapsed</p>
        )}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '1rem', flexWrap: 'wrap' }}>
          {(paymentStatus === 'expired' || paymentStatus === 'failed') && (
            <button type="button" className="btn btn-primary btn-sm" onClick={handleRetry} disabled={verifying}>
              {verifying ? 'Retrying...' : 'Retry Payment'}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={handleReset}>
            {paymentStatus === 'expired' || paymentStatus === 'failed' ? 'Try Different Method' : 'Cancel'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-payment-option">
      {error && (
        <div className="alert alert-error" style={{ marginBottom: '0.75rem', whiteSpace: 'pre-line' }}>{error}</div>
      )}

      <div className="mobile-number-card">
        <div className="mobile-number-label">Pay via Mobile Number</div>
        <div className="mobile-number-display">{MOBILE_NUMBER}</div>
        <div className="mobile-number-sub">Send to this number via any UPI app</div>
        <div className="mobile-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => copyToClipboard(MOBILE_NUMBER, 'number')}
          >
            {copied === 'number' ? '✓ Copied!' : 'Copy Number'}
          </button>
        </div>
      </div>

      <div className="mobile-app-grid">
        {UPI_APPS.map(app => (
          <button
            key={app.id}
            type="button"
            className="mobile-app-btn"
            onClick={() => createOrderAndOpenApp(app.id)}
            disabled={verifying}
            style={{ '--app-color': app.color }}
          >
            <span className="mobile-app-icon">{app.icon}</span>
            <span className="mobile-app-name">{app.name}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        className={`btn btn-primary w-full${verifying ? ' btn-loading' : ''}`}
        onClick={() => createOrderAndOpenApp('GENERIC')}
        disabled={verifying}
        style={{ marginTop: '0.75rem' }}
      >
        {verifying ? 'Creating order...' : 'Open UPI App'}
      </button>

      <div className="mobile-divider"><span>OR</span></div>

      <div className="mobile-fallback">
        <button
          type="button"
          className="btn btn-ghost btn-sm w-full"
          onClick={() => setShowQR(!showQR)}
        >
          {showQR ? 'Hide QR Code' : 'Show QR Code'}
        </button>

        {showQR && (
          <div className="mobile-qr-section">
            <QrCodeDisplay
              value={buildFallbackUpiIntent(amount)}
              size={180}
            />
            <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.5rem', textAlign: 'center' }}>
              Scan with any UPI app to pay ₹{amount}
            </p>
          </div>
        )}

        <div className="mobile-upi-id-row">
          <div className="mobile-upi-id-label">UPI ID:</div>
          <div className="mobile-upi-id-value">{UPI_ID}</div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => copyToClipboard(UPI_ID, 'upi')}
          >
            {copied === 'upi' ? '✓ Copied!' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
}

