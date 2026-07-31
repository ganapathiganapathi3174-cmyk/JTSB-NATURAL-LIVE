import { useState, useRef, useCallback, useEffect } from 'react';
import QRCode from 'qrcode';

const API_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';
const AMOUNTS = [120, 500, 1000];
const UPI_ID = 'jayarajj126-3@okicici';
const UPI_NAME = 'JEYARAJ ALAGAR';

export default function PaymentFlow({ type, pendingRegId, userId, onSuccess, onError }) {
  const [step, setStep] = useState('amount'); // amount | pay | upload | processing | result
  const [selectedAmount, setSelectedAmount] = useState(null);
  const [orderId, setOrderId] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [copied, setCopied] = useState(false);
  const [screenshotFile, setScreenshotFile] = useState(null);
  const [screenshotPreview, setScreenshotPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [pollCount, setPollCount] = useState(0);
  const fileRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const copyUpiId = useCallback(() => {
    navigator.clipboard.writeText(UPI_ID).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, []);

  async function handleSelectAmount(amount) {
    setSelectedAmount(amount);
    setStep('pay');

    // Generate QR
    const upiUrl = `upi://pay?pa=${encodeURIComponent(UPI_ID)}&pn=${encodeURIComponent(UPI_NAME)}&am=${amount}&cu=INR`;
    QRCode.toDataURL(upiUrl, { width: 200, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
      .then(setQrDataUrl)
      .catch(() => {});

    // Create payment order
    try {
      const body = { type, amount };
      if (type === 'registration') body.pendingRegId = pendingRegId;
      else body.userId = userId;

      const controller = new AbortController();
      const fetchTimeout = setTimeout(() => controller.abort(), 15000);

      const resp = await fetch(`${API_BASE}/createPaymentOrder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(fetchTimeout);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create order');
      }
      const order = await resp.json();
      setOrderId(order.orderId);
    } catch (err) {
      const isTimeout = err.name === 'AbortError' || /timeout|timed out/i.test(err.message);
      onError?.(isTimeout ? 'Connection slow. Please try again.' : err.message);
      setStep('amount');
    }
  }

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

  const canSubmit = screenshotFile && orderId && !submitting;

  async function handleSubmitScreenshot() {
    if (!canSubmit) return;
    setSubmitting(true);
    setStep('processing');

    try {
      const controller = new AbortController();
      const fetchTimeout = setTimeout(() => controller.abort(), 5000);

      let resp = await fetch(`${API_BASE}/submitPaymentProof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          screenshot: screenshotPreview,
          upiId: UPI_ID,
        }),
        signal: controller.signal,
      });
      clearTimeout(fetchTimeout);

      let data = await resp.json();

      // Auto-retry once on "Order expired" — backend re-activates the order
      if (!resp.ok && data.error === 'Order expired') {
        console.log('[PaymentFlow] Order expired, retrying in 1s...');
        await new Promise(r => setTimeout(r, 1000));
        const retryController = new AbortController();
        const retryTimeout = setTimeout(() => retryController.abort(), 5000);
        resp = await fetch(`${API_BASE}/submitPaymentProof`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId,
            screenshot: screenshotPreview,
            upiId: UPI_ID,
          }),
          signal: retryController.signal,
        });
        clearTimeout(retryTimeout);
        data = await resp.json();
      }

      if (!resp.ok) throw new Error(data.error || 'Submission failed');

      // If backend returned a final result immediately, show it
      if (data.status === 'verified' || data.status === 'rejected' || data.status === 'manual_review') {
        setResult(data);
        setStep('result');
        setSubmitting(false);
        if (data.status === 'verified') onSuccess?.(data);
        return;
      }

      // "processing" — poll for background verification result
      setResult(data);
      startPolling(orderId);
    } catch (err) {
      const isTimeout = err.name === 'AbortError' || /timeout|timed out/i.test(err.message);
      if (isTimeout) {
        onError?.('Payment submitted. Checking verification status...');
      } else {
        onError?.(err.message);
      }
      // Even on timeout/error, the backend may still be processing — start polling
      startPolling(orderId);
    }
  }

  function startPolling(oid) {
    let count = 0;
    pollRef.current = setInterval(async () => {
      count++;
      setPollCount(count);
      if (count > 30) {
        clearInterval(pollRef.current);
        setStep('result');
        setSubmitting(false);
        return;
      }
      try {
        const resp = await fetch(`${API_BASE}/getPaymentOrderStatus?orderId=${oid}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.status === 'verified' || data.status === 'rejected' || data.status === 'manual_review') {
            clearInterval(pollRef.current);
            setResult(data);
            setStep('result');
            setSubmitting(false);
            if (data.status === 'verified') onSuccess?.(data);
          }
        }
      } catch {}
    }, 3000);
  }

  // ── RESULT VIEW ──
  if (step === 'result' && result) {
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
          {isApproved
            ? 'Your payment has been automatically verified and approved.'
            : isRejected
              ? 'Screenshot could not be verified. Please contact support.'
              : 'Your payment is being reviewed by our team.'}
        </p>
        {result.verificationScore != null && (
          <div className="mb-sm" style={{ padding: '0.5rem', background: 'var(--bg-alt)', borderRadius: 'var(--radius-md)' }}>
            <span className="text-xs text-muted">Verification Score: </span>
            <span className={`text-sm font-bold ${result.verificationScore >= 80 ? 'text-gradient-success' : result.verificationScore >= 50 ? '' : 'text-gradient-danger'}`}>
              {result.verificationScore}%
            </span>
          </div>
        )}
        {result.checks && result.checks.length > 0 && (
          <div className="result-checks">
            {result.checks.map((c, i) => (
              <div className="result-check" key={i}>
                <span className={`check-icon ${c.passed ? 'pass' : 'fail'}`}>{c.passed ? '✓' : '✗'}</span>
                <span className="text-sm">{c.name?.replace(/_/g, ' ') || c.label || 'Check'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── PROCESSING VIEW ──
  if (step === 'processing') {
    return (
      <div className="result-card animate-fade-in-scale">
        <div className="loading-spinner loading-spinner-lg" style={{ margin: '0 auto 1rem' }} />
        <h2 className="font-bold mb-xs" style={{ fontSize: '1.125rem' }}>Verifying Payment...</h2>
        <p className="text-sm text-muted">
          Analyzing your screenshot with OCR. This usually takes 10-30 seconds.
        </p>
        {pollCount > 0 && (
          <p className="text-xs text-muted mt-sm">Checking status... ({pollCount}/30)</p>
        )}
      </div>
    );
  }

  // ── AMOUNT SELECTION ──
  if (step === 'amount') {
    return (
      <div className="animate-fade-in-up">
        <p className="text-sm text-muted mb-md text-center">Select payment amount</p>
        <div className="amount-grid">
          {AMOUNTS.map(amt => (
            <div
              key={amt}
              className={`amount-option ${selectedAmount === amt ? 'selected' : ''}`}
              onClick={() => handleSelectAmount(amt)}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleSelectAmount(amt); }}
            >
              <div className="amount-value">₹{amt}</div>
              <div className="amount-label">{amt === 120 ? 'Basic' : amt === 500 ? 'Standard' : 'Premium'}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── PAYMENT + SCREENSHOT UPLOAD ──
  return (
    <div className="animate-fade-in-up">
      {/* QR Code */}
      <div className="upi-card">
        <p className="text-sm text-muted mb-sm">Scan QR or pay to UPI ID</p>
        {qrDataUrl && (
          <div className="qr-container">
            <img src={qrDataUrl} alt="UPI QR Code" width={200} height={200} style={{ borderRadius: 'var(--radius-sm)' }} />
          </div>
        )}
        <div className="upi-info">
          <div style={{ flex: 1, textAlign: 'left' }}>
            <div className="upi-id">{UPI_ID}</div>
            <div className="upi-name">{UPI_NAME}</div>
          </div>
          <button className={`copy-btn ${copied ? 'copied' : ''}`} onClick={copyUpiId} type="button">
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
        <div style={{ padding: '0.75rem', background: 'var(--bg-alt)', borderRadius: 'var(--radius-md)' }}>
          <span className="text-xs text-muted">Amount: </span>
          <span className="text-lg font-bold text-gradient">₹{selectedAmount}</span>
        </div>
      </div>

      {/* Screenshot Upload */}
      <div className="mt-md">
        <label className="text-sm font-semibold" style={{ display: 'block', marginBottom: '0.5rem' }}>
          Upload Payment Screenshot *
        </label>
        {screenshotPreview ? (
          <div style={{ position: 'relative' }}>
            <img src={screenshotPreview} alt="Screenshot" style={{ width: '100%', maxHeight: 240, objectFit: 'contain', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }} />
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
            <span className="upload-text">Tap to upload payment screenshot</span>
            <span className="upload-hint">JPG, PNG up to 10MB</span>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
      </div>

      {/* Actions */}
      <div className="flex gap-sm mt-md">
        <button className="btn-secondary btn-lg" onClick={() => { setStep('amount'); removeScreenshot(); }} type="button" style={{ flex: '0 0 auto' }}>
          ← Back
        </button>
        <button
          className={`btn-primary btn-lg${submitting ? ' btn-loading' : ''}`}
          onClick={handleSubmitScreenshot}
          type="button"
          disabled={!canSubmit}
          style={{ flex: 1 }}
        >
          {submitting ? 'Uploading...' : 'Submit Screenshot'}
        </button>
      </div>
    </div>
  );
}
