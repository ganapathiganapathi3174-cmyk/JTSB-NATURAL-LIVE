import { useState, useEffect, useRef } from 'react';
import QrCodeDisplay from './QrCodeDisplay.jsx';

const FUNCTIONS_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';
const ADMIN_UPI = 'jayarajj126-3@okicici';
const MERCHANT_NAME = 'JTSB Natural';
const MOBILE_NUMBER = '9655897523';

const PROGRESS_STEPS = [
  'Uploading Screenshot...',
  'Reading Bank SMS...',
  'Extracting Amount...',
  'Extracting UTR...',
  'Checking Amount...',
  'Checking UTR...',
  'Checking Duplicate...',
  'Running Fraud Detection...',
  'Verification Completed.',
];

function upiParam(val, keepAt) {
  const s = encodeURIComponent(String(val));
  return keepAt ? s.replace(/%40/g, '@') : s;
}

function buildUpiIntent(upiId, amount) {
  return 'upi://pay?pa=' + upiParam(upiId, true) +
    '&pn=' + upiParam(MERCHANT_NAME) +
    '&am=' + Number(amount).toFixed(2) +
    '&cu=INR';
}

function buildAppDeeplink(intentUri, scheme) {
  const qs = intentUri.split('?')[1];
  return scheme + '://pay?' + qs;
}

const UPI_APPS = [
  { id: 'GOOGLE_PAY', name: 'Google Pay', icon: 'G', color: '#4285F4', scheme: 'tez' },
  { id: 'PHONE_PE', name: 'PhonePe', icon: 'P', color: '#5F259F', scheme: 'phonepe' },
  { id: 'PAYTM', name: 'Paytm', icon: 'PT', color: '#00BAF2', scheme: 'paytmmp' },
  { id: 'BHIM', name: 'BHIM', icon: 'B', color: '#1F7A1F', scheme: 'bhim' },
];

