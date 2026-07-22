import { useState, useEffect, useRef, useCallback } from 'react';
import QrCodeDisplay from './QrCodeDisplay.jsx';

const FUNCTIONS_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';
const ADMIN_UPI = 'jayarajj126-3@okicici';
const MERCHANT_NAME = 'StarlightAscent';
const MOBILE_NUMBER = '9655897523';
const SSE_URL = FUNCTIONS_BASE + '/sse/dashboard';

const PROGRESS_STEPS = [
  'Uploading Screenshot',
  'Reading Payment Details',
  'Extracting Amount',
  'Extracting UTR',
  'Checking Receiver',
  'Checking Date',
  'Checking Time',
  'Duplicate Check',
  'Fraud Detection',
  'AI Decision',
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

const CHECKLIST_ITEMS = [
  { key: 'screenshot', label: 'Screenshot Uploaded', field: null },
  { key: 'amount', label: 'Amount Verified', field: 'matchedAmount' },
  { key: 'receiver', label: 'Receiver Verified', field: 'matchedReceiver' },
  { key: 'utr', label: 'UTR Verified', field: 'matchedUtr' },
  { key: 'date', label: 'Date Verified', field: 'matchedDate' },
  { key: 'duplicate', label: 'Duplicate Check Passed', field: null },
  { key: 'fraud', label: 'Fraud Check Passed', field: null },
];

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function getStatusDisplay(status) {
  if (status === 'verified') return { label: 'APPROVED', color: 'var(--success)', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.2)' };
  if (status === 'rejected') return { label: 'REJECTED', color: 'var(--danger)', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.2)' };
  if (status === 'failed') return { label: 'FAILED', color: 'var(--danger)', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.2)' };
  if (status === 'processing' || status === 'pending' || status === 'queued') return { label: 'PROCESSING', color: 'var(--info)', bg: 'rgba(34,211,238,0.12)', border: 'rgba(34,211,238,0.2)' };
  if (status === 'manual_review') return { label: 'MANUAL REVIEW', color: 'var(--warning)', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.2)' };
  return { label: (status || '').toUpperCase(), color: 'var(--text-secondary)', bg: 'var(--surface-2)', border: 'var(--border)' };
}

function SummaryCard({ result, type }) {
  const ocr = result?.ocrData || {};
  return (
    <div className="card-dim" style={{ marginTop: '1rem', textAlign: 'left' }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.625rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Verification Summary</div>
      <div className="detail-grid-sm">
        {result?.matchedAmount != null && (
          <div className="detail-row" style={{ padding: '0.375rem 0' }}>
            <span className="detail-label">Amount</span>
            <span className="detail-value">{ocr.extractedAmount || 'N/A'}{result.matchedAmount ? ' ✓' : ' ✗'}</span>
          </div>
        )}
        {ocr.extractedReceiverUpi && (
          <div className="detail-row" style={{ padding: '0.375rem 0' }}>
            <span className="detail-label">Receiver</span>
            <span className="detail-value" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{ocr.extractedReceiverUpi}</span>
          </div>
        )}
        {ocr.extractedSenderUpi && (
          <div className="detail-row" style={{ padding: '0.375rem 0' }}>
            <span className="detail-label">Sender</span>
            <span className="detail-value" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{ocr.extractedSenderUpi}</span>
          </div>
        )}
        {(ocr.extractedUtr || result?.userEnteredUtr) && (
          <div className="detail-row" style={{ padding: '0.375rem 0' }}>
            <span className="detail-label">UTR</span>
            <span className="detail-value" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{ocr.extractedUtr || result.userEnteredUtr}</span>
          </div>
        )}
        {ocr.extractedDate && (
          <div className="detail-row" style={{ padding: '0.375rem 0' }}>
            <span className="detail-label">Date</span>
            <span className="detail-value">{ocr.extractedDate}</span>
          </div>
        )}
        {ocr.extractedTime && (
          <div className="detail-row" style={{ padding: '0.375rem 0' }}>
            <span className="detail-label">Time</span>
            <span className="detail-value">{ocr.extractedTime}</span>
          </div>
        )}
        {result?.fraudScore != null && (
          <div className="detail-row" style={{ padding: '0.375rem 0' }}>
            <span className="detail-label">Fraud Score</span>
            <span className="detail-value" style={{ color: result.fraudScore > 50 ? 'var(--danger)' : 'var(--success)' }}>{result.fraudScore}/100</span>
          </div>
        )}
        {result?.verificationScore != null && (
          <div className="detail-row" style={{ padding: '0.375rem 0' }}>
            <span className="detail-label">Score</span>
            <span className="detail-value" style={{ fontWeight: 700, color: result.verificationScore >= 90 ? 'var(--success)' : result.verificationScore >= 70 ? 'var(--warning)' : 'var(--danger)' }}>{result.verificationScore}%</span>
          </div>
        )}
        <div className="detail-row" style={{ padding: '0.375rem 0', borderBottom: 'none' }}>
          <span className="detail-label">Decision</span>
          <span className="detail-value" style={{ fontWeight: 700, color: getStatusDisplay(result?.status || result?.verificationStatus).color }}>
            {getStatusDisplay(result?.status || result?.verificationStatus).label}
          </span>
        </div>
      </div>
    </div>
  );
}

function ApprovedResult({ result, type, onContinue }) {
  const displayStatus = getStatusDisplay('verified');
  const score = result?.verificationScore;
  const scoreColor = score >= 90 ? 'var(--success)' : score >= 70 ? 'var(--warning)' : 'var(--danger)';

  return (
    <div className="animate-fade-in-up" style={{ maxWidth: 700, margin: '0 auto', width: '100%' }}>
      <div className="glass-strong" style={{ padding: '2rem', borderRadius: 'var(--radius-xl)', textAlign: 'center', border: '1px solid rgba(16,185,129,0.15)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 0%, rgba(16,185,129,0.08) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div className="flex-center" style={{
            width: 72, height: 72, borderRadius: '50%',
            background: 'linear-gradient(135deg, #4ADE80, #22C55E)',
            color: '#fff', fontSize: '2rem', margin: '0 auto 1.25rem',
            boxShadow: '0 0 40px rgba(74,222,128,0.35)',
            animation: 'float 3s ease-in-out infinite',
          }} aria-hidden="true">
            <CheckIcon />
          </div>

          <h2 style={{ margin: 0, fontSize: '1.375rem', color: 'var(--emerald-200)' }}>
            Payment Successfully Verified
          </h2>
          <p className="text-muted mt-sm" style={{ lineHeight: 1.6, maxWidth: 400, margin: '0.5rem auto 0' }}>
            {type === 'registration'
              ? 'Your registration payment has been verified successfully. You can now proceed.'
              : 'Your wallet has been credited successfully.'}
          </p>

          <div className="flex-center gap-sm mt-md" style={{ flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
              padding: '0.25rem 0.75rem', borderRadius: 'var(--radius-full)',
              background: displayStatus.bg, border: `1px solid ${displayStatus.border}`,
              color: displayStatus.color, fontSize: '0.75rem', fontWeight: 700,
              letterSpacing: '0.05em',
            }}>
              {displayStatus.label}
            </span>
            {score != null && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                padding: '0.25rem 0.75rem', borderRadius: 'var(--radius-full)',
                background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
                color: scoreColor, fontSize: '0.75rem', fontWeight: 600,
              }}>
                Score: {score}%
              </span>
            )}
          </div>

          <div className="card" style={{ marginTop: '1.25rem', textAlign: 'left', background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.1)' }}>
            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(16,185,129,0.08)' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--emerald-200)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Verification Checklist
              </span>
            </div>
            <div style={{ padding: '0.75rem 1rem' }}>
              <div className="detail-grid-sm">
                {CHECKLIST_ITEMS.map(item => {
                  const passed = item.field ? result?.[item.field] === true : true;
                  return (
                    <div key={item.key} className="detail-row" style={{ padding: '0.3rem 0', gap: '0.5rem', alignItems: 'center' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                        background: passed ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                        color: passed ? 'var(--success)' : 'var(--danger)',
                      }}>
                        {passed ? <CheckIcon /> : <CrossIcon />}
                      </span>
                      <span style={{ fontSize: '0.8125rem', color: passed ? 'var(--text-2)' : 'var(--text-secondary)' }}>
                        {item.label}
                      </span>
                      <span style={{
                        marginLeft: 'auto', fontSize: '0.6875rem', fontWeight: 700,
                        color: passed ? 'var(--success)' : 'var(--danger)',
                      }}>
                        {passed ? 'PASS' : 'FAIL'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <SummaryCard result={result} type={type} />

          <div className="flex-center gap-md mt-lg" style={{ flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-success btn-lg"
              onClick={onContinue}
              aria-label="Continue to dashboard"
            >
              {type === 'registration' ? 'Continue Registration' : 'Go to Dashboard'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RejectedResult({ result, type, onRetry, onStartOver }) {
  const displayStatus = getStatusDisplay('rejected');
  const reasons = result?.reasons || result?.rejection_reasons || [];
  const score = result?.verificationScore;

  return (
    <div className="animate-fade-in-up" style={{ maxWidth: 700, margin: '0 auto', width: '100%' }}>
      <div className="glass-strong" style={{ padding: '2rem', borderRadius: 'var(--radius-xl)', textAlign: 'center', border: '1px solid rgba(239,68,68,0.15)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 0%, rgba(239,68,68,0.06) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div className="flex-center" style={{
            width: 72, height: 72, borderRadius: '50%',
            background: 'linear-gradient(135deg, #FB7185, #F43F5E)',
            color: '#fff', fontSize: '2rem', margin: '0 auto 1.25rem',
            boxShadow: '0 0 40px rgba(239,68,68,0.3)',
          }} aria-hidden="true">
            <CrossIcon />
          </div>

          <h2 style={{ margin: 0, fontSize: '1.375rem', color: 'var(--red-200)' }}>
            Payment Verification Failed
          </h2>
          <p className="text-muted mt-sm" style={{ lineHeight: 1.6, maxWidth: 400, margin: '0.5rem auto 0' }}>
            Your payment could not be verified. Please review the issues below and try again.
          </p>

          <div className="flex-center gap-sm mt-md" style={{ flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
              padding: '0.25rem 0.75rem', borderRadius: 'var(--radius-full)',
              background: displayStatus.bg, border: `1px solid ${displayStatus.border}`,
              color: displayStatus.color, fontSize: '0.75rem', fontWeight: 700,
              letterSpacing: '0.05em',
            }}>
              {displayStatus.label}
            </span>
            {score != null && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                padding: '0.25rem 0.75rem', borderRadius: 'var(--radius-full)',
                background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
                color: score < 70 ? 'var(--danger)' : 'var(--warning)', fontSize: '0.75rem', fontWeight: 600,
              }}>
                Score: {score}%
              </span>
            )}
          </div>

          {reasons.length > 0 && (
            <div className="card" style={{ marginTop: '1.25rem', textAlign: 'left', background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.1)' }}>
              <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(239,68,68,0.08)' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--red-200)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Rejection Reasons ({reasons.length})
                </span>
              </div>
              <div style={{ padding: '0.75rem 1rem' }}>
                {reasons.map((r, i) => {
                  const userFriendly = r
                    .replace(/amount_mismatch/i, 'Amount mismatch — the payment amount does not match the expected amount.')
                    .replace(/invalid_utr/i, 'Could not read UTR from the payment screenshot.')
                    .replace(/utr_mismatch/i, 'Entered UTR does not match the screenshot.')
                    .replace(/invalid_bank_sms/i, 'Uploaded screenshot is not a valid payment screenshot.')
                    .replace(/image_quality_failed/i, 'Invalid screenshot — please upload a clear payment screenshot.')
                    .replace(/fraud_detected/i, 'Suspicious activity detected with this payment.')
                    .replace(/receiver_mismatch/i, 'Payment receiver does not match the expected UPI ID.')
                    .replace(/timeout/i, 'Verification timed out — please try again.')
                    .replace(/duplicate_utr/i, 'This UTR has already been used for another payment.')
                    .replace(/screenshot_too_old/i, 'Screenshot is older than 1 hour — please take a fresh screenshot.')
                    .replace(/edited_screenshot/i, 'Edited screenshot detected — please upload an unedited screenshot.')
                    .replace(/unsupported_screenshot/i, 'Unsupported payment screenshot format.')
                    .replace(/low_ocr_confidence/i, 'OCR confidence too low — please upload a clearer screenshot.')
                    .replace(/payment_status_rejected/i, 'Payment status shows as failed/rejected.');
                  return (
                    <div key={i} className="detail-row" style={{ padding: '0.5rem 0', gap: '0.5rem', alignItems: 'flex-start', borderBottom: i < reasons.length - 1 ? '1px solid rgba(239,68,68,0.06)' : 'none' }}>
                      <span style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 2 }} aria-hidden="true">❌</span>
                      <span style={{ fontSize: '0.8125rem', color: 'var(--red-100)', lineHeight: 1.5 }}>{userFriendly}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <SummaryCard result={result} type={type} />

          <div className="flex-center gap-md mt-lg" style={{ flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={onRetry}
              aria-label="Try uploading again"
            >
              Upload Again
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-lg"
              onClick={onStartOver}
              aria-label="Start over from beginning"
            >
              Start Over
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ManualReviewResult({ result, type, onContinue }) {
  const displayStatus = getStatusDisplay('manual_review');
  const reasons = result?.reasons || result?.rejection_reasons || [];
  const reason = reasons.length > 0 ? reasons.join(', ') : 'Additional verification required';

  return (
    <div className="animate-fade-in-up" style={{ maxWidth: 700, margin: '0 auto', width: '100%' }}>
      <div className="glass-strong" style={{ padding: '2rem', borderRadius: 'var(--radius-xl)', textAlign: 'center', border: '1px solid rgba(245,158,11,0.15)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 0%, rgba(245,158,11,0.06) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div className="flex-center" style={{
            width: 72, height: 72, borderRadius: '50%',
            background: 'linear-gradient(135deg, #FBBF24, #F59E0B)',
            color: '#fff', fontSize: '2rem', margin: '0 auto 1.25rem',
            boxShadow: '0 0 40px rgba(245,158,11,0.3)',
          }} aria-hidden="true">
            <ClockIcon />
          </div>

          <h2 style={{ margin: 0, fontSize: '1.375rem', color: 'var(--amber-200)' }}>
            Manual Verification Required
          </h2>
          <p className="text-muted mt-sm" style={{ lineHeight: 1.6, maxWidth: 400, margin: '0.5rem auto 0' }}>
            Your payment requires additional verification by an administrator.
          </p>

          <div className="flex-center gap-sm mt-md" style={{ flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
              padding: '0.25rem 0.75rem', borderRadius: 'var(--radius-full)',
              background: displayStatus.bg, border: `1px solid ${displayStatus.border}`,
              color: displayStatus.color, fontSize: '0.75rem', fontWeight: 700,
              letterSpacing: '0.05em',
            }}>
              {displayStatus.label}
            </span>
            {result?.verificationScore != null && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                padding: '0.25rem 0.75rem', borderRadius: 'var(--radius-full)',
                background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
                color: 'var(--warning)', fontSize: '0.75rem', fontWeight: 600,
              }}>
                Score: {result.verificationScore}%
              </span>
            )}
          </div>

          <div className="card-dim" style={{ marginTop: '1.25rem', textAlign: 'left', background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.1)' }}>
            <div style={{ marginBottom: '0.5rem' }}>
              <div className="detail-label" style={{ marginBottom: '0.25rem' }}>Reason</div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--amber-100)' }}>{reason}</div>
            </div>
            <div>
              <div className="detail-label" style={{ marginBottom: '0.25rem' }}>Estimated Review Time</div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text)' }}>5–10 minutes</div>
            </div>
          </div>

          <SummaryCard result={result} type={type} />

          <div className="flex-center gap-md mt-lg" style={{ flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-warning btn-lg"
              onClick={onContinue}
              aria-label="Return to dashboard"
            >
              Return to Dashboard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PendingResult({ result, orderId, onStatusUpdate, onStartOver }) {
  const displayStatus = getStatusDisplay('processing');
  const [elapsed, setElapsed] = useState(0);
  const [connected, setConnected] = useState(false);
  const mountedRef = useRef(true);
  const esRef = useRef(null);
  const pollRef = useRef(null);
  const startTimeRef = useRef(Date.now());
  const MAX_WAIT = 90000;
  const POLL_INTERVAL = 3000;
  const pollTimedOut = elapsed >= MAX_WAIT;

  const checkFinalStatus = useCallback((status, data) => {
    if (!mountedRef.current) return false;
    const finalStatuses = ['verified', 'rejected', 'failed', 'manual_review'];
    if (finalStatuses.includes(status) && onStatusUpdate) {
      onStatusUpdate({ status, verificationScore: data?.verificationScore, verificationStatus: data?.verificationStatus || status });
      return true;
    }
    return false;
  }, [onStatusUpdate]);

  // SSE subscription
  useEffect(() => {
    if (!orderId) return;
    const es = new EventSource(FUNCTIONS_BASE + '/sse/dashboard');
    esRef.current = es;
    es.addEventListener('paymentUpdated', (e) => {
      if (!mountedRef.current) return;
      try {
        const data = JSON.parse(e.data);
        if (data.orderId === orderId) {
          setConnected(true);
          checkFinalStatus(data.status, data);
        }
      } catch (_) {}
    });
    es.onerror = () => { if (mountedRef.current) setConnected(false); };
    return () => { es.close(); esRef.current = null; };
  }, [orderId, checkFinalStatus]);

  // Polling fallback (every 3s, max 90s)
  useEffect(() => {
    if (!orderId) return;
    async function poll() {
      if (!mountedRef.current) return;
      try {
        const resp = await fetch(`${FUNCTIONS_BASE}/getPaymentOrderStatus?orderId=${encodeURIComponent(orderId)}`);
        const data = await resp.json();
        if (!mountedRef.current) return;
        if (checkFinalStatus(data.status, data)) return;
      } catch (_) {}
      const soFar = Date.now() - startTimeRef.current;
      setElapsed(soFar);
      if (soFar < MAX_WAIT) pollRef.current = setTimeout(poll, POLL_INTERVAL);
    }
    pollRef.current = setTimeout(poll, POLL_INTERVAL);
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [orderId, checkFinalStatus]);

  useEffect(() => {
    return () => { mountedRef.current = false; if (esRef.current) esRef.current.close(); };
  }, []);

  return (
    <div className="animate-fade-in-up" style={{ maxWidth: 700, margin: '0 auto', width: '100%' }}>
      <div className="glass-strong" style={{ padding: '2rem', borderRadius: 'var(--radius-xl)', textAlign: 'center', border: '1px solid rgba(34,211,238,0.15)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 0%, rgba(34,211,238,0.06) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div className="flex-center" style={{
            width: 72, height: 72, borderRadius: '50%',
            background: 'linear-gradient(135deg, #22D3EE, #0891B2)',
            color: '#fff', fontSize: '2rem', margin: '0 auto 1.25rem',
            boxShadow: '0 0 40px rgba(34,211,238,0.3)',
            animation: 'pulse 2s ease-in-out infinite',
          }} aria-hidden="true">
            <ClockIcon />
          </div>

          <h2 style={{ margin: 0, fontSize: '1.375rem', color: 'var(--cyan-200)' }}>
            Processing Payment
          </h2>
          <p className="text-muted mt-sm" style={{ lineHeight: 1.6, maxWidth: 400, margin: '0.5rem auto 0' }}>
            {pollTimedOut
              ? 'Your payment is taking longer than usual. The system is still working on it — we will update you once complete. If this persists, please contact support.'
              : 'Your payment is being verified in the background. The result will appear here automatically once processing completes.'}
          </p>

          <div className="flex-center gap-sm mt-md" style={{ flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
              padding: '0.25rem 0.75rem', borderRadius: 'var(--radius-full)',
              background: displayStatus.bg, border: `1px solid ${displayStatus.border}`,
              color: displayStatus.color, fontSize: '0.75rem', fontWeight: 700,
              letterSpacing: '0.05em',
            }}>
              {displayStatus.label} {elapsed > 0 ? `(${Math.round(elapsed / 1000)}s)` : ''}
              {connected ? ' ● Live' : ''}
            </span>
          </div>

          <div className="flex-center gap-md mt-lg" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost btn-lg" onClick={onStartOver}>Back to Home</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorResult({ message, onRetry, onStartOver }) {
  return (
    <div className="animate-fade-in-up" style={{ maxWidth: 700, margin: '0 auto', width: '100%' }}>
      <div className="glass-strong" style={{ padding: '2rem', borderRadius: 'var(--radius-xl)', textAlign: 'center', border: '1px solid rgba(239,68,68,0.15)' }}>
        <div className="flex-center" style={{
          width: 72, height: 72, borderRadius: '50%',
          background: 'linear-gradient(135deg, #FB7185, #F43F5E)',
          color: '#fff', fontSize: '2rem', margin: '0 auto 1.25rem',
          boxShadow: '0 0 40px rgba(239,68,68,0.3)',
        }} aria-hidden="true">
          !
        </div>

        <h2 style={{ margin: 0, fontSize: '1.375rem', color: 'var(--red-200)' }}>
          Unable to Verify Payment
        </h2>
        <p className="text-muted mt-sm" style={{ lineHeight: 1.6, maxWidth: 400, margin: '0.5rem auto 0' }}>
          {message || 'An unexpected error occurred. Please try again.'}
        </p>

        <div className="flex-center gap-md mt-lg" style={{ flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={onRetry}
            aria-label="Try again"
          >
            Try Again
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-lg"
            onClick={onStartOver}
            aria-label="Go back"
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UpiPayment({ type, pendingRegId, userId, allowedPackage, onSuccess, onError }) {
  const [selectedAmount, setSelectedAmount] = useState(null);
  const [step, setStep] = useState('select');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [orderId, setOrderId] = useState(null);
  const [screenshotFile, setScreenshotFile] = useState(null);
  const [screenshotPreview, setScreenshotPreview] = useState(null);
  const [utr, setUtr] = useState('');
  const [enteredUpiId, setEnteredUpiId] = useState('');
  const [verifyResult, setVerifyResult] = useState(null);
  const [progressIndex, setProgressIndex] = useState(0);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [copied, setCopied] = useState(false);
  const [autoRedirectTimer, setAutoRedirectTimer] = useState(null);

  const fileRef = useRef(null);
  const timerRef = useRef(null);
  const previewRef = useRef(null);
  const sseRef = useRef(null);

  // Subscribe to SSE progress events during verification
  function connectSSE() {
    if (sseRef.current) sseRef.current.close();
    try {
      const es = new EventSource(SSE_URL);
      sseRef.current = es;
      es.addEventListener('verificationProgress', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.orderId === orderId && data.percent != null) {
            const stepIndex = Math.floor((data.percent / 100) * (PROGRESS_STEPS.length - 1));
            setProgressIndex(Math.min(stepIndex, PROGRESS_STEPS.length - 1));
          }
          if (data.phase) {
            const phaseMap = {
              'fetching': 1, 'preprocessing': 2, 'ocr': 3, 'parsing': 4,
              'checking': 5, 'fraud': 8, 'scoring': 9, 'complete': 10,
            };
            const idx = phaseMap[data.phase];
            if (idx != null) setProgressIndex(idx);
          }
        } catch (_) {}
      });
      es.onerror = () => {};
    } catch (_) {}
  }
  function disconnectSSE() {
    if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
  }

  useEffect(() => {
    return () => {
      disconnectSSE();
      if (timerRef.current) clearInterval(timerRef.current);
      if (previewRef.current) { URL.revokeObjectURL(previewRef.current); }
      if (autoRedirectTimer) clearTimeout(autoRedirectTimer);
    };
  }, [autoRedirectTimer]);

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

  function handleAutoRedirect() {
    if (onSuccess) {
      const timer = setTimeout(() => onSuccess(verifyResult), 3000);
      setAutoRedirectTimer(timer);
    }
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

  function handleContinue() {
    if (onSuccess) onSuccess(verifyResult);
  }

  async function handleVerify() {
    if (!fileRef.current?.files?.[0]) { setError('Please upload your payment screenshot'); return; }
    if (!utr.trim()) { setError('Please enter the transaction reference / UTR'); return; }
    if (!enteredUpiId.trim()) { setError('Please enter the UPI ID you paid to'); return; }

    setError('');
    setVerifying(true);
    setStep('progress');
    setProgressIndex(0);
    connectSSE();

    timerRef.current = setInterval(() => {
      setProgressIndex(prev => Math.min(prev + 1, PROGRESS_STEPS.length - 1));
    }, 6000);

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
        body: JSON.stringify({ orderId, screenshot: dataUrl, utr: utr.trim(), upiId: enteredUpiId.trim() }),
        signal: AbortSignal.timeout(120000),
      });

      let data;
      const contentType = resp.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await resp.json();
      } else {
        const textBody = await resp.text();
        console.error('[UPI-PAYMENT] Non-JSON response:', resp.status, textBody.substring(0, 200));
        throw new Error('Unable to verify payment. Please try again.');
      }
      if (!resp.ok) throw new Error(data.error || 'Verification failed');

      setVerifyResult(data);
      setProgressIndex(PROGRESS_STEPS.length - 1);

      if (data.status === 'verified') {
        handleAutoRedirect();
      }
    } catch (err) {
      const message = err.message === 'The user aborted a request.'
        ? 'Verification timed out. Please try again.'
        : err.message || 'Unable to verify payment. Please try again.';
      setError(message);
      setVerifyResult({ status: 'error', reasons: [message] });
      setProgressIndex(PROGRESS_STEPS.length - 1);
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      disconnectSSE();
      setVerifying(false);
    }
  }

  function handleRetry() {
    setError('');
    setVerifyResult(null);
    setProgressIndex(0);
    setScreenshotPreview(null);
    setScreenshotFile(null);
    setUtr('');
    setEnteredUpiId('');
    setAutoRedirectTimer(null);
    if (fileRef.current) fileRef.current.value = '';
    setStep('verify');
  }

  function handleStatusUpdate(updatedStatus) {
    setVerifyResult(prev => {
      if (!prev) return prev;
      return { ...prev, ...updatedStatus };
    });
  }

  function handleStartOver() {
    if (timerRef.current) clearInterval(timerRef.current);
    setStep('select');
    setSelectedAmount(null);
    setOrderId(null);
    setScreenshotPreview(null);
    setScreenshotFile(null);
    setUtr('');
    setEnteredUpiId('');
    setVerifyResult(null);
    setError('');
    setProgressIndex(0);
    setAutoRedirectTimer(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  if (verifyResult && verifyResult.status === 'verified') {
    return (
      <ApprovedResult
        result={verifyResult}
        type={type}
        onContinue={handleContinue}
      />
    );
  }

  if (verifyResult && (verifyResult.status === 'rejected' || verifyResult.status === 'failed')) {
    return (
      <RejectedResult
        result={verifyResult}
        type={type}
        onRetry={handleRetry}
        onStartOver={handleStartOver}
      />
    );
  }

  if (verifyResult && (verifyResult.manualReviewRequired === true || verifyResult.status === 'manual_review')) {
    return (
      <ManualReviewResult
        result={verifyResult}
        type={type}
        onContinue={handleContinue}
      />
    );
  }

  if (verifyResult && (verifyResult.status === 'pending' || verifyResult.status === 'queued')) {
    return (
      <PendingResult
        result={verifyResult}
        orderId={orderId}
        onStatusUpdate={handleStatusUpdate}
        onStartOver={handleStartOver}
      />
    );
  }

  if (verifyResult && verifyResult.status === 'error') {
    const errorMsg = error || (verifyResult.reasons && verifyResult.reasons[0]) || 'Unable to verify payment. Please try again.';
    return (
      <ErrorResult
        message={errorMsg}
        onRetry={handleRetry}
        onStartOver={handleStartOver}
      />
    );
  }

  if (step === 'progress') {
    return (
      <div className="animate-fade-in-up" style={{ padding: '1rem 0', maxWidth: 500, margin: '0 auto' }}>
        <div className="glass-strong" style={{ padding: '1.5rem', borderRadius: 'var(--radius-xl)' }}>
          <h3 className="text-sm text-center mb-md text-gradient" style={{ fontSize: '0.95rem' }}>AI Verification In Progress</h3>
          <div className="verification-timeline" style={{ margin: '0 auto' }}>
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
          <div className="flex-center mt-md">
            <span className="text-xs text-muted">Please wait while we verify your payment</span>
          </div>
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

        <div className="glass card card-body text-center mb-md">
          <h3 className="mb text-gradient" style={{ fontSize: '1rem' }}>Pay <span>&#8377;{selectedAmount}</span></h3>
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
            I've Paid &mdash; Upload Payment Screenshot &rarr;
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

        <div className="glass card card-body mb-md">
          <h3 className="text-center mb text-gradient">Upload Payment Screenshot</h3>
          <p className="text-muted text-sm text-center mb-md" style={{ lineHeight: 1.6 }}>
            Paid <strong>&#8377;{selectedAmount}</strong> to <strong style={{ userSelect: 'all' }}>{ADMIN_UPI}</strong>? Upload your payment screenshot below to verify.
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
            <label className="text-sm font-semibold mb-xs" style={{ display: 'block' }}>Upload Payment Screenshot *</label>
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
            <input type="text" value={utr} onChange={e => setUtr(e.target.value)} placeholder="Enter the UTR number from your payment"
              className="font-mono" />
          </div>

          <div className="field-glass">
            <label className="text-sm font-semibold mb-xs" style={{ display: 'block' }}>UPI ID You Paid To *</label>
            <input type="text" value={enteredUpiId} onChange={e => setEnteredUpiId(e.target.value)} placeholder="e.g. jayarajj126-3@okicici"
              className="font-mono" />
            <p className="text-xs text-muted mt-xs">Enter the UPI ID shown in your payment screenshot</p>
          </div>

          <button type="button" className={`btn btn-primary w-full btn-lg${verifying ? ' btn-loading' : ''}`} onClick={handleVerify} disabled={verifying}>
            {verifying ? 'Verifying...' : 'Verify Payment'}
          </button>
        </div>

        <button type="button" className="btn btn-ghost btn-sm" onClick={handleStartOver} style={{ display: 'block', margin: '1rem auto 0' }}>
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

      <h3 className="text-center mb-md text-gradient" style={{ fontSize: '1rem' }}>
        {type === 'registration' ? 'Select Your Plan' : 'Select Topup Amount'}
      </h3>

      <div className="grid-2">
        {AMOUNT_OPTIONS.map((opt) => (
          <button key={opt.amount} type="button" disabled={creatingOrder} onClick={() => handleAmountSelect(opt.amount)}
            className={`glass card card-body text-center${creatingOrder && selectedAmount === opt.amount ? '' : ' card-hover'}`}
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