import { useState, useRef, useCallback } from 'react';
import QRCode from 'qrcode';

const API_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';

export default function PaymentFlow({ orderId, amount, upiId, upiName, onSuccess, onError }) {
  const [step, setStep] = useState(1); // 1=pay, 2=utr, 3=result
  const [utr, setUtr] = useState('');
  const [screenshotFile, setScreenshotFile] = useState(null);
  const [screenshotPreview, setScreenshotPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const displayUpiId = upiId || 'jayarajj126-3@okicici';
  const displayUpiName = upiName || 'JEYARAJ ALAG';
  const displayAmount = amount || 1;

  const upiUrl = `upi://pay?pa=${encodeURIComponent(displayUpiId)}&pn=${encodeURIComponent(displayUpiName)}&am=${displayAmount}&cu=INR`;

  useState(() => {
    QRCode.toDataURL(upiUrl, { width: 200, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
      .then(setQrDataUrl)
      .catch(() => {});
  }, []);

  const copyUpiId = useCallback(() => {
    navigator.clipboard.writeText(displayUpiId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [displayUpiId]);

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      onError?.('Screenshot must be under 10MB');
      return;
    }
    setScreenshotFile(file);
    const reader = new FileReader();
    reader.onload = () => setScreenshotPreview(reader.result);
    reader.readAsDataURL(file);
  }

  function removeScreenshot() {
    setScreenshotFile(null);
    setScreenshotPreview(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  const utrValid = /^[A-Za-z0-9]{8,30}$/.test(utr.trim());
  const canSubmit = utrValid && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      let screenshotUrl = null;
      if (screenshotFile) {
        screenshotUrl = screenshotPreview;
      }

      const resp = await fetch(`${API_BASE}/submitUtrVerification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          utr: utr.trim(),
          screenshotUrl,
        }),
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Verification failed');

      setResult(data);
      setStep(3);
      if (data.status === 'verified') {
        onSuccess?.(data);
      }
    } catch (err) {
      onError?.(err.message || 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 3 && result) {
    const isApproved = result.status === 'verified';
    const isRejected = result.status === 'rejected';
    return (
      <div className="result-card animate-fade-in-scale">
        <div className={`result-icon ${isApproved ? 'success' : isRejected ? 'failed' : 'pending'}`}>
          {isApproved ? '✓' : isRejected ? '✗' : '⏳'}
        </div>
        <h2 className="font-bold mb-xs" style={{ fontSize: '1.125rem' }}>
          {isApproved ? 'Payment Verified!' : isRejected ? 'Verification Failed' : 'Under Review'}
        </h2>
        <p className="text-sm text-muted" style={{ marginBottom: '1rem' }}>
          {result.message}
        </p>
        {result.checks && (
          <div className="result-checks">
            {result.checks.map((c, i) => (
              <div className="result-check" key={i}>
                <span className={`check-icon ${c.passed ? 'pass' : 'fail'}`}>{c.passed ? '✓' : '✗'}</span>
                <span className="text-sm">{c.name.replace(/_/g, ' ')}</span>
              </div>
            ))}
          </div>
        )}
        {result.utr && (
          <div className="mt-md" style={{ padding: '0.625rem', background: 'var(--bg-alt)', borderRadius: 'var(--radius-md)' }}>
            <span className="text-xs text-muted">UTR: </span>
            <span className="text-sm font-mono font-semibold">{result.utr}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="payment-flow">
      <div className="payment-step-indicator">
        <div className="step active">
          <span className="step-number">1</span>
          <span>Pay</span>
        </div>
        <div className="step-line" />
        <div className={`step ${step >= 2 ? 'active' : ''}`}>
          <span className="step-number">2</span>
          <span>UTR</span>
        </div>
        <div className="step-line" />
        <div className={`step ${step === 3 ? 'active' : ''}`}>
          <span className="step-number">3</span>
          <span>Done</span>
        </div>
      </div>

      {step === 1 && (
        <div className="animate-fade-in-up">
          <div className="upi-card">
            <p className="text-sm text-muted mb-sm">Scan QR or pay to UPI ID</p>
            {qrDataUrl && (
              <div className="qr-container">
                <img src={qrDataUrl} alt="UPI QR Code" width={200} height={200} style={{ borderRadius: 'var(--radius-sm)' }} />
              </div>
            )}
            <div className="upi-info">
              <div style={{ flex: 1, textAlign: 'left' }}>
                <div className="upi-id">{displayUpiId}</div>
                <div className="upi-name">{displayUpiName}</div>
              </div>
              <button className={`copy-btn ${copied ? 'copied' : ''}`} onClick={copyUpiId} type="button">
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <div style={{ padding: '0.75rem', background: 'var(--bg-alt)', borderRadius: 'var(--radius-md)', marginBottom: '0.5rem' }}>
              <span className="text-xs text-muted">Amount: </span>
              <span className="text-lg font-bold text-gradient">₹{displayAmount}</span>
            </div>
            <p className="text-xs text-muted" style={{ marginTop: '0.75rem' }}>
              After payment, you'll need to enter the UTR number from your payment app
            </p>
          </div>
          <button className="btn-primary btn-lg w-full mt-md" onClick={() => setStep(2)} type="button">
            I've Paid — Enter UTR →
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="animate-fade-in-up">
          <div className="mb-md">
            <label className="text-sm font-semibold" style={{ display: 'block', marginBottom: '0.5rem' }}>UTR Number *</label>
            <div className="utr-input-group">
              <input
                className="utr-input"
                placeholder="Enter 12-digit UTR number"
                value={utr}
                onChange={e => setUtr(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 30))}
                maxLength={30}
                autoComplete="off"
              />
            </div>
            <p className="utr-hint">
              Find this in your UPI app under Payment Details → UTR / Reference Number
            </p>
          </div>

          <div className="mb-md">
            <label className="text-sm font-semibold" style={{ display: 'block', marginBottom: '0.5rem' }}>
              Screenshot <span className="text-xs text-muted">(optional)</span>
            </label>
            {screenshotPreview ? (
              <div style={{ position: 'relative' }}>
                <img src={screenshotPreview} alt="Screenshot" style={{ width: '100%', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }} />
                <button
                  className="btn-ghost btn-icon-sm"
                  onClick={removeScreenshot}
                  type="button"
                  style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', background: 'var(--bg-alt)', border: '1px solid var(--border)' }}
                >✕</button>
              </div>
            ) : (
              <div className="upload-zone" onClick={() => fileRef.current?.click()} role="button" tabIndex={0}>
                <span className="upload-icon">📷</span>
                <span className="upload-text">Tap to upload screenshot</span>
                <span className="upload-hint">JPG, PNG up to 10MB</span>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
          </div>

          <div className="flex gap-sm">
            <button className="btn-secondary btn-lg" onClick={() => setStep(1)} type="button" style={{ flex: '0 0 auto' }}>
              ← Back
            </button>
            <button
              className={`btn-primary btn-lg${submitting ? ' btn-loading' : ''}`}
              onClick={handleSubmit}
              type="button"
              disabled={!canSubmit}
              style={{ flex: 1 }}
            >
              {submitting ? 'Verifying...' : 'Submit UTR'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
