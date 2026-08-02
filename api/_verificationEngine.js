// ─────────────────────────────────────────────────────────────
// SINGLE VERIFICATION FACADE  (api/_verificationEngine.js)
//
// This is the ONLY entry point the rest of the application uses
// to verify a payment session. It wraps the internal engine
// (_newEngine) behind a stable, normalized contract so that every
// caller (order manager, pending-payments processor, poll trigger)
// gets the same result shape with a well-formed `checks` array.
//
// The internal engine is loaded lazily to keep cold-start cheap
// (same pattern the engine itself uses for its heavy stages).
// ─────────────────────────────────────────────────────────────

let _engine = null;
function getEngine() {
  if (!_engine) _engine = require('./_newEngine/index.js');
  return _engine;
}

function log(msg) {
  console.log('[' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '] [VERIFY-ENGINE] ' + msg);
}

const FIELD_LABELS = {
  amount: 'Amount matches',
  utr: 'UTR matches',
  upi_id: 'Receiver UPI matches',
  status: 'Transaction status SUCCESS',
  date: 'Transaction date is today',
  time: 'Payment time within window',
};

// Rule-check values that represent a PASS (from rulesValidator).
const PASS_VALUES = new Set(['matched', 'close_match', 'partial_match', 'today_ist', 'within_window', 'success']);

function statusOf(value) {
  return value || 'unknown';
}

// Normalize the engine's per-field rule checks + duplicate/integrity
// into a flat array of { name, label, passed, status } that the
// frontend PaymentFlow renders (it maps over result.checks).
function normalizeChecks(rulesChecks, engineResult) {
  const checks = [];
  for (const [field, value] of Object.entries(rulesChecks || {})) {
    checks.push({
      name: field,
      label: FIELD_LABELS[field] || field.replace(/_/g, ' '),
      passed: PASS_VALUES.has(value),
      status: statusOf(value),
    });
  }

  const dup = engineResult?.duplicateCheck || null;
  checks.push({
    name: 'duplicate',
    label: 'No duplicate transaction',
    passed: !dup,
    status: dup || 'unique',
  });

  const integrity = engineResult?.integrity || {};
  const imageOk = !integrity.blurred && !integrity.dark;
  checks.push({
    name: 'image',
    label: 'Screenshot authentic',
    passed: imageOk,
    status: integrity.blurred ? 'blurred' : (integrity.dark ? 'dark' : 'authentic'),
  });

  return checks;
}

function finalStatusOf(rawStatus) {
  if (rawStatus === 'verified') return 'verified';
  if (rawStatus === 'rejected') return 'rejected';
  return 'manual_review';
}

// A session cannot be re-used once it reached a terminal state.
function isTerminalStatus(status) {
  return status === 'verified' || status === 'rejected' || status === 'expired';
}

// A pending session that is past expires_at is expired.
function sessionExpired(order) {
  if (!order) return false;
  if (order.status === 'expired') return true;
  if (order.status === 'pending' && order.expires_at && Date.now() > new Date(order.expires_at).getTime()) return true;
  return false;
}

function fallbackResult(message, opts) {
  return {
    status: 'manual_review',
    verificationStatus: 'manual_review',
    confidence: 0,
    ocrConfidence: 0,
    reasons: message ? [message] : [],
    checks: [],
    fraudScore: 0,
    riskScore: 0,
    ocrData: null,
    extractedFields: null,
    matchResults: {},
    utrHash: null,
    screenshotHash: null,
    screenshotPhash: null,
    integrity: null,
    sessionExpired: opts?.sessionExpired || false,
    durationMs: 0,
    stages: {},
    matchedAmount: false,
    matchedReceiver: false,
    matchedUtr: false,
    matchedDate: false,
    userUtrMatched: false,
    userUpiMatched: false,
  };
}

// ─────────────────────────────────────────────────────────────
// Primary entry point — used by the payment order manager, the
// pending-payments processor, and the poll-trigger path.
//
// opts.enforceExpiry: when true and the session is already expired
// (or terminal), short-circuit to manual_review with the standard
// PAYMENT_SESSION_EXPIRED reason instead of running OCR.
// ─────────────────────────────────────────────────────────────
async function verifySession(order, screenshotUrl, userId, userUtr, userUpi, screenshotBuf, opts = {}) {
  const t0 = Date.now();
  const paymentId = (order && (order.id || order.orderId)) || 'unknown';

  if (opts.enforceExpiry && (isTerminalStatus(order?.status) || sessionExpired(order))) {
    log('session ' + paymentId + ' not verifiable (status=' + (order?.status || 'none') + ') — ' +
      (order?.status === 'verified' ? 'already verified' : order?.status === 'rejected' ? 'already rejected' : 'PAYMENT_SESSION_EXPIRED'));
    return fallbackResult(order?.status === 'verified' ? 'Order already verified' : 'PAYMENT_SESSION_EXPIRED', { sessionExpired: true });
  }

  log('START payment=' + paymentId + ' type=' + (order?.type || '?') + ' amount=' + (order?.amount || '?'));

  let raw;
  try {
    raw = await getEngine().run(order, screenshotUrl, userId, userUtr, userUpi, screenshotBuf);
  } catch (e) {
    log('ERROR payment=' + paymentId + ': ' + e.message);
    return fallbackResult('Verification error: ' + e.message);
  }

  const checks = normalizeChecks(raw.checks, raw);
  const extracted = raw.extractedFields || {};
  const matchedAmount = !!(extracted.amount != null);
  const matchedUtr = !!(extracted.utr != null);
  const matchedReceiver = !!(extracted.upi_id != null);
  const matchedDate = !!(extracted.date != null);

  const result = {
    status: finalStatusOf(raw.status),
    verificationStatus: raw.status,
    confidence: raw.confidence || 0,
    ocrConfidence: raw.ocrConfidence || 0,
    reasons: raw.reasons || [],
    checks,
    fraudScore: raw.fraudScore || 0,
    riskScore: raw.riskScore || 0,
    ocrData: raw.ocrData || null,
    extractedFields: extracted,
    matchResults: raw.matchResults || {},
    utrHash: raw.utrHash || null,
    screenshotHash: raw.screenshotHash || null,
    screenshotPhash: raw.screenshotPhash || null,
    integrity: raw.integrity || null,
    sessionExpired: false,
    durationMs: raw.durationMs || (Date.now() - t0),
    stages: raw.stages || {},
    matchedAmount,
    matchedReceiver,
    matchedUtr,
    matchedDate,
    userUtrMatched: !!(userUtr && matchedUtr && raw.matchResults?.utr === 'matched'),
    userUpiMatched: !!(userUpi && matchedReceiver),
  };

  log('END payment=' + paymentId + ' status=' + result.status + ' confidence=' + result.confidence + '% duration=' + result.durationMs + 'ms');
  return result;
}

module.exports = { verifySession, normalizeChecks, sessionExpired, isTerminalStatus, finalStatusOf };
