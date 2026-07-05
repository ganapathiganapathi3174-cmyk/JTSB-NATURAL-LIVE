import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import MobilePaymentOption from './MobilePaymentOption.jsx';

const FUNCTIONS_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';
const ADMIN_UPI = '9655897523@ptyes';

export default function UpiPayment({ type, pendingRegId, userId, onSuccess, onError }) {
  const [selectedAmount, setSelectedAmount] = useState(null);
  const [step, setStep] = useState('select');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [orderId, setOrderId] = useState(null);
  const [screenshot, setScreenshot] = useState(null);
  const [screenshotPreview, setScreenshotPreview] = useState(null);
  const [verifyStatus, setVerifyStatus] = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('upi');

  const fileRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  function buildUpiLink(amount) {
    const encoded = encodeURIComponent(`upi://pay?pa=${ADMIN_UPI}&pn=Admin&am=${amount}&cu=INR`);
    return encoded;
  }

  async function createOrder() {
    setError('');
    if (!selectedAmount) { setError('Please select an amount'); return; }
    setVerifying(true);
    try {
      const body = { type, amount: selectedAmount };
      if (type === 'registration') {
        if (!pendingRegId) { setError('Registration session expired. Please refresh.'); setVerifying(false); return; }
        body.pendingRegId = pendingRegId;
      } else {
        if (!userId) { setError('User session not found. Please login again.'); setVerifying(false); return; }
        body.userId = userId;
      }

      const resp = await fetch(`${FUNCTIONS_BASE}/createPaymentOrder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to create payment order');

      setOrderId(data.orderId);
      setStep('waiting_payment');
      timerRef.current = setInterval(() => setElapsed(p => p + 1), 60000);
    } catch (err) {
      setError(err.message || 'Failed to create payment order');
      if (onError) onError(err.message);
    } finally { setVerifying(false); }
  }

  async function uploadAndVerify() {
    if (!fileRef.current?.files?.[0]) {
      setError('Please select a screenshot');
      return;
    }
    setError('');
    setVerifying(true);
    setVerifyStatus('uploading');
    try {
      const file = fileRef.current.files[0];
      const reader = new FileReader();
      const dataUrl = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      setVerifyStatus('verifying');
      setScreenshotPreview(dataUrl);

      const resp = await fetch(`${FUNCTIONS_BASE}/submitPaymentProof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, screenshot: dataUrl }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Verification failed');

      setVerifyResult(data);
      setVerifyStatus('complete');

      if (data.status === 'verified' && onSuccess) {
        setTimeout(() => onSuccess(data), 1500);
      }
    } catch (err) {
      setError(err.message || 'Verification failed');
      setVerifyStatus('error');
    } finally { setVerifying(false); }
  }

  async function retry() {
    setError('');
    setVerifyStatus(null);
    setVerifyResult(null);
    setScreenshotPreview(null);
    if (fileRef.current) fileRef.current.value = '';
    try {
      const resp = await fetch(`${FUNCTIONS_BASE}/retryPaymentOrder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Retry failed');
      setStep('waiting_payment');
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => setElapsed(p => p + 1), 60000);
    } catch (err) {
      setError(err.message || 'Retry failed');
    }
  }

  function reset() {
    setStep('select');
    setSelectedAmount(null);
    setOrderId(null);
    setScreenshot(null);
    setScreenshotPreview(null);
    setVerifyStatus(null);
    setVerifyResult(null);
    setError('');
    setElapsed(0);
    if (timerRef.current) clearInterval(timerRef.current);
    if (fileRef.current) fileRef.current.value = '';
  }

  if (step === 'success' || (verifyStatus === 'complete' && verifyResult?.status === 'verified')) {
    return (
      <div style={{ textAlign: 'center', padding: '1rem 0' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#16a34a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', margin: '0 auto 1rem' }}>✓</div>
        <h3 style={{ margin: 0 }}>Payment Verified!</h3>
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          {type === 'registration' ? 'Your registration payment has been verified.' : 'Your wallet has been credited.'}
        </p>
      </div>
    );
  }

  if (step === 'verifying' || verifyStatus === 'verifying' || verifyStatus === 'uploading') {
    const messages = {
      uploading: 'Uploading screenshot...',
      verifying: 'Reading screenshot...',
    };
    return (
      <div style={{ textAlign: 'center', padding: '1rem 0' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#4f46e5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', margin: '0 auto 1rem', animation: 'pulse 1.5s infinite' }}>⏳</div>
        <h3 style={{ margin: 0 }}>{messages[verifyStatus] || 'Verifying Payment...'}</h3>
        <p className="muted" style={{ marginTop: '0.5rem' }}>Please wait while our AI verifies your payment.</p>
      </div>
    );
  }

  if ((step === 'waiting_payment' || step === 'upload_proof') && !verifyResult) {
    return (
      <div style={{ textAlign: 'center', padding: '1rem 0' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#f59e0b', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', margin: '0 auto 1rem' }}>💰</div>
        <h3 style={{ margin: 0 }}>Pay ₹{selectedAmount}</h3>
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          Complete payment to <strong>{ADMIN_UPI}</strong>
        </p>
        {step === 'waiting_payment' && (
          <>
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <a href={"https://p." + ADMIN_UPI.split('@')[1] + "/?pa=" + ADMIN_UPI + "&pn=Admin&am=" + selectedAmount + "&cu=INR"} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">
                Open UPI App
              </a>
              <button type="button" className="btn btn-sm" onClick={() => setStep('upload_proof')}>
                I have paid — Upload Screenshot
              </button>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.75rem' }}>
              After payment, click "I have paid" to upload your screenshot for verification.
            </p>
          </>
        )}
        {step === 'upload_proof' && (
          <div style={{ marginTop: '1rem', textAlign: 'left', maxWidth: 400, margin: '1rem auto' }}>
            <div className="field">
              <label>Upload Payment Screenshot *</label>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  const url = URL.createObjectURL(f);
                  setScreenshotPreview(url);
                  setScreenshot(f);
                }
              }} />
              {screenshotPreview && (
                <img src={screenshotPreview} alt="Preview" style={{ maxWidth: '100%', maxHeight: 200, marginTop: '0.5rem', borderRadius: 8, border: '1px solid var(--border)' }} />
              )}
            </div>
            <button type="button" className={`btn btn-primary w-full${verifying ? ' btn-loading' : ''}`} onClick={uploadAndVerify} disabled={verifying} style={{ marginTop: '0.75rem' }}>
              {verifying ? 'Verifying...' : 'Verify Payment'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setStep('waiting_payment'); setScreenshotPreview(null); }} style={{ marginTop: '0.5rem', display: 'block', margin: '0.5rem auto 0' }}>
              Back
            </button>
          </div>
        )}
        {error && <div className="alert alert-error" style={{ marginTop: '0.75rem' }}>{error}</div>}
        <button type="button" className="btn btn-ghost btn-sm" onClick={reset} style={{ marginTop: '0.5rem', display: 'block', margin: '0.5rem auto 0' }}>
          Cancel
        </button>
      </div>
    );
  }

  if (verifyStatus === 'complete' && verifyResult?.status === 'manual_review') {
    return (
      <div style={{ textAlign: 'center', padding: '1rem 0' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#f59e0b', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', margin: '0 auto 1rem' }}>⏳</div>
        <h3 style={{ margin: 0 }}>Under Manual Review</h3>
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          Your payment is being reviewed by our team. Score: {verifyResult.verificationScore}%
        </p>
        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={retry}>Retry with new screenshot</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>Cancel</button>
        </div>
      </div>
    );
  }

  if (verifyStatus === 'complete' && verifyResult?.status === 'rejected') {
    return (
      <div style={{ textAlign: 'center', padding: '1rem 0' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#ef4444', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', margin: '0 auto 1rem' }}>✗</div>
        <h3 style={{ margin: 0 }}>Payment Rejected</h3>
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          {verifyResult.reasons?.join('. ') || 'Verification failed.'}
        </p>
        <button type="button" className="btn btn-primary btn-sm" onClick={retry} style={{ marginTop: '1rem' }}>Retry with new screenshot</button>
      </div>
    );
  }

  if (step === 'select' || step === 'waiting_payment' || step === 'upload_proof') {
    const REG_AMOUNTS = [
      { amount: 120, label: 'Basic Access' },
      { amount: 500, label: 'Premium Access' },
      { amount: 1000, label: 'VIP Access' },
    ];
    const TOPUP_AMOUNTS = [
      { amount: 120, label: 'Basic Topup' },
      { amount: 500, label: 'Standard Topup' },
      { amount: 1000, label: 'Premium Topup' },
    ];
    const AMOUNT_OPTIONS = type === 'registration' ? REG_AMOUNTS : TOPUP_AMOUNTS;

    return (
      <div className="upi-payment-container">
        {error && <div className="alert alert-error" style={{ marginBottom: '1rem', whiteSpace: 'pre-line' }}>{error}</div>}

        {step === 'select' && (
          <div className="upi-amount-selector">
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>
              {type === 'registration' ? 'Select Registration Plan' : 'Select Topup Amount'}
            </h3>
            <div className="upi-amount-grid">
              {AMOUNT_OPTIONS.map((opt) => (
                <button key={opt.amount} type="button" className={`upi-amount-card${selectedAmount === opt.amount ? ' selected' : ''}`}
                  onClick={() => { setSelectedAmount(opt.amount); setError(''); }}
                  style={{ padding: '0.75rem 1rem', border: selectedAmount === opt.amount ? '2px solid #4f46e5' : '2px solid var(--border)', borderRadius: '12px', background: selectedAmount === opt.amount ? 'rgba(79,70,229,0.08)' : 'transparent', cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s', fontWeight: selectedAmount === opt.amount ? 700 : 500 }}>
                  <div style={{ fontSize: '1.1rem' }}>₹{opt.amount}</div>
                  <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '0.15rem' }}>{opt.label}</div>
                </button>
              ))}
            </div>

            {selectedAmount && (
              <div style={{ marginTop: '0.75rem' }}>
                <div className="payment-method-tabs">
                  <button type="button" className={`payment-method-tab${paymentMethod === 'upi' ? ' active' : ''}`} onClick={() => setPaymentMethod('upi')}>
                    <span className="tab-icon">📱</span> Pay via UPI
                  </button>
                  <button type="button" className={`payment-method-tab${paymentMethod === 'mobile' ? ' active' : ''}`} onClick={() => setPaymentMethod('mobile')}>
                    <span className="tab-icon">📞</span> Pay via Mobile
                  </button>
                </div>

                {paymentMethod === 'upi' && (
                  <button type="button" className={`btn btn-primary w-full${verifying ? ' btn-loading' : ''}`} onClick={createOrder} disabled={verifying} style={{ marginTop: '0.5rem' }}>
                    {verifying ? 'Creating order...' : `Pay ₹${selectedAmount} via UPI`}
                  </button>
                )}

                {paymentMethod === 'mobile' && (
                  <MobilePaymentOption type={type} amount={selectedAmount} pendingRegId={pendingRegId} userId={userId} onSuccess={onSuccess} onError={onError} />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return null;
}
