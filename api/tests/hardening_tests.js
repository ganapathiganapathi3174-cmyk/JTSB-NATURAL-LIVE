// ─────────────────────────────────────────────────────────────
// HARDENING UNIT TESTS  (api/tests/hardening_tests.js)
//
// Offline, zero-env tests for the production-hardening layer:
//   * Payment state machine (_stateMachine.js)
//   * Retry engine (_retryEngine.js)
//   * Perceptual hash / dHash (_newEngine/phash.js)
//   * Extended duplicate checker (SHA256 UTR + SHA256 screenshot + pHash)
//   * Metrics (verification + timings)
//   * Audit logger idempotency (_auditLogger.js)
//   * Notification idempotency (_notificationService.js)
//   * Verification queue bookkeeping (_verifyQueue.js)
//
// Supabase calls are patched via dynamic lookup (the modules read
// _supabase.js exports at call time), so nothing hits the network.
//
// Run: node api/tests/hardening_tests.js
// ─────────────────────────────────────────────────────────────

const assert = require('assert');
const crypto = require('crypto');

const sm = require('../_stateMachine.js');
const retry = require('../_retryEngine.js');
const phash = require('../_newEngine/phash.js');
const metrics = require('../_metrics.js');
const audit = require('../_auditLogger.js');
const notify = require('../_notificationService.js');
const supabase = require('../_supabase.js');
const dupChecker = require('../_newEngine/duplicateChecker.js');
const verifyQueue = require('../_verifyQueue.js');
const C = require('../_newEngine/config.js');
const { genPhonePeScreenshot } = require('./gen_screenshot.js');
const { Jimp } = require('jimp');

// Inverted copy — structurally different (flips every dHash bit on average).
async function invertedPng(buf) {
  const img = await Jimp.read(buf);
  img.invert();
  return img.getBuffer('image/png');
}

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  [PASS] ' + name);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log('  [FAIL] ' + name + ' - ' + e.message);
  }
}

function randomBuf(bytes) {
  return crypto.randomBytes(bytes);
}

// A valid PNG buffer (Jimp.decode-able) — raw random bytes are not an image.
async function pngBuf(opts) {
  const shot = await genPhonePeScreenshot(opts || {});
  return shot.buffer;
}

const originalRunQuery = supabase.runQuery;
const originalUpdateDoc = supabase.updateDoc;
const originalConditionalUpdateDoc = supabase.conditionalUpdateDoc;
const originalAddDoc = supabase.addDoc;

function patchSupabase({ runQuery, updateDoc, conditionalUpdateDoc, addDoc } = {}) {
  if (runQuery !== undefined) supabase.runQuery = runQuery;
  if (updateDoc !== undefined) supabase.updateDoc = updateDoc;
  if (conditionalUpdateDoc !== undefined) supabase.conditionalUpdateDoc = conditionalUpdateDoc;
  if (addDoc !== undefined) supabase.addDoc = addDoc;
}

function restoreSupabase() {
  supabase.runQuery = originalRunQuery;
  supabase.updateDoc = originalUpdateDoc;
  supabase.conditionalUpdateDoc = originalConditionalUpdateDoc;
  supabase.addDoc = originalAddDoc;
}

