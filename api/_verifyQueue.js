// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// VERIFICATION QUEUE + RETRY BOOKKEEPING  (api/_verifyQueue.js)
//
// Queue-based OCR/verification execution with DB-backed retry
// bookkeeping, safe for serverless:
//
//   * The DB is the source of truth. Every instance reads/writes
//     verification_attempts / next_retry_at / last_error on the
//     payment_sessions row â€” no shared in-memory state.
//   * claim(orderId) atomically takes the pendingâ†’processing slot
//     (conditionalUpdateDoc row-count), so concurrent polls/workers
//     can never double-verify the same order.
//   * recordFailure / recordSuccess persist the retry schedule.
//     On serverless the status poll re-drives retries (needsVerification
//     stays true until next_retry_at policy is satisfied). On local-dev
//     startWorker() drains due orders in-process.
//   * The synchronous verification path (submitPaymentProof via the
//     status poll) is ALWAYS the guaranteed path; this queue is an
//     additive harness, never a replacement.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const { COL_ORDERS } = require('./_shared.js');
// Dynamic lookup (not destructured at load) so unit tests can patch
// runQuery/updateDoc/conditionalUpdateDoc on the shared module.
const supabaseMod = require('./_supabase.js');
const retry = require('./_retryEngine.js');
const metrics = require('./_metrics.js');
const { broadcast } = require('./_sse.js');

const CLAIMABLE_STATUSES = ['pending', 'processing'];
let workerTimer = null;
let running = false;

function now() { return new Date().toISOString(); }

function log(msg) {
  console.log('[' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '] [VERIFY-QUEUE] ' + msg);
}

// Atomically claim the order for verification. Returns true when this
// instance won the race, false otherwise (409 semantics for callers).
async function claim(orderId) {
  try {
    const affected = await supabaseMod.conditionalUpdateDoc(COL_ORDERS, orderId, [
      { field: 'status', op: 'IN', value: CLAIMABLE_STATUSES },
      { field: 'id', op: 'EQUAL', value: orderId },
    ], { status: 'processing', verification_status: 'processing', updated_at: now() });
    if (affected > 0) metrics.trackQueueClaimed();
    return affected > 0;
  } catch (e) {
    console.warn('[VERIFY-QUEUE] claim failed for ' + orderId + ': ' + e.message);
    return false;
  }
}

// Atomic bookkeeping writes. The retry columns (verification_attempts /
// next_retry_at / last_error) come from migration 0003 and may not exist in
// the live DB yet — updateDocFiltered strips them so the record never aborts.
const HARDENING_COLS = ['screenshot_phash', 'verification_attempts', 'next_retry_at', 'last_error'];

// Persist a failed verification attempt and compute the next retry slot.
// Returns the persisted bookkeeping so callers can log it.
async function recordFailure(orderId, error, attemptsSoFar) {
  const attempts = (attemptsSoFar || 0) + 1;
  const policy = retry.classifyError(error, attempts);
  const nextMs = policy.exhausted || policy.permanent ? null : retry.nextRetryAt(attempts);
  const payload = {
    verification_attempts: attempts,
    last_error: String((error && error.message) || error).slice(0, 400),
    next_retry_at: nextMs ? new Date(nextMs).toISOString() : null,
    verification_status: policy.permanent || policy.exhausted ? 'failed' : 'pending',
    updated_at: now(),
  };
  await supabaseMod.updateDocFiltered(COL_ORDERS, orderId, payload, HARDENING_COLS).catch(e => log('recordFailure persist failed: ' + e.message));
  if (policy.permanent || policy.exhausted) metrics.trackRetryExhausted();
  else metrics.trackRetry();
  log('recordFailure order=' + orderId + ' attempts=' + attempts + ' retryable=' + policy.retryable + ' exhausted=' + policy.exhausted + ' next=' + payload.next_retry_at);
  return payload;
}

// Clear retry bookkeeping after a successful verification.
async function recordSuccess(orderId) {
  await supabaseMod.updateDocFiltered(COL_ORDERS, orderId, {
    verification_attempts: 0,
    last_error: null,
    next_retry_at: null,
    updated_at: now(),
  }, HARDENING_COLS).catch(e => log('recordSuccess persist failed: ' + e.message));
}

