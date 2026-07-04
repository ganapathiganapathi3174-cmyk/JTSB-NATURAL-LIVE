import { useState, useEffect, useRef } from 'react';
import MobilePaymentOption from './MobilePaymentOption.jsx';

const TEST_MODE = import.meta.env.VITE_TEST_MODE === 'true' || true;

const REG_AMOUNTS = [
  { amount: 120, label: 'Basic Access' },
  { amount: 500, label: 'Premium Access' },
  { amount: 1000, label: 'VIP Access' },
  ...(TEST_MODE ? [{ amount: 1, label: 'Test Payment' }] : []),
];

const TOPUP_AMOUNTS = [
  { amount: 120, label: 'Basic Topup' },
  { amount: 500, label: 'Standard Topup' },
  { amount: 1000, label: 'Premium Topup' },
  ...(TEST_MODE ? [{ amount: 1, label: 'Test Topup' }] : []),
];

const FUNCTIONS_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';
const UPI_POLL_INTERVAL = 5000;
const UPI_POLL_TIMEOUT = 30 * 60 * 1000;

export default function UpiPayment({ type, pendingRegId, userId, onSuccess, onError }) {
  const AMOUNT_OPTIONS = type === 'registration' ? REG_AMOUNTS : TOPUP_AMOUNTS;

  const [selectedAmount, setSelectedAmount] = useState(null);
  const [step, setStep] = useState('select');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [upiOrderId, setUpiOrderId] = useState(null);
  const [upiIntentUrl, setUpiIntentUrl] = useState(null);
  const [upiStatus, setUpiStatus] = useState(null);
  const [polling, setPolling] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('upi');

  const pollTimerRef = useRef(null);
  const pollStartRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  async function createUPIOrderAndPay() {
    setError('');
    if (!selectedAmount) { setError('Please select an amount'); return; }
    setVerifying(true);
    try {
      const body = { type, amount: selectedAmount };
      if (type === 'registration') { if (!pendingRegId) { setError('Registration session expired. Please refresh.'); setVerifying(false); return; } body.pendingRegId = pendingRegId; }
      else { if (!userId) { setError('User session not found. Please login again.'); setVerifying(false); return; } body.userId = userId; }

      const resp = await fetch(`${FUNCTIONS_BASE}/createUPIOrder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to create payment order');

      setUpiOrderId(data.orderId);
      setUpiIntentUrl(data.upiIntentUrl);

      if (data.upiIntentUrl) {
        window.location.href = data.upiIntentUrl;
      }

      setPolling(true);
      setUpiStatus('PENDING');
      setStep('upi_poll');
      pollStartRef.current = Date.now();
      startPolling(data.orderId);
    } catch (err) {
      setError(err.message || 'Failed to create payment order');
      if (onError) onError(err.message);
    } finally { setVerifying(false); }
  }

  function startPolling(orderId) {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = setTimeout(async () => {
      try {
        const resp = await fetch(`${FUNCTIONS_BASE}/getUPIOrderStatus?orderId=${encodeURIComponent(orderId)}`);
        if (!resp.ok) return;
        const data = await resp.json();
        setUpiStatus(data.status);

        if (data.status === 'SUCCESS') {
          setPolling(false);
          setStep('success');
          if (onSuccess) onSuccess(data);
          return;
        }
        if (data.status === 'FAILED') {
          setPolling(false);
          setError('Payment failed. Please try again.');
          return;
        }
        if (data.status === 'EXPIRED') {
          setPolling(false);
          setError('Payment time expired. You can retry by clicking the button below.');
          return;
        }
        if (Date.now() - pollStartRef.current > UPI_POLL_TIMEOUT) {
          setPolling(false);
          setError('Payment confirmation timed out. Please check your payment status.');
          return;
        }
        startPolling(orderId);
      } catch { startPolling(orderId); }
    }, UPI_POLL_INTERVAL);
  }

  async function retryUPIOrder() {
    if (!upiOrderId) { createUPIOrderAndPay(); return; }
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

      if (data.upiIntentUrl) {
        window.location.href = data.upiIntentUrl;
      }

      setPolling(true);
      setUpiStatus('PENDING');
      setStep('upi_poll');
      pollStartRef.current = Date.now();
      startPolling(data.orderId);
    } catch (err) { setError(err.message || 'Retry failed'); }
    finally { setVerifying(false); }
  }

  function handleReset() {
    setStep('select');
    setSelectedAmount(null);
    setUpiOrderId(null);
    setUpiIntentUrl(null);
    setUpiStatus(null);
    setPolling(false);
    setError('');
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
  }

  if (step === 'success') {
    return (
      <div style={{ textAlign: 'center', padding: '1rem 0' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--success)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', margin: '0 auto 1rem' }}>✓</div>
        <h3 style={{ margin: 0 }}>Payment Successful!</h3>
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          {type === 'registration'
            ? 'Your registration payment has been confirmed. You can now login to your account.'
            : 'Your wallet has been credited. You can view your updated balance in the dashboard.'}
        </p>
      </div>
    );
  }

  if (step === 'upi_poll') {
    return (
      <div style={{ textAlign: 'center', padding: '1rem 0' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', margin: '0 auto 1rem', animation: 'pulse 1.5s infinite' }}>⏳</div>
        <h3 style={{ margin: 0 }}>Waiting for Payment</h3>
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          Please complete the payment in your UPI app.
          {upiIntentUrl && (
            <><br /><button type="button" className="btn btn-sm" style={{ marginTop: '0.5rem' }} onClick={() => window.location.href = upiIntentUrl}>Open UPI App</button></>
          )}
        </p>
        {upiStatus && (
          <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
            Status: <strong>{upiStatus}</strong>
            {polling && <span style={{ color: 'var(--muted)' }}> (checking...)</span>}
          </p>
        )}
        <button type="button" className="btn btn-ghost" style={{ marginTop: '1rem' }} onClick={retryUPIOrder}>
          Retry Payment
        </button>
        <button type="button" className="btn btn-ghost" style={{ marginTop: '0.5rem', fontSize: '0.85rem' }} onClick={handleReset}>
          Cancel
        </button>
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
            {type === 'registration' ? 'Registration Fee' : 'Select Topup Amount'}
          </h3>
          <div className="upi-amount-grid">
            {AMOUNT_OPTIONS.map((opt) => (
              <button key={opt.amount} type="button" className={`upi-amount-card${selectedAmount === opt.amount ? ' selected' : ''}`}
                onClick={() => { setSelectedAmount(opt.amount); setError(''); }}
                style={{ padding: '0.75rem 1rem', border: selectedAmount === opt.amount ? '2px solid var(--primary)' : '2px solid var(--border)', borderRadius: '12px', background: selectedAmount === opt.amount ? 'var(--primary-bg, rgba(99,102,241,0.08))' : 'transparent', cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s', fontWeight: selectedAmount === opt.amount ? 700 : 500 }}>
                <div style={{ fontSize: '1.1rem' }}>₹{opt.amount}</div>
                <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '0.15rem' }}>{opt.label}</div>
              </button>
            ))}
          </div>

          {selectedAmount && (
            <div style={{ marginTop: '0.75rem' }}>
              <div className="payment-method-tabs">
                <button type="button" className={`payment-method-tab${paymentMethod === 'upi' ? ' active' : ''}`}
                  onClick={() => setPaymentMethod('upi')}>
                  <span className="tab-icon">📱</span> Pay via UPI
                </button>
                <button type="button" className={`payment-method-tab${paymentMethod === 'mobile' ? ' active' : ''}`}
                  onClick={() => setPaymentMethod('mobile')}>
                  <span className="tab-icon">📞</span> Pay via Mobile
                </button>
              </div>

              {paymentMethod === 'upi' && (
                <button type="button" className={`btn btn-primary w-full${verifying ? ' btn-loading' : ''}`} onClick={createUPIOrderAndPay} disabled={verifying}>
                  {verifying ? 'Creating order...' : `Pay ₹${selectedAmount} via UPI`}
                </button>
              )}

              {paymentMethod === 'mobile' && (
                <MobilePaymentOption
                  type={type}
                  amount={selectedAmount}
                  pendingRegId={pendingRegId}
                  userId={userId}
                  onSuccess={onSuccess}
                  onError={onError}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}