async function main() {
  // ── 1. State machine ──
  await test('state machine: legal transitions allowed', () => {
    for (const [from, to] of [['pending', 'verified'], ['pending', 'processing'], ['pending', 'manual_review'], ['processing', 'verified'], ['processing', 'pending'], ['verified', 'pending'], ['verified', 'refunded'], ['rejected', 'pending'], ['expired', 'pending'], ['manual_review', 'rejected']]) {
      assert.ok(sm.canTransition(from, to), 'expected allowed: ' + from + ' -> ' + to);
      assert.ok(sm.transition(from, to).allowed, 'transition() should allow: ' + from + ' -> ' + to);
    }
  });

  await test('state machine: illegal transitions rejected', () => {
    for (const [from, to] of [['pending', 'refunded'], ['refunded', 'pending'], ['verified', 'rejected'], ['pending', 'bogus'], ['bogus', 'pending']]) {
      assert.ok(!sm.canTransition(from, to), 'expected illegal: ' + from + ' -> ' + to);
      assert.ok(!sm.transition(from, to).allowed, 'transition() should reject: ' + from + ' -> ' + to);
      assert.ok(sm.transition(from, to).reason, 'illegal transition must carry a reason');
    }
  });

  await test('state machine: terminal / attention / verifiable classification', () => {
    assert.ok(sm.isTerminal('verified'));
    assert.ok(sm.isTerminal('rejected'));
    assert.ok(sm.isTerminal('refunded'));
    assert.ok(!sm.isTerminal('pending'));
    assert.ok(sm.needsAttention('manual_review'));
    assert.ok(sm.needsAttention('failed'));
    assert.ok(!sm.needsAttention('pending'));
    assert.ok(sm.isVerifiable('pending'));
    assert.ok(sm.isVerifiable('processing'));
    assert.ok(sm.isVerifiable('manual_review'));
    assert.ok(!sm.isVerifiable('verified'));
  });

  await test('state machine: nextStates matches canonical map', () => {
    assert.deepStrictEqual(sm.nextStates('pending').sort(), ['expired', 'failed', 'manual_review', 'processing', 'rejected', 'verified'].sort());
    assert.ok(sm.nextStates('bogus').length === 0);
  });

  // ── 2. Retry engine ──
  await test('retry engine: exhaustion at MAX_ATTEMPTS', () => {
    assert.ok(retry.MAX_ATTEMPTS >= 2, 'MAX_ATTEMPTS default must be sane');
    assert.ok(!retry.isExhausted(0));
    assert.ok(!retry.isExhausted(retry.MAX_ATTEMPTS - 1));
    assert.ok(retry.isExhausted(retry.MAX_ATTEMPTS));
    assert.ok(retry.attemptsRemaining(0) === retry.MAX_ATTEMPTS);
    assert.ok(retry.attemptsRemaining(retry.MAX_ATTEMPTS) === 0);
  });

  await test('retry engine: backoff with +/-20% jitter bounds', () => {
    for (let attempt = 1; attempt <= retry.BACKOFF_MS.length; attempt++) {
      const base = retry.BACKOFF_MS[attempt - 1];
      const delay = retry.nextDelayMs(attempt);
      assert.ok(delay >= base * 0.8, 'delay ' + delay + ' below 80% of ' + base);
      assert.ok(delay <= base * 1.2, 'delay ' + delay + ' above 120% of ' + base);
    }
  });

  await test('retry engine: nextRetryAt returns a future ISO timestamp', () => {
    const iso = retry.nextRetryAt(1);
    const t = Date.parse(iso);
    assert.ok(!isNaN(t), 'nextRetryAt must parse as a date');
    assert.ok(t > Date.now() - 1000, 'nextRetryAt must be in the future');
  });

  await test('retry engine: permanent error markers detected', () => {
    assert.ok(retry.isPermanentError('PAYMENT_SESSION_EXPIRED'));
    assert.ok(retry.isPermanentError('Order already verified'));
    assert.ok(retry.isPermanentError('BAD_DATA'));
    assert.ok(!retry.isPermanentError('boom'));
  });

  await test('retry engine: classifyError categories', () => {
    const transient = retry.classifyError(new Error('temporary hiccup'));
    assert.ok(transient.retryable === true);
    assert.ok(transient.permanent === false);
    assert.ok(transient.exhausted === false);
    assert.ok(transient.remaining === retry.MAX_ATTEMPTS);

    const permanent = retry.classifyError(new Error('PAYMENT_SESSION_EXPIRED'));
    assert.ok(permanent.permanent === true);
    assert.ok(permanent.retryable === false);

    const exhausted = retry.classifyError(new Error('boom'), retry.MAX_ATTEMPTS);
    assert.ok(exhausted.exhausted === true);
    assert.ok(exhausted.retryable === false);

    assert.ok(retry.shouldRetry(new Error('x'), 0) === true);
    assert.ok(retry.shouldRetry(new Error('x'), retry.MAX_ATTEMPTS) === false);
    assert.ok(retry.shouldRetry(new Error('Order already verified'), 0) === false);
  });

  // ── 3. Perceptual hash (dHash) ──
  await test('pHash: 64-bit hex format + null guard', async () => {
    const buf = await pngBuf({ utr: '1111111111111' });
    const h = await phash.computePhash(buf);
    assert.ok(h && /^[0-9a-f]{16}$/.test(h), 'computePhash must return 16-char hex, got ' + h);
    assert.ok(phash.BITS === 64);
    assert.strictEqual(await phash.computePhash(null), null);
    assert.strictEqual(await phash.computePhash('nope'), null);
  });

  await test('pHash: identical buffers distance 0, hex round-trip 64 bits', async () => {
    const buf = await pngBuf({ utr: '1111111111111' });
    const h1 = await phash.computePhash(buf);
    const h2 = await phash.computePhash(buf);
    assert.strictEqual(h1, h2);
    assert.strictEqual(phash.hammingDistance(h1, h2), 0);
    assert.ok(phash.isSimilar(h1, h2));
    assert.strictEqual(phash.hexToBin(h1).length, 64);
  });

  await test('pHash: different images are not similar', async () => {
    const bufA = await pngBuf({ utr: '1111111111111' });
    const bufB = await invertedPng(bufA);
    const hA = await phash.computePhash(bufA);
    const hB = await phash.computePhash(bufB);
    const dist = phash.hammingDistance(hA, hB);
    assert.ok(dist > C.PHASH_THRESHOLD, 'different screenshots should differ by > threshold, distance=' + dist);
    assert.ok(!phash.isSimilar(hA, hB, C.PHASH_THRESHOLD));
  });

  await test('pHash: threshold controls similarity decision', async () => {
    const buf = await pngBuf({ utr: '1111111111111' });
    const h = await phash.computePhash(buf);
    assert.ok(phash.isSimilar(h, h, 1));
  });

  // ── 4. Duplicate checker (patched runQuery) ──
  await test('duplicate checker: UTR SHA-256 hit', async () => {
    const utr = '1234567890123';
    const utrHash = crypto.createHash('sha256').update(utr.toUpperCase().trim()).digest('hex');
    patchSupabase({
      runQuery: async (table, filters, options) => {
        if (filters && filters[0] && filters[0].field === 'utr_hash' && filters[0].value === utrHash) return [{ id: 'pay_old', status: 'verified' }];
        return [];
      },
    });
    try {
      const r = await dupChecker.checkDuplicate(utr, randomBuf(2048), { paymentId: 'pay_cur' });
      assert.strictEqual(r.duplicate, true);
      assert.strictEqual(r.type, 'duplicate_utr');
      assert.strictEqual(r.existingId, 'pay_old');
      assert.strictEqual(r.utrHash, utrHash);
    } finally {
      restoreSupabase();
    }
  });

  await test('duplicate checker: current payment excluded', async () => {
    const utr = '9998887776665';
    patchSupabase({
      runQuery: async (table, filters, options) => {
        if (filters && filters[0] && filters[0].field === 'utr_hash') return [{ id: 'pay_same', status: 'verified' }];
        return [];
      },
    });
    try {
      const r = await dupChecker.checkDuplicate(utr, randomBuf(2048), { paymentId: 'pay_same' });
      assert.strictEqual(r.duplicate, false, 'own payment must be excluded');
    } finally {
      restoreSupabase();
    }
  });

  await test('duplicate checker: pHash near-identical hit', async () => {
    const buf = await pngBuf({ utr: '1111111111111' });
    const h = await phash.computePhash(buf);
    patchSupabase({
      runQuery: async (table, filters, options) => {
        if (filters && filters[0] && filters[0].field === 'utr_hash') return [];
        if (filters && filters[0] && filters[0].field === 'screenshot_hash') return [];
        if (options && options.limit === C.PHASH_SCAN_LIMIT) return [{ id: 'pay_img', screenshot_phash: h, status: 'verified' }];
        return [];
      },
    });
    try {
      const r = await dupChecker.checkDuplicate('5556667778889', buf, { paymentId: 'pay_cur' });
      assert.strictEqual(r.duplicate, true);
      assert.strictEqual(r.type, 'duplicate_phash');
      assert.strictEqual(r.phash, h);
      assert.ok(r.reasons[0].includes('distance='), 'phash reason must include distance');
    } finally {
      restoreSupabase();
    }
  });

  await test('duplicate checker: no hits -> false, hashes still computed', async () => {
    patchSupabase({ runQuery: async () => [] });
    try {
      const buf = await pngBuf({ utr: '4443332221110' });
      const r = await dupChecker.checkDuplicate('4443332221110', buf, { paymentId: 'pay_cur' });
      assert.strictEqual(r.duplicate, false);
      assert.ok(r.utrHash && /^[0-9a-f]{64}$/.test(r.utrHash));
      assert.ok(r.screenshotHash && /^[0-9a-f]{64}$/.test(r.screenshotHash));
      assert.ok(r.phash && /^[0-9a-f]{16}$/.test(r.phash));
    } finally {
      restoreSupabase();
    }
  });

  await test('duplicate checker: DB errors degrade to no-crash false', async () => {
    patchSupabase({ runQuery: async () => { throw new Error('SUPABASE_URL not set'); } });
    try {
      const r = await dupChecker.checkDuplicate('1112223334445', randomBuf(2048), { paymentId: 'pay_cur' });
      assert.strictEqual(r.duplicate, false);
    } finally {
      restoreSupabase();
    }
  });

  // ── 5. Metrics (verification + timings) ──
  await test('metrics: verification result + timing windows recorded', () => {
    metrics.resetMetrics();
    metrics.trackVerificationResult('verified', 1200, { ocr: { ms: 500 }, duplicate: { ms: 100 }, decision: { ms: 20 } });
    metrics.trackVerificationResult('manual_review', 900);
    const m = metrics.getMetrics();
    assert.strictEqual(m.verification.attempts, 2);
    assert.strictEqual(m.verification.successes, 1);
    assert.strictEqual(m.verification.manualReview, 1);
    assert.strictEqual(m.timings.verify_ms.count, 2);
    assert.strictEqual(m.timings.verify_ms.min_ms, 900);
    assert.strictEqual(m.timings.verify_ms.max_ms, 1200);
    assert.strictEqual(m.timings.ocr_ms.count, 1);
    assert.strictEqual(m.timings.ocr_ms.max_ms, 500);
    assert.strictEqual(m.timings.decision_ms.max_ms, 20);
  });

  await test('metrics: lifecycle + retry counters', () => {
    metrics.resetMetrics();
    metrics.trackLifecycle('submit_to_verify_ms', 500);
    metrics.trackLifecycle('submit_to_verify_ms', 700);
    metrics.trackRetry();
    metrics.trackRetryExhausted();
    metrics.trackStaleRecovered();
    metrics.trackQueueEnqueued();
    metrics.trackQueueClaimed();
    metrics.trackQueueCompleted();
    const m = metrics.getMetrics();
    assert.strictEqual(m.timings.lifecycle.submit_to_verify_ms.count, 2);
    assert.strictEqual(m.timings.lifecycle.submit_to_verify_ms.avg_ms, 600);
    assert.strictEqual(m.verification.retries, 1);
    assert.strictEqual(m.verification.retriesExhausted, 1);
    assert.strictEqual(m.verification.recoveredStale, 1);
    assert.strictEqual(m.verification.queueEnqueued, 1);
    assert.strictEqual(m.verification.queueClaimed, 1);
    assert.strictEqual(m.verification.queueCompleted, 1);
  });

  // ── 6. Audit logger idempotency ──
  await test('audit logger: transition audit written + idempotent', async () => {
    patchSupabase({ addDoc: async () => ({ id: 'audit_1' }) });
    try {
      audit.resetForTests();
      const order = { id: 'ORD-TEST-1', status: 'pending', type: 'registration', amount: 120, user_id: 'u1' };
      const first = await audit.logTransition(order, 'verified', { trigger: 'auto' });
      assert.ok(first === true, 'first transition audit should write');
      const second = await audit.logTransition(order, 'verified', { trigger: 'auto' });
      assert.ok(second === false, 'duplicate transition audit must be skipped');
    } finally {
      restoreSupabase();
    }
  });

  await test('audit logger: illegal transitions refused', async () => {
    patchSupabase({ addDoc: async () => ({ id: 'audit_2' }) });
    try {
      audit.resetForTests();
      const order = { id: 'ORD-TEST-2', status: 'pending' };
      const r = await audit.logTransition(order, 'refunded', { warn: false });
      assert.ok(r === false, 'illegal transition must not be audited');
    } finally {
      restoreSupabase();
    }
  });

  // ── 7. Notification idempotency ──
  await test('notification service: idempotent per type:receiver:reference', async () => {
    patchSupabase({ addDoc: async () => ({ id: 'notif_1' }) });
    try {
      notify.resetForTests();
      const opts = { receiverId: 'u1', title: 'Manual Review', message: 'm', type: 'payment_manual_review', referenceId: 'ORD-TEST-3' };
      assert.strictEqual(await notify.notify(opts), true);
      assert.strictEqual(await notify.notify(opts), false, 'duplicate must be skipped');
      assert.strictEqual(await notify.notify({ ...opts, referenceId: 'ORD-TEST-4' }), true, 'new reference is a new notification');
      notify.resetForTests();
      assert.strictEqual(await notify.notify(opts), true, 'resetForTests re-enables dedup');
    } finally {
      restoreSupabase();
    }
  });

  // ── 8. Verification queue bookkeeping ──
  await test('verifyQueue: claim returns race winner', async () => {
    patchSupabase({ conditionalUpdateDoc: async () => 1 });
    try {
      assert.strictEqual(await verifyQueue.claim('ORD-C1'), true);
    } finally { restoreSupabase(); }
    patchSupabase({ conditionalUpdateDoc: async () => 0 });
    try {
      assert.strictEqual(await verifyQueue.claim('ORD-C2'), false, 'lost claim must return false');
    } finally { restoreSupabase(); }
  });

  await test('verifyQueue: recordFailure persists retry schedule', async () => {
    metrics.resetMetrics();
    let captured = null;
    patchSupabase({ updateDoc: async (table, id, data) => { captured = data; return true; } });
    try {
      const p = await verifyQueue.recordFailure('ORD-R1', new Error('transient'), 1);
      assert.strictEqual(captured.verification_attempts, 2);
      assert.strictEqual(p.verification_attempts, 2);
      assert.ok(captured.next_retry_at && !isNaN(Date.parse(captured.next_retry_at)), 'transient failure must schedule a retry');
      assert.strictEqual(captured.verification_status, 'pending');
      assert.ok(metrics.getMetrics().verification.retries >= 1);

      captured = null;
      const p2 = await verifyQueue.recordFailure('ORD-R2', new Error('PAYMENT_SESSION_EXPIRED'), 0);
      assert.strictEqual(p2.verification_attempts, 1);
      assert.strictEqual(captured.next_retry_at, null, 'permanent errors must not be retried');
      assert.strictEqual(captured.verification_status, 'failed');
      assert.ok(metrics.getMetrics().verification.retriesExhausted >= 1);
    } finally { restoreSupabase(); }
  });

  await test('verifyQueue: dueOrders filters retryable + stuck', async () => {
    const past = new Date(Date.now() - 60000).toISOString();
    const future = new Date(Date.now() + 60000).toISOString();
    const rows = [
      { id: 'ORD-D1', status: 'processing' },
      { id: 'ORD-D2', status: 'pending', screenshot_url: 'x', verification_status: 'pending', next_retry_at: past, verification_attempts: 1 },
      { id: 'ORD-D3', status: 'pending', screenshot_url: 'x', verification_status: 'pending', next_retry_at: future, verification_attempts: 0 },
      { id: 'ORD-D4', status: 'pending', screenshot_url: 'x', verification_status: 'pending', next_retry_at: past, verification_attempts: 99 },
      { id: 'ORD-D5', status: 'pending', screenshot_url: null, verification_attempts: 0 },
      { id: 'ORD-D6', status: 'verified' },
    ];
    patchSupabase({ runQuery: async () => rows });
    try {
      const due = await verifyQueue.dueOrders(20);
      const ids = due.map(o => o.id).sort();
      assert.deepStrictEqual(ids, ['ORD-D1', 'ORD-D2']);
    } finally { restoreSupabase(); }
  });

  await test('verifyQueue: getBookkeeping aggregates state', async () => {
    const past = new Date(Date.now() - 60000).toISOString();
    const rows = [
      { id: 'B1', status: 'processing', verification_attempts: 0 },
      { id: 'B2', status: 'pending', screenshot_url: 'x', next_retry_at: past, verification_attempts: 1 },
      { id: 'B3', status: 'pending', screenshot_url: 'x', next_retry_at: past, verification_attempts: retry.MAX_ATTEMPTS },
      { id: 'B4', status: 'verified', verification_attempts: 0 },
    ];
    patchSupabase({ runQuery: async () => rows });
    try {
      const b = await verifyQueue.getBookkeeping();
      assert.strictEqual(b.total, 4);
      assert.strictEqual(b.processing, 1);
      assert.strictEqual(b.pendingWithScreenshot, 2);
      assert.strictEqual(b.retryBacklog, 2);
      assert.strictEqual(b.retriesExhausted, 1);
      assert.strictEqual(b.dueNow, 2);
      assert.strictEqual(b.maxAttempts, retry.MAX_ATTEMPTS);
    } finally { restoreSupabase(); }
  });

  console.log('== RESULT: ' + passed + ' passed, ' + failed + ' failed ==');
  if (failed > 0) {
    console.error('FAILURES:');
    for (const f of failures) console.error('  - ' + f.name + ': ' + f.error);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('[HARDENING] main error: ' + (e && e.message));
  process.exit(1);
});
