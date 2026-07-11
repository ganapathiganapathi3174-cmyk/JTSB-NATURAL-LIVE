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

  // Auto-select amount when package-locked to a single option
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
  // Filter to only allowed package if specified
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
    if (!fileRef.current?.files?.[0]) {
      setError('Please upload your bank SMS screenshot');
      return;
    }
    if (!utr.trim()) {
      setError('Please enter the transaction reference / UTR');
      return;
    }

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
      <div style={{ textAlign: 'center', padding: '2rem 0' }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: 'linear-gradient(135deg, #4ADE80, #22C55E)',
          color: '#fff', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: '1.75rem',
          margin: '0 auto 1.25rem', boxShadow: '0 0 30px rgba(74,222,128,0.3)',
        }}>✓</div>
        <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#4ADE80' }}>
          Payment Verified!
        </h3>
        <p style={{ marginTop: '0.5rem', color: 'var(--muted)', lineHeight: 1.6 }}>
          {type === 'registration'
            ? 'Your registration payment has been verified. You can now login.'
            : 'Your wallet has been credited.'}
        </p>
        {verifyResult?.verificationScore != null && (
          <p style={{ fontSize: '0.85rem', color: '#4ADE80', marginTop: '0.25rem' }}>
            Score: {verifyResult.verificationScore}%
          </p>
        )}
        {verifyResult?.userUtrMatched != null && (
          <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
            UTR Match: {verifyResult.userUtrMatched ? '✓' : '✗'}
          </p>
        )}
      </div>
    );
  }

  if (step === 'progress') {
    return (
      <div style={{ padding: '1.5rem 0' }}>
        <h3 style={{ margin: '0 0 1.25rem', fontSize: '1rem', textAlign: 'center', color: 'var(--muted)' }}>
          AI Verification In Progress
        </h3>
        <div style={{ maxWidth: 320, margin: '0 auto' }}>
          {PROGRESS_STEPS.map((label, i) => {
            const isActive = i === progressIndex;
            const isDone = i < progressIndex;
            const isLast = i === PROGRESS_STEPS.length - 1;
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.6rem 0', position: 'relative',
                opacity: isDone || isActive ? 1 : 0.35,
                transition: 'opacity 0.3s',
              }}>
                {!isLast && (
                  <div style={{
                    position: 'absolute', left: '0.6rem', top: '1.4rem',
                    bottom: '-0.4rem', width: '2px',
                    background: isDone ? '#4ADE80' : 'var(--border)',
                    transition: 'background 0.3s',
                  }} />
                )}
                <div style={{
                  width: 20, height: 20, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.65rem', fontWeight: 700, flexShrink: 0,
                  background: isDone ? '#4ADE80' : isActive ? 'var(--accent)' : 'var(--surface-2)',
                  color: isDone || isActive ? '#fff' : 'var(--muted)',
                  border: isDone ? '2px solid #4ADE80' : isActive ? '2px solid var(--accent)' : '2px solid var(--border)',
                  boxShadow: isActive ? '0 0 12px rgba(96,165,250,0.4)' : 'none',
                  transition: 'all 0.3s',
                  animation: isActive ? 'pulse 1.5s infinite' : 'none',
                }}>
                  {isDone ? '✓' : isActive ? '●' : i + 1}
                </div>
                <span style={{
                  fontSize: '0.9rem', fontWeight: isActive ? 600 : 400,
                  color: isDone ? '#4ADE80' : isActive ? 'var(--text)' : 'var(--muted)',
                  transition: 'color 0.3s',
                }}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
        {error && (
          <div style={{
            marginTop: '1rem', padding: '0.75rem 1rem', borderRadius: 8,
            background: 'rgba(251,113,133,0.1)', border: '1px solid rgba(251,113,133,0.2)',
            color: '#FB7185', fontSize: '0.85rem', textAlign: 'center',
          }}>
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
      <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: 'linear-gradient(135deg, #FB7185, #F43F5E)',
          color: '#fff', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: '1.75rem',
          margin: '0 auto 1.25rem',
          boxShadow: '0 0 30px rgba(251,113,133,0.3)',
        }}>
          {isError ? '!' : '✗'}
        </div>
        <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#FB7185' }}>
          {isError ? 'Verification Failed' : 'Payment Rejected'}
        </h3>
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
                <p key={i} style={{
                  margin: '0.25rem 0', fontSize: '0.85rem',
                  color: isRejected || isError ? '#FB7185' : '#FBBF24',
                  background: isRejected || isError
                    ? 'rgba(251,113,133,0.08)'
                    : 'rgba(251,191,36,0.08)',
                  padding: '0.4rem 0.75rem', borderRadius: 6,
                  display: 'inline-block',
                }}>
                  {userFriendly}
                </p>
              );
            })}
          </div>
        )}
        {verifyResult.verificationScore != null && (
          <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.5rem' }}>
            Score: {verifyResult.verificationScore}%
          </p>
        )}
        {verifyResult?.userUtrMatched != null && (
          <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
            UTR Match: {verifyResult.userUtrMatched ? '✓' : '✗'}
          </p>
        )}
        {verifyResult?.userEnteredUtr && verifyResult?.ocrData?.extractedUtr && !verifyResult.userUtrMatched && (
          <p style={{ fontSize: '0.75rem', color: '#FB7185', marginTop: '0.25rem' }}>
            Entered: {verifyResult.userEnteredUtr} | SMS: {verifyResult.ocrData.extractedUtr}
          </p>
        )}
        <div style={{ marginTop: '1.25rem', display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleRetry}>
            Try Again
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={resetAll}>
            Start Over
          </button>
        </div>
      </div>
    );
  }

  if (step === 'pay') {
    const intentUri = buildUpiIntent(ADMIN_UPI, selectedAmount);
    return (
      <div style={{ animation: 'fadeIn 0.3s ease' }}>
        {error && (
          <div className="alert alert-error" style={{ marginBottom: '1rem', whiteSpace: 'pre-line' }}>
            {error}
          </div>
        )}

        <div style={{
          background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)', padding: '1.25rem',
          marginBottom: '1rem',
        }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', textAlign: 'center' }}>
            Pay ₹{selectedAmount}
          </h3>

          <p style={{ fontSize: '0.8rem', color: 'var(--muted)', textAlign: 'center', marginBottom: '1rem' }}>
            Scan QR or tap an app to pay
          </p>

          <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
            <QrCodeDisplay value={intentUri} size={180} />
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
            {UPI_APPS.map(app => (
              <a
                key={app.id}
                href={buildAppDeeplink(intentUri, app.scheme)}
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                  padding: '0.5rem 0.75rem', borderRadius: 8,
                  background: app.color, color: '#fff',
                  textDecoration: 'none', fontSize: '0.8rem', fontWeight: 600,
                  transition: 'transform 0.15s, box-shadow 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = 'none'; }}
              >
                <span style={{
                  width: 22, height: 22, borderRadius: '50%', background: 'rgba(255,255,255,0.2)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.7rem', fontWeight: 700, flexShrink: 0,
                }}>{app.icon}</span>
                {app.name}
              </a>
            ))}
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            justifyContent: 'center', marginBottom: '1rem',
          }}>
            <code style={{
              fontSize: '0.85rem', padding: '0.4rem 0.75rem',
              background: 'var(--surface-2)', borderRadius: 6,
              userSelect: 'all', color: 'var(--accent)',
            }}>{ADMIN_UPI}</code>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { navigator.clipboard.writeText(ADMIN_UPI); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <button
            type="button"
            className="btn btn-primary w-full"
            onClick={() => setStep('verify')}
            style={{ padding: '0.8rem', fontSize: '1rem', fontWeight: 600, borderRadius: 10 }}
          >
            I've Paid — Upload SMS Screenshot →
          </button>
        </div>
      </div>
    );
  }

  if (step === 'verify') {
    return (
      <div style={{ animation: 'fadeIn 0.3s ease' }}>
        {error && (
          <div className="alert alert-error" style={{ marginBottom: '1rem', whiteSpace: 'pre-line' }}>
            {error}
          </div>
        )}

        <div style={{
          background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)', padding: '1.25rem',
          marginBottom: '1rem',
        }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', textAlign: 'center' }}>
            Upload Bank SMS Screenshot
          </h3>

          <p style={{
            fontSize: '0.85rem', color: 'var(--muted)', textAlign: 'center',
            marginBottom: '1.25rem', lineHeight: 1.6,
          }}>
            Paid <strong style={{ color: 'var(--text)' }}>₹{selectedAmount}</strong> to{' '}
            <strong style={{ color: 'var(--accent)', userSelect: 'all' }}>{ADMIN_UPI}</strong>
            ? Upload your bank SMS screenshot below to verify.
          </p>
        </div>

        <div style={{
          background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)', padding: '1.25rem',
        }}>
          <div className="verify-section" style={{ marginBottom: '0.75rem' }}>
            <h4>Selected Amount</h4>
            <p style={{
              fontSize: '1.5rem', fontWeight: 700, margin: 0,
              color: 'var(--accent)',
            }}>
              ₹{selectedAmount}
            </p>
          </div>

          <div className="verify-section" style={{ marginBottom: '0.75rem' }}>
            <h4>Order ID</h4>
            <p style={{
              fontSize: '0.9rem', fontWeight: 500, margin: 0,
              fontFamily: 'monospace', color: 'var(--text)',
              userSelect: 'all',
            }}>
              {orderId}
            </p>
          </div>

          <div className="field" style={{ marginBottom: '0.75rem' }}>
            <label>Upload Bank SMS Screenshot *</label>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              style={{
                background: 'var(--surface-2)',
                border: '1px dashed var(--border)',
                borderRadius: 8, padding: '0.75rem',
                color: 'var(--muted)', fontSize: '0.85rem',
                cursor: 'pointer', width: '100%',
              }}
            />
            {screenshotPreview && (
              <div style={{ marginTop: '0.5rem', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
                <img
                  src={screenshotPreview}
                  alt="Screenshot Preview"
                  style={{ maxWidth: '100%', maxHeight: 200, display: 'block' }}
                />
              </div>
            )}
          </div>

          <div className="field" style={{ marginBottom: '1rem' }}>
            <label>Transaction Reference / UTR *</label>
            <input
              type="text"
              value={utr}
              onChange={e => setUtr(e.target.value)}
              placeholder="Enter the UTR number from your SMS"
              style={{
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '0.7rem 0.85rem',
                color: 'var(--text)', fontSize: '0.9rem',
                width: '100%', fontFamily: 'monospace',
                letterSpacing: '0.02em',
              }}
            />
          </div>

          <button
            type="button"
            className={`btn btn-primary w-full${verifying ? ' btn-loading' : ''}`}
            onClick={handleVerify}
            disabled={verifying}
            style={{
              padding: '0.8rem', fontSize: '1rem', fontWeight: 600,
              borderRadius: 10,
            }}
          >
            {verifying ? 'Verifying...' : 'Verify Payment'}
          </button>
        </div>

        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={resetAll}
          style={{ marginTop: '1rem', display: 'block', marginLeft: 'auto', marginRight: 'auto' }}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="alert alert-error" style={{ marginBottom: '1rem', whiteSpace: 'pre-line' }}>
          {error}
        </div>
      )}

      <div>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', textAlign: 'center' }}>
          {type === 'registration' ? 'Select Your Plan' : 'Select Topup Amount'}
        </h3>

        <div className="upi-amount-grid">
          {AMOUNT_OPTIONS.map((opt) => (
            <button
              key={opt.amount}
              type="button"
              disabled={creatingOrder}
              onClick={() => handleAmountSelect(opt.amount)}
              style={{
                padding: '1rem 0.75rem',
                border: selectedAmount === opt.amount
                  ? '2px solid var(--accent)'
                  : '2px solid var(--border)',
                borderRadius: 'var(--radius)',
                background: selectedAmount === opt.amount
                  ? 'rgba(96,165,250,0.1)'
                  : 'var(--surface)',
                cursor: creatingOrder ? 'default' : 'pointer',
                textAlign: 'center',
                transition: 'all 0.2s',
                fontWeight: selectedAmount === opt.amount ? 700 : 500,
                opacity: creatingOrder && selectedAmount === opt.amount ? 0.6 : 1,
                position: 'relative',
                overflow: 'hidden',
              }}
              onMouseEnter={e => {
                if (!selectedAmount) e.currentTarget.style.borderColor = 'rgba(96,165,250,0.3)';
              }}
              onMouseLeave={e => {
                if (!selectedAmount) e.currentTarget.style.borderColor = 'var(--border)';
              }}
            >
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--accent)' }}>
                ₹{opt.amount}
              </div>
              <div style={{ fontSize: '0.8rem', opacity: 0.7, marginTop: '0.25rem', color: 'var(--muted)' }}>
                {opt.label}
              </div>
              {creatingOrder && selectedAmount === opt.amount && (
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0, height: 3,
                  background: 'linear-gradient(90deg, var(--accent), var(--accent-purple))',
                  animation: 'shimmer 1s infinite',
                }} />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

