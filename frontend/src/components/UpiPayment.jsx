import { useState, useEffect, useRef } from 'react';
import QrCodeDisplay from './QrCodeDisplay.jsx';

const FUNCTIONS_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';
const ADMIN_UPI = 'jayarajj126-3@okicici';
const MERCHANT_NAME = 'StarlightAscent';
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
        signal: AbortSignal.timeout(120000),
      });

      // Safe JSON parsing — never show "Unexpected token" errors
      let data;
      const contentType = resp.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await resp.json();
      } else {
        const textBody = await resp.text();
        console.error('[UPI-PAYMENT] Non-JSON response:', resp.status, textBody.substring(0, 200));
        throw new Error(textBody.substring(0, 200) || 'Server returned an invalid response. Please try again.');
      }
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
      <div className="flex flex-col items-center py-4 animate-fade-in-up">
        <div className="flex-center" style={{ width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg, #4ADE80, #22C55E)', color: '#fff', fontSize: '1.75rem', margin: '0 auto 1.25rem', boxShadow: '0 0 30px rgba(74,222,128,0.3)' }}>&#10003;</div>
        <h3 className="text-gradient-success" style={{ margin: 0, fontSize: '1.25rem' }}>Payment Verified!</h3>
        <p className="text-muted mt-sm" style={{ lineHeight: 1.6 }}>
          {type === 'registration' ? 'Your registration payment has been verified. You can now login.' : 'Your wallet has been credited.'}
        </p>
        {verifyResult?.verificationScore != null && <p className="text-sm" style={{ color: '#4ADE80', marginTop: '0.25rem' }}>Score: {verifyResult.verificationScore}%</p>}
        {verifyResult?.userUtrMatched != null && <p className="text-sm text-muted mt-xs">UTR Match: {verifyResult.userUtrMatched ? '\u2713' : '\u2715'}</p>}
      </div>
    );
  }

  if (step === 'progress') {
    return (
      <div className="animate-fade-in-up" style={{ padding: '1rem 0' }}>
        <h3 className="text-sm text-muted text-center mb-md" style={{ fontSize: '0.95rem' }}>AI Verification In Progress</h3>
        <div className="verification-timeline" style={{ maxWidth: 320, margin: '0 auto' }}>
          {PROGRESS_STEPS.map((label, i) => {
            const isActive = i === progressIndex;
            const isDone = i < progressIndex;
            return (
              <div key={i} className="timeline-step" style={{ opacity: isDone || isActive ? 1 : 0.35 }}>
                <div className={`timeline-dot${isDone ? ' completed' : isActive ? ' active' : ''}`} style={{ animation: isActive ? 'pulse 1.5s infinite' : 'none' }} />
                <span className="text-sm" style={{ fontWeight: isActive ? 600 : 400, color: isDone ? 'var(--emerald-300)' : isActive ? 'var(--text)' : 'var(--text-secondary)' }}>{label}</span>
              </div>
            );
          })}
        </div>
        {error && (
          <div className="alert alert-error mt-md">{error}</div>
        )}
      </div>
    );
  }

  if (verifyResult && (verifyResult.status === 'rejected' || verifyResult.status === 'error')) {
    const isRejected = verifyResult.status === 'rejected';
    const isError = verifyResult.status === 'error';
    return (
      <div className="flex flex-col items-center py-4 animate-fade-in-up">
        <div className="flex-center" style={{ width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg, #FB7185, #F43F5E)', color: '#fff', fontSize: '1.75rem', margin: '0 auto 1.25rem', boxShadow: '0 0 30px rgba(251,113,133,0.3)' }}>
          {isError ? '!' : '\u2715'}
        </div>
        <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#FB7185' }}>{isError ? 'Verification Failed' : 'Payment Rejected'}</h3>
        {(verifyResult.reasons?.length > 0) && (
          <div className="flex flex-wrap justify-center gap-xs mt" style={{ maxWidth: 400 }}>
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
                <span key={i} className="chip" style={{ background: isRejected || isError ? 'rgba(251,113,133,0.08)' : 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,113,133,0.15)' }}>
                  {userFriendly}
                </span>
              );
            })}
          </div>
        )}
        {verifyResult.verificationScore != null && <p className="text-sm text-muted mt-sm">Score: {verifyResult.verificationScore}%</p>}
        {verifyResult?.userUtrMatched != null && <p className="text-sm text-muted mt-xs">UTR Match: {verifyResult.userUtrMatched ? '\u2713' : '\u2715'}</p>}
        {verifyResult?.userEnteredUtr && verifyResult?.ocrData?.extractedUtr && !verifyResult.userUtrMatched && (
          <p className="text-sm mt-xs" style={{ color: '#FB7185' }}>Entered: {verifyResult.userEnteredUtr} | SMS: {verifyResult.ocrData.extractedUtr}</p>
        )}
        <div className="flex gap-sm justify-center mt-lg flex-wrap">
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
          <div className="alert alert-error mb-md">{error}</div>
        )}

        <div className="card card-body text-center mb-md">
          <h3 className="mb" style={{ fontSize: '1rem' }}>Pay <span className="text-gradient">&#8377;{selectedAmount}</span></h3>
          <p className="text-muted text-sm mb-md">Scan QR or tap an app to pay</p>

          <div className="flex-center mb-md">
            <QrCodeDisplay value={intentUri} size={180} />
          </div>

          <div className="grid-2 mb-md">
            {UPI_APPS.map(app => (
              <a key={app.id} href={buildAppDeeplink(intentUri, app.scheme)} rel="noopener noreferrer"
                className="btn"
                style={{
                  background: app.color,
                  color: '#fff',
                  border: 'none',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  padding: '0.5rem 0.75rem',
                  flexDirection: 'column',
                  gap: '0.375rem',
                  height: 'auto',
                  minHeight: 52,
                  borderRadius: 'var(--radius-md)',
                  textDecoration: 'none',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = 'none'; }}>
                <span className="badge badge-xs" style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: 'rgba(255,255,255,0.2)',
                  color: '#fff',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '0.7rem',
                  padding: 0,
                }}>{app.icon}</span>
                {app.name}
              </a>
            ))}
          </div>

          <div className="flex items-center justify-center gap-sm mb-md">
            <code className="text-sm" style={{ padding: '0.4rem 0.75rem', background: 'var(--surface-2)', borderRadius: 6, userSelect: 'all', color: 'var(--accent)' }}>{ADMIN_UPI}</code>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard.writeText(ADMIN_UPI); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <button type="button" className="btn btn-primary w-full btn-lg" onClick={() => setStep('verify')}>
            I've Paid &mdash; Upload SMS Screenshot &rarr;
          </button>
        </div>
      </div>
    );
  }

  if (step === 'verify') {
    return (
      <div className="animate-fade-in-up">
        {error && (
          <div className="alert alert-error mb-md">{error}</div>
        )}

        <div className="card card-body mb-md">
          <h3 className="text-center mb">Upload Bank SMS Screenshot</h3>
          <p className="text-muted text-sm text-center mb-md" style={{ lineHeight: 1.6 }}>
            Paid <strong>&#8377;{selectedAmount}</strong> to <strong style={{ userSelect: 'all' }}>{ADMIN_UPI}</strong>? Upload your bank SMS screenshot below to verify.
          </p>

          <div className="card-dim mb-md">
            <div className="text-sm font-semibold mb-xs">Selected Amount</div>
            <div className="text-xl font-bold text-gradient">&#8377;{selectedAmount}</div>
          </div>

          <div className="card-dim mb-md">
            <div className="text-sm font-semibold mb-xs">Order ID</div>
            <code style={{ userSelect: 'all' }}>{orderId}</code>
          </div>

          <div className="field-glass">
            <label className="text-sm font-semibold mb-xs" style={{ display: 'block' }}>Upload Bank SMS Screenshot *</label>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange}
              style={{ padding: '0.7rem', fontSize: '0.85rem', cursor: 'pointer' }} />
          </div>
          {screenshotPreview && (
            <div className="mb" style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--glass-border)' }}>
              <img src={screenshotPreview} alt="Screenshot Preview" style={{ maxWidth: '100%', maxHeight: 200, display: 'block' }} />
            </div>
          )}

          <div className="field-glass">
            <label className="text-sm font-semibold mb-xs" style={{ display: 'block' }}>Transaction Reference / UTR *</label>
            <input type="text" value={utr} onChange={e => setUtr(e.target.value)} placeholder="Enter the UTR number from your SMS"
              className="font-mono" />
          </div>

          <button type="button" className={`btn btn-primary w-full btn-lg${verifying ? ' btn-loading' : ''}`} onClick={handleVerify} disabled={verifying}>
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
        <div className="alert alert-error mb-md">{error}</div>
      )}

      <h3 className="text-center mb-md" style={{ fontSize: '1rem' }}>
        {type === 'registration' ? 'Select Your Plan' : 'Select Topup Amount'}
      </h3>

      <div className="grid-2">
        {AMOUNT_OPTIONS.map((opt) => (
          <button key={opt.amount} type="button" disabled={creatingOrder} onClick={() => handleAmountSelect(opt.amount)}
            className={`card card-body text-center${creatingOrder && selectedAmount === opt.amount ? '' : ' card-hover'}`}
            style={{
              cursor: creatingOrder ? 'default' : 'pointer',
              border: selectedAmount === opt.amount ? '2px solid var(--primary)' : '2px solid var(--border)',
              opacity: creatingOrder && selectedAmount === opt.amount ? 0.6 : 1,
              transition: 'all 0.2s ease',
            }}>
            <div className="text-xl font-bold text-gradient mb-xs">&#8377;{opt.amount}</div>
            <div className="text-sm text-muted">{opt.label}</div>
            {creatingOrder && selectedAmount === opt.amount && (
              <div className="mt-sm" style={{ height: 3, background: 'linear-gradient(90deg, var(--primary), var(--violet-600))', borderRadius: 2, animation: 'shimmer 1s infinite' }} />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