export default function UpiPayment({ type, pendingRegId, userId, allowedPackage, onSuccess, onError }) {
  const [selectedAmount, setSelectedAmount] = useState(null);
  const [step, setStep] = useState('select');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [orderId, setOrderId] = useState(null);
  const [screenshotFile, setScreenshotFile] = useState(null);
  const [screenshotPreview, setScreenshotPreview] = useState(null);
  const [utr, setUtr] = useState('');
  const [verifyResult, setVerifyResult] = useState(null);
  const [progressIndex, setProgressIndex] = useState(0);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [copied, setCopied] = useState(false);

  const fileRef = useRef(null);
  const timerRef = useRef(null);
  const previewRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (previewRef.current) { URL.revokeObjectURL(previewRef.current); }
    };
  }, []);

  useEffect(() => {
    if (AMOUNT_OPTIONS.length === 1 && !selectedAmount && !creatingOrder) {
      handleAmountSelect(AMOUNT_OPTIONS[0].amount);
    }
  }, [allowedPackage]);

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
  let AMOUNT_OPTIONS = type === 'registration' ? REG_AMOUNTS : TOPUP_AMOUNTS;
  if (allowedPackage && type === 'registration') {
    AMOUNT_OPTIONS = REG_AMOUNTS.filter(o => o.amount === allowedPackage);
  }
  if (allowedPackage && type === 'topup') {
    AMOUNT_OPTIONS = TOPUP_AMOUNTS.filter(o => o.amount === allowedPackage);
  }

  async function handleAmountSelect(amount) {
    setSelectedAmount(amount);
    setError('');
    setCreatingOrder(true);

    try {
      const body = { type, amount };
      if (type === 'registration') {
        if (!pendingRegId) {
          setError('Registration session expired. Please refresh.');
          setCreatingOrder(false);
          setSelectedAmount(null);
          return;
        }
        body.pendingRegId = pendingRegId;
      } else {
        if (!userId) {
          setError('User session not found. Please login again.');
          setCreatingOrder(false);
          setSelectedAmount(null);
          return;
        }
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
      setStep('pay');
    } catch (err) {
      setError(err.message || 'Failed to create payment order');
      setSelectedAmount(null);
      if (onError) onError(err.message);
    } finally {
      setCreatingOrder(false);
    }
  }

  function handleFileChange(e) {
    const f = e.target.files?.[0];
    if (f) {
      setScreenshotFile(f);
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      const url = URL.createObjectURL(f);
      previewRef.current = url;
      setScreenshotPreview(url);
    }
  }

  async function handleVerify() {
    if (!fileRef.current?.files?.[0]) { setError('Please upload your bank SMS screenshot'); return; }
    if (!utr.trim()) { setError('Please enter the transaction reference / UTR'); return; }

    setError('');
    setVerifying(true);
    setStep('progress');
    setProgressIndex(0);

    timerRef.current = setInterval(() => {
      setProgressIndex(prev => Math.min(prev + 1, PROGRESS_STEPS.length - 1));
    }, 1200);

    try {
      const file = fileRef.current.files[0];
      const reader = new FileReader();
      const dataUrl = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      setProgressIndex(1);

      const resp = await fetch(`${FUNCTIONS_BASE}/submitPaymentProof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, screenshot: dataUrl, utr: utr.trim() }),
        signal: AbortSignal.timeout(90000),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Verification failed');

      setVerifyResult(data);
      setProgressIndex(PROGRESS_STEPS.length - 1);

      if (data.status === 'verified' && onSuccess) {
        setTimeout(() => onSuccess(data), 1500);
      }
    } catch (err) {
      setError(err.message || 'Verification failed');
      setVerifyResult({ status: 'error', reasons: [err.message] });
      setProgressIndex(PROGRESS_STEPS.length - 1);
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      setVerifying(false);
    }
  }

  async function handleRetry() {
    setError('');
    setVerifyResult(null);
    setProgressIndex(0);
    setScreenshotPreview(null);
    setScreenshotFile(null);
    setUtr('');
    if (fileRef.current) fileRef.current.value = '';
    setStep('verify');
  }

  function resetAll() {
    if (timerRef.current) clearInterval(timerRef.current);
    setStep('select');
    setSelectedAmount(null);
    setOrderId(null);
    setScreenshotPreview(null);
    setScreenshotFile(null);
    setUtr('');
    setVerifyResult(null);
    setError('');
    setProgressIndex(0);
    if (fileRef.current) fileRef.current.value = '';
  }

  if (step === 'success' || (verifyResult?.status === 'verified')) {
    return (
      <div className="text-center animate-fade-in-up" style={{ padding: '2rem 0' }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg, #4ADE80, #22C55E)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.75rem', margin: '0 auto 1.25rem', boxShadow: '0 0 30px rgba(74,222,128,0.3)' }}>✓</div>
        <h3 style={{ margin: 0, fontSize: '1.25rem' }} className="text-gradient-success">Payment Verified!</h3>
        <p className="text-muted" style={{ marginTop: '0.5rem', lineHeight: 1.6 }}>
          {type === 'registration' ? 'Your registration payment has been verified. You can now login.' : 'Your wallet has been credited.'}
        </p>
        {verifyResult?.verificationScore != null && <p className="text-sm" style={{ color: '#4ADE80', marginTop: '0.25rem' }}>Score: {verifyResult.verificationScore}%</p>}
        {verifyResult?.userUtrMatched != null && <p className="text-sm text-muted" style={{ marginTop: '0.25rem' }}>UTR Match: {verifyResult.userUtrMatched ? '✓' : '✗'}</p>}
      </div>
    );
  }

  if (step === 'progress') {
    return (
      <div className="animate-fade-in-scale" style={{ padding: '1rem 0' }}>
        <h3 style={{ margin: '0 0 1.25rem', fontSize: '0.95rem', textAlign: 'center', color: 'var(--muted)' }}>AI Verification In Progress</h3>
        <div style={{ maxWidth: 320, margin: '0 auto' }}>
          {PROGRESS_STEPS.map((label, i) => {
            const isActive = i === progressIndex;
            const isDone = i < progressIndex;
            const isLast = i === PROGRESS_STEPS.length - 1;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0', position: 'relative', opacity: isDone || isActive ? 1 : 0.35, transition: 'opacity 0.3s' }}>
                {!isLast && (
                  <div style={{ position: 'absolute', left: '0.6rem', top: '1.3rem', bottom: '-0.3rem', width: '2px', background: isDone ? '#4ADE80' : 'var(--border)', transition: 'background 0.3s' }} />
                )}
                <div style={{ width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700, flexShrink: 0, background: isDone ? '#4ADE80' : isActive ? 'var(--accent)' : 'var(--surface-2)', color: isDone || isActive ? '#fff' : 'var(--muted)', border: isDone ? '2px solid #4ADE80' : isActive ? '2px solid var(--accent)' : '2px solid var(--border)', boxShadow: isActive ? '0 0 12px var(--accent-glow)' : 'none', transition: 'all 0.3s', animation: isActive ? 'pulse-soft 1.5s infinite' : 'none' }}>
                  {isDone ? '✓' : isActive ? '●' : i + 1}
                </div>
                <span style={{ fontSize: '0.85rem', fontWeight: isActive ? 600 : 400, color: isDone ? '#4ADE80' : isActive ? 'var(--text)' : 'var(--muted)', transition: 'color 0.3s' }}>{label}</span>
              </div>
            );
          })}
        </div>
        {error && (
          <div className="card-dim mt-md text-center" style={{ background: 'rgba(251,113,133,0.08)', border: '1px solid rgba(251,113,133,0.2)', padding: '0.75rem 1rem', fontSize: '0.85rem', color: '#FB7185' }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  if (verifyResult && (verifyResult.status === 'rejected' || verifyResult.status === 'error')) {
    const isRejected = verifyResult.status === 'rejected';
    const isError = verifyResult.status === 'error';
    return (
      <div className="text-center animate-fade-in-up" style={{ padding: '1.5rem 0' }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg, #FB7185, #F43F5E)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.75rem', margin: '0 auto 1.25rem', boxShadow: '0 0 30px rgba(251,113,133,0.3)' }}>
          {isError ? '!' : '✗'}
        </div>
        <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#FB7185' }}>{isError ? 'Verification Failed' : 'Payment Rejected'}</h3>
        {(verifyResult.reasons?.length > 0) && (
          <div style={{ marginTop: '0.75rem' }}>
            {verifyResult.reasons.map((r, i) => {
              const userFriendly = r
                .replace(/amount_mismatch/i, 'Selected amount does not match payment.')
                .replace(/invalid_utr/i, 'Could not read UTR from the SMS screenshot.')
                .replace(/utr_mismatch/i, 'Entered UTR does not match the SMS.')
                .replace(/duplicate_utr/i, 'This transaction has already been used.')
                .replace(/invalid_bank_sms/i, 'Uploaded screenshot is not a valid bank payment SMS.')
                .replace(/image_quality_failed/i, 'Invalid screenshot. Please upload a clear bank SMS screenshot.')
                .replace(/fraud_detected/i, 'Suspicious activity detected.')
                .replace(/receiver_mismatch/i, 'Payment receiver does not match.')
                .replace(/timeout/i, 'Verification timed out. Please try again.');
              return (
                <div key={i} className="card-dim" style={{ display: 'inline-block', margin: '0.25rem', padding: '0.4rem 0.75rem', fontSize: '0.85rem', background: isRejected || isError ? 'rgba(251,113,133,0.08)' : 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,113,133,0.15)' }}>
                  {userFriendly}
                </div>
              );
            })}
          </div>
        )}
        {verifyResult.verificationScore != null && <p className="text-sm text-muted" style={{ marginTop: '0.5rem' }}>Score: {verifyResult.verificationScore}%</p>}
        {verifyResult?.userUtrMatched != null && <p className="text-sm text-muted" style={{ marginTop: '0.25rem' }}>UTR Match: {verifyResult.userUtrMatched ? '✓' : '✗'}</p>}
        {verifyResult?.userEnteredUtr && verifyResult?.ocrData?.extractedUtr && !verifyResult.userUtrMatched && (
          <p className="text-sm" style={{ color: '#FB7185', marginTop: '0.25rem' }}>Entered: {verifyResult.userEnteredUtr} | SMS: {verifyResult.ocrData.extractedUtr}</p>
        )}
        <div style={{ marginTop: '1.25rem', display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleRetry}>Try Again</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={resetAll}>Start Over</button>
        </div>
      </div>
    );
  }

  if (step === 'pay') {
    const intentUri = buildUpiIntent(ADMIN_UPI, selectedAmount);
    return (
      <div className="animate-fade-in-up">
        {error && (
          <div className="card-dim mb-md" style={{ background: 'var(--danger-light)', border: '1px solid rgba(239,68,68,0.2)', padding: '0.75rem 1rem', fontSize: '0.85rem', color: 'var(--danger)', whiteSpace: 'pre-line' }}>
            {error}
          </div>
        )}

        <div className="surface-card" style={{ padding: '1.25rem', marginBottom: '1rem', textAlign: 'center' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Pay <span className="text-gradient">₹{selectedAmount}</span></h3>
          <p className="text-muted text-sm mb-md">Scan QR or tap an app to pay</p>

          <div style={{ marginBottom: '1rem' }}>
            <QrCodeDisplay value={intentUri} size={180} />
          </div>

          <div className="flex items-center justify-center gap-sm" style={{ flexWrap: 'wrap', marginBottom: '1rem' }}>
            {UPI_APPS.map(app => (
              <a key={app.id} href={buildAppDeeplink(intentUri, app.scheme)} rel="noopener noreferrer"
                className="quick-action" style={{ background: app.color, color: '#fff', border: 'none', fontSize: '0.8rem', fontWeight: 600, padding: '0.5rem 0.75rem' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = 'none'; }}>
                <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700 }}>{app.icon}</span>
                {app.name}
              </a>
            ))}
          </div>

          <div className="flex items-center justify-center gap-sm mb-md">
            <code style={{ fontSize: '0.85rem', padding: '0.4rem 0.75rem', background: 'var(--surface-2)', borderRadius: 6, userSelect: 'all', color: 'var(--accent)' }}>{ADMIN_UPI}</code>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard.writeText(ADMIN_UPI); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <button type="button" className="btn btn-primary w-full" onClick={() => setStep('verify')} style={{ padding: '0.8rem', fontSize: '1rem', fontWeight: 600, borderRadius: 10 }}>
            I've Paid — Upload SMS Screenshot →
          </button>
        </div>
      </div>
    );
  }

  if (step === 'verify') {
    return (
      <div className="animate-fade-in-up">
        {error && (
          <div className="card-dim mb-md" style={{ background: 'var(--danger-light)', border: '1px solid rgba(239,68,68,0.2)', padding: '0.75rem 1rem', fontSize: '0.85rem', color: 'var(--danger)', whiteSpace: 'pre-line' }}>
            {error}
          </div>
        )}

        <div className="surface-card mb-md" style={{ padding: '1.25rem' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', textAlign: 'center' }}>Upload Bank SMS Screenshot</h3>
          <p className="text-muted text-sm text-center" style={{ marginBottom: '1rem', lineHeight: 1.6 }}>
            Paid <strong>₹{selectedAmount}</strong> to <strong style={{ userSelect: 'all' }}>{ADMIN_UPI}</strong>? Upload your bank SMS screenshot below to verify.
          </p>

          <div className="surface-card mb-md">
            <div className="text-sm font-semibold mb-sm">Selected Amount</div>
            <div className="text-xl font-bold text-gradient">₹{selectedAmount}</div>
          </div>

          <div className="surface-card mb-md">
            <div className="text-sm font-semibold mb-sm">Order ID</div>
            <code style={{ userSelect: 'all' }}>{orderId}</code>
          </div>

          <div className="mb-md">
            <label className="text-sm font-semibold mb-sm" style={{ display: 'block' }}>Upload Bank SMS Screenshot *</label>
            <div className="field-glass">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange}
                style={{ padding: '0.7rem', fontSize: '0.85rem', cursor: 'pointer' }} />
            </div>
            {screenshotPreview && (
              <div className="mt-sm" style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--glass-border)' }}>
                <img src={screenshotPreview} alt="Screenshot Preview" style={{ maxWidth: '100%', maxHeight: 200, display: 'block' }} />
              </div>
            )}
          </div>

          <div className="mb-lg">
            <label className="text-sm font-semibold mb-sm" style={{ display: 'block' }}>Transaction Reference / UTR *</label>
            <div className="field-glass">
              <input type="text" value={utr} onChange={e => setUtr(e.target.value)} placeholder="Enter the UTR number from your SMS"
                style={{ fontFamily: 'monospace', letterSpacing: '0.02em' }} />
            </div>
          </div>

          <button type="button" className={`btn btn-primary w-full${verifying ? ' btn-loading' : ''}`} onClick={handleVerify} disabled={verifying}
            style={{ padding: '0.8rem', fontSize: '1rem', fontWeight: 600, borderRadius: 10 }}>
            {verifying ? 'Verifying...' : 'Verify Payment'}
          </button>
        </div>

        <button type="button" className="btn btn-ghost btn-sm" onClick={resetAll} style={{ display: 'block', margin: '1rem auto 0' }}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up">
      {error && (
        <div className="card-dim mb-md" style={{ background: 'var(--danger-light)', border: '1px solid rgba(239,68,68,0.2)', padding: '0.75rem 1rem', fontSize: '0.85rem', color: 'var(--danger)', whiteSpace: 'pre-line' }}>
          {error}
        </div>
      )}

      <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', textAlign: 'center' }}>
        {type === 'registration' ? 'Select Your Plan' : 'Select Topup Amount'}
      </h3>

      <div className="grid-2-sm" style={{ display: 'grid', gap: '0.75rem' }}>
        {AMOUNT_OPTIONS.map((opt) => (
          <button key={opt.amount} type="button" disabled={creatingOrder} onClick={() => handleAmountSelect(opt.amount)}
            className={`stat-card-glass text-center${creatingOrder && selectedAmount === opt.amount ? ' animate-pulse-soft' : ''}`}
            style={{ padding: '1.25rem 0.75rem', cursor: creatingOrder ? 'default' : 'pointer', border: selectedAmount === opt.amount ? '2px solid var(--accent)' : '2px solid transparent', opacity: creatingOrder && selectedAmount === opt.amount ? 0.6 : 1 }}>
            <div className="text-xl font-bold text-gradient" style={{ marginBottom: '0.15rem' }}>₹{opt.amount}</div>
            <div className="text-sm text-muted">{opt.label}</div>
            {creatingOrder && selectedAmount === opt.amount && (
              <div style={{ marginTop: '0.5rem', height: 3, background: 'linear-gradient(90deg, var(--accent), var(--accent-purple))', borderRadius: 2, animation: 'shimmer 1s infinite' }} />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