// Orders that are due for a verification attempt right now:
//   * stuck 'processing' orders (claimed by a dead instance / hung OCR) â€”
//     these are the highest priority because they are invisible to users.
//   * pending orders with a screenshot, not yet terminal, under the
//     attempt cap, and past their next_retry_at window.
async function dueOrders(limit = 20) {
  const rows = await supabaseMod.runQuery(COL_ORDERS, []).catch(() => []);
  if (!rows || !rows.length) return [];
  const nowIso = now();
  const stuck = (rows || []).filter(o => o.status === 'processing');
  const due = (rows || []).filter(o =>
    o.status === 'pending' &&
    !!o.screenshot_url &&
    (!o.verification_status || o.verification_status === 'pending') &&
    (!o.next_retry_at || o.next_retry_at <= nowIso) &&
    (o.verification_attempts || 0) < retry.MAX_ATTEMPTS
  );
  return [...stuck, ...due].slice(0, limit);
}

// Run one drain pass: claim each due order, then hand the verification
// work to the order manager. The claim is atomic so a concurrent poll or
// worker cannot also grab it. Errors are recorded, not thrown.
async function drainOnce() {
  if (running) return { running: true, claimed: 0 };
  running = true;
  let claimed = 0;
  try {
    const orders = await dueOrders(20);
    for (const order of orders) {
      const won = await claim(order.id);
      if (!won) continue;
      claimed++;
      metrics.trackQueueEnqueued();
      // Fire-and-forget the actual verification (submitPaymentProof has its
      // own 409 duplicate lock + atomic DB guards).
      require('./_paymentOrderManager.js').submitPaymentProof(
        order.id,
        order.screenshot_url,
        { userEnteredUtr: order.utr || null, userEnteredUpi: order.upi_id || null },
      ).then(() => metrics.trackQueueCompleted()).catch(e => {
        recordFailure(order.id, e, order.verification_attempts || 0).catch(e2 => log('recordFailure failed: ' + e2.message));
        metrics.trackQueueCompleted();
      });
      try { broadcast('queueProcessed', { orderId: order.id }); } catch (e) { log('Broadcast queueProcessed failed: ' + e.message); }
    }
    if (claimed) log('drained ' + claimed + ' order(s)');
  } catch (e) {
    console.warn('[VERIFY-QUEUE] drain error: ' + e.message);
  } finally {
    running = false;
  }
  return { running: false, claimed };
}

// Local-dev only: poll the DB for due work on an interval. Never started
// on serverless (VERCEL) â€” the status poll drives verification there.
function startWorker(intervalMs = 5000) {
  if (process.env.VERCEL) return { started: false, reason: 'serverless' };
  if (workerTimer) return { started: true, reason: 'already' };
  workerTimer = setInterval(() => { drainOnce().catch(() => {}); }, intervalMs);
  log('worker started (interval ' + intervalMs + 'ms)');
  return { started: true };
}

function stopWorker() {
  if (workerTimer) { clearInterval(workerTimer); workerTimer = null; log('worker stopped'); }
}

// Dashboard bookkeeping â€” counts for the queue status / health endpoints.
async function getBookkeeping() {
  const rows = await supabaseMod.runQuery(COL_ORDERS, []).catch(() => []);
  if (!rows || !rows.length) {
    return { total: 0, processing: 0, pendingWithScreenshot: 0, retryBacklog: 0, retriesExhausted: 0, dueNow: 0, maxAttempts: retry.MAX_ATTEMPTS, backoff: retry.BACKOFF_MS };
  }
  const nowIso = now();
  const total = rows.length;
  const processing = rows.filter(o => o.status === 'processing').length;
  const pendingWithScreenshot = rows.filter(o => o.status === 'pending' && !!o.screenshot_url).length;
  const retryBacklog = rows.filter(o => (o.verification_attempts || 0) > 0 && o.status !== 'verified' && o.status !== 'rejected').length;
  const retriesExhausted = rows.filter(o => (o.verification_attempts || 0) >= retry.MAX_ATTEMPTS).length;
  const dueNow = rows.filter(o =>
    (o.status === 'processing') ||
    (o.status === 'pending' && !!o.screenshot_url && (!o.next_retry_at || o.next_retry_at <= nowIso) && (o.verification_attempts || 0) < retry.MAX_ATTEMPTS)
  ).length;
  return { total, processing, pendingWithScreenshot, retryBacklog, retriesExhausted, dueNow, maxAttempts: retry.MAX_ATTEMPTS, backoff: retry.BACKOFF_MS };
}

module.exports = {
  claim, recordFailure, recordSuccess, dueOrders, drainOnce,
  startWorker, stopWorker, getBookkeeping,
};

