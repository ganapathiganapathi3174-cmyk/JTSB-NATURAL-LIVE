// ─────────────────────────────────────────────────────────────
// RETRY ENGINE  (api/_retryEngine.js)
//
// Pure, dependency-free backoff + retry-policy module. Decides
// whether a failed verification attempt should be retried, how long
// to wait, and when to give up and escalate to manual review.
//
// Policy:
//   - bounded attempts (VERIFY_MAX_ATTEMPTS, default 3)
//   - exponential-ish backoff [1s, 5s, 15s] with ±20% jitter
//   - permanent errors (expired session, already verified, bad
//     data, order not found) never retry — they escalate immediately
//   - transient errors (OCR timeout, network, DB hiccup) retry
// ─────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = parseInt(process.env.VERIFY_MAX_ATTEMPTS || '3', 10);
const BACKOFF_MS = [1000, 5000, 15000];

// Errors that can never succeed on retry.
const PERMANENT_MARKERS = [
  'PAYMENT_SESSION_EXPIRED',
  'already verified',
  'already approved',
  'Order already verified',
  'Order not found',
  'order not found',
  'BAD_DATA',
  'Invalid registration data',
  'Validation failed',
];

// `attempt` is the number of attempts already made (0 = none yet).
function clampAttempt(attempt) {
  const n = Number(attempt);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function isExhausted(attempt) {
  return clampAttempt(attempt) >= MAX_ATTEMPTS;
}

function attemptsRemaining(attempt) {
  return Math.max(0, MAX_ATTEMPTS - clampAttempt(attempt));
}

// Backoff in ms for a given 1-based attempt number (with jitter).
function nextDelayMs(attempt, now = Date.now()) {
  const idx = Math.min(clampAttempt(attempt) - 1, BACKOFF_MS.length - 1);
  const base = BACKOFF_MS[idx] || BACKOFF_MS[BACKOFF_MS.length - 1];
  const jitter = Math.round(base * 0.2 * Math.random());
  return Math.max(100, base + (Math.random() < 0.5 ? -jitter : jitter));
}

// Next absolute retry timestamp (ISO) for an attempt.
function nextRetryAt(attempt, now = Date.now()) {
  return new Date(now + nextDelayMs(attempt)).toISOString();
}

function isPermanentError(error) {
  if (!error) return false;
  const msg = String((error && (error.message || error)) || '');
  return PERMANENT_MARKERS.some(m => msg.includes(m));
}

function shouldRetry(error, attempt) {
  if (isExhausted(attempt)) return false;
  if (isPermanentError(error)) return false;
  return true;
}

// Classify an error for logging / dashboards.
function classifyError(error, attempt) {
  return {
    retryable: shouldRetry(error, attempt),
    permanent: isPermanentError(error),
    exhausted: isExhausted(attempt),
    attempt: clampAttempt(attempt),
    maxAttempts: MAX_ATTEMPTS,
    remaining: attemptsRemaining(attempt),
    delayMs: shouldRetry(error, attempt) ? nextDelayMs(attempt) : 0,
    category: isPermanentError(error) ? 'permanent' : 'transient',
  };
}

module.exports = {
  MAX_ATTEMPTS,
  BACKOFF_MS,
  isExhausted,
  attemptsRemaining,
  nextDelayMs,
  nextRetryAt,
  isPermanentError,
  shouldRetry,
  classifyError,
};
