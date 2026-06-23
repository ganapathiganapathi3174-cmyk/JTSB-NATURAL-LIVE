import { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';

const DEFAULT_UPI_ID = 'jayarajj126-3@okicici';
const DEFAULT_PAYEE_NAME = 'Jayaraj';

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

const FUNCTIONS_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';

export default function UpiPayment({ type, pendingRegId, userId, onSuccess, onError }) {
  const AMOUNT_OPTIONS = type === 'registration' ? REG_AMOUNTS : TOPUP_AMOUNTS;

  const [selectedAmount, setSelectedAmount] = useState(null);
  const [step, setStep] = useState('select');
  const [utr, setUtr] = useState('');
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [screenshotFile, setScreenshotFile] = useState(null);
  const [screenshotPreview, setScreenshotPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState('');

  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);
  const copyTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);
  const upiUri = selectedAmount
    ? `upi://pay?pa=${DEFAULT_UPI_ID}&pn=${encodeURIComponent(DEFAULT_PAYEE_NAME)}&am=${selectedAmount}&cu=INR`
    : '';

  useEffect(() => {
    if (canvasRef.current && upiUri) {
      QRCode.toCanvas(canvasRef.current, upiUri, {
        width: 220,
        margin: 2,
        color: { dark: '#ffffff', light: '#000000' },
      }).catch(() => {});
    }
  }, [upiUri]);

  useEffect(() => {
    return () => {
      if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
    };
  }, [screenshotPreview]);

  const handleCopyUpiId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(DEFAULT_UPI_ID);
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {}
  }, []);

  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('Screenshot must be under 10 MB');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }
    setScreenshotFile(file);
    setScreenshotPreview(URL.createObjectURL(file));
    setError('');
    setScreenshotUrl('');
  }

  async function uploadScreenshotViaApi(file) {
    setUploading(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result;
          const data = result.split(',')[1];
          resolve(data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const resp = await fetch(`${FUNCTIONS_BASE}/uploadScreenshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, fileName: file.name }),
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || 'Upload failed');
      }

      const data = await resp.json();
      setScreenshotUrl(data.url);
      return data.url;
    } catch (e) {
      throw new Error('Failed to upload screenshot: ' + e.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleVerify() {
    setError('');
    if (!selectedAmount) { setError('Please select an amount'); return; }
    if (!screenshotFile) { setError('Please upload your payment screenshot'); return; }
    const utrTrimmed = utr.trim();
    if (!utrTrimmed) { setError('Please enter the transaction reference (UTR)'); return; }
    if (utrTrimmed.length < 4) { setError('Transaction reference must be at least 4 characters'); return; }
    if (!paymentDate) { setError('Please enter the payment date'); return; }

    setVerifying(true);

    try {
      const uploadedUrl = screenshotUrl || await uploadScreenshotViaApi(screenshotFile);
      if (!uploadedUrl) throw new Error('Screenshot upload failed');

      const body = {
        type,
        amount: selectedAmount,
        utr: utrTrimmed,
        paymentDate,
        upiId: DEFAULT_UPI_ID,
        screenshotUrl: uploadedUrl,
      };

      if (type === 'registration') {
        if (!pendingRegId) { setError('Registration session expired. Please refresh and try again.'); setVerifying(false); return; }
        body.pendingRegId = pendingRegId;
      } else {
        if (!userId) { setError('User session not found. Please login again.'); setVerifying(false); return; }
        body.userId = userId;
      }

      const resp = await fetch(`${FUNCTIONS_BASE}/verifyUPIPayment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });

      const data = await resp.json();

      if (!resp.ok) {
        const errMsg = data.errors?.length > 0 ? data.errors.join('. ') : (data.error || 'Verification failed');
        throw new Error(errMsg);
      }

      setStep('success');
      if (onSuccess) onSuccess(data);
    } catch (err) {
      const msg = err.message || 'Verification failed';
      setError(msg);
      if (onError) onError(msg);
    } finally {
      setVerifying(false);
    }
  }

  function handleReset() {
    setStep('select');
    setSelectedAmount(null);
    setUtr('');
    setPaymentDate(new Date().toISOString().split('T')[0]);
    setScreenshotFile(null);
    setScreenshotPreview(null);
    setScreenshotUrl('');
    setError('');
  }

  if (step === 'success') {
    return (
      <div style={{ textAlign: 'center', padding: '1rem 0' }}>
        <div
          style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'var(--success)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.5rem', margin: '0 auto 1rem',
          }}
        >✓</div>
        <h3 style={{ margin: 0 }}>Payment Submitted!</h3>
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          {type === 'registration'
            ? 'Your registration payment has been submitted. You will be able to login after verification.'
            : 'Your topup request has been submitted. Wallet will be updated after verification.'}
        </p>
      </div>
    );
  }

  return (
    <div className="upi-payment-container">
      {error && (
        <div className="alert alert-error" style={{ marginBottom: '1rem', whiteSpace: 'pre-line' }}>
          {error}
        </div>
      )}

      {step === 'select' && (
        <div className="upi-amount-selector">
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>
            {type === 'registration' ? 'Registration Fee' : 'Select Topup Amount'}
          </h3>
          <div className="upi-amount-grid">
            {AMOUNT_OPTIONS.map((opt) => (
              <button
                key={opt.amount}
                type="button"
                className={`upi-amount-card${selectedAmount === opt.amount ? ' selected' : ''}`}
                onClick={() => {
                  setSelectedAmount(opt.amount);
                  setError('');
                  setStep('qr');
                }}
                style={{
                  padding: '0.75rem 1rem',
                  border: selectedAmount === opt.amount ? '2px solid var(--primary)' : '2px solid var(--border)',
                  borderRadius: '12px',
                  background: selectedAmount === opt.amount ? 'var(--primary-bg, rgba(99,102,241,0.08))' : 'transparent',
                  cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s',
                  fontWeight: selectedAmount === opt.amount ? 700 : 500,
                }}
              >
                <div style={{ fontSize: '1.1rem' }}>₹{opt.amount}</div>
                <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '0.15rem' }}>{opt.label}</div>
              </button>
            ))}
          </div>
          <p className="muted" style={{ textAlign: 'center', marginTop: '0.75rem', fontSize: '0.85rem' }}>
            Select an amount to continue
          </p>
        </div>
      )}

      {step === 'qr' && selectedAmount && (
        <>
          <div className="upi-qr-section" style={{ textAlign: 'center' }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Pay ₹{selectedAmount}</h3>
            <div style={{ display: 'inline-block', padding: '8px', background: '#fff', borderRadius: '12px' }}>
              <canvas ref={canvasRef} style={{ width: 220, height: 220, display: 'block' }} />
            </div>
            <p style={{ margin: '0.75rem 0 0.25rem', fontSize: '0.85rem', color: 'var(--muted)' }}>
              Scan with any UPI app
            </p>
            <div
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.5rem 1rem', background: 'var(--surface, #f8f8f8)',
                borderRadius: '8px', fontSize: '0.95rem', fontFamily: 'monospace',
              }}
            >
              <span>{DEFAULT_UPI_ID}</span>
              <button type="button" onClick={handleCopyUpiId}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--primary)', fontSize: '0.8rem', padding: '0.25rem 0.5rem',
                }}
              >{copied ? 'Copied!' : 'Copy'}</button>
            </div>
          </div>

          <div className="upi-upload-section" style={{ marginTop: '1.25rem' }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Upload Payment Screenshot</h3>
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: '2px dashed var(--border, #d1d5db)', borderRadius: '12px',
                padding: '2rem 1rem', textAlign: 'center', cursor: 'pointer',
                background: screenshotPreview ? 'var(--surface, #f8f8f8)' : 'transparent',
                transition: 'all 0.2s',
              }}
            >
              {screenshotPreview ? (
                <div>
                  <img src={screenshotPreview} alt="Screenshot preview"
                    style={{ maxHeight: 200, maxWidth: '100%', borderRadius: '8px', marginBottom: '0.5rem' }} />
                  <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: 0 }}>
                    Tap to change screenshot
                  </p>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.5 }}>📷</div>
                  <p style={{ margin: 0, fontWeight: 600 }}>Tap to upload screenshot</p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
                    Upload the payment confirmation from your UPI app
                  </p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
            </div>
          </div>

          <div className="upi-verify-section" style={{ marginTop: '1.25rem' }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Verification Details</h3>
            <div className="field">
              <label>Transaction Reference (UTR) *</label>
              <input
                value={utr}
                onChange={(e) => setUtr(e.target.value)}
                placeholder="Enter UTR from your UPI app"
                style={{ fontFamily: 'monospace' }}
              />
            </div>
            <div className="field">
              <label>Payment Date *</label>
              <input
                type="date" value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
              />
            </div>
            <button
              type="button"
              className={`btn btn-primary w-full${(verifying || uploading) ? ' btn-loading' : ''}`}
              onClick={handleVerify}
              disabled={verifying || uploading || !utr.trim() || !screenshotFile}
              style={{ marginTop: '0.5rem' }}
            >
              {uploading ? 'Uploading screenshot...' : verifying ? 'Verifying...' : 'Verify Payment'}
            </button>
            <button
              type="button"
              className="btn btn-ghost w-full"
              onClick={handleReset}
              style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}
              disabled={verifying || uploading}
            >
              Back to amount selection
            </button>
          </div>
        </>
      )}
    </div>
  );
}
