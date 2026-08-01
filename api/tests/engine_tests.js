// ENGINE UNIT TESTS — runs the single verification facade offline.
//
// Covers: default strict threshold (98), healthy ₹120/₹500/₹1000,
// negative cases (wrong amount / wrong UPI / old date / FAILED status /
// duplicate UTR), and proves the `checks` array contract.
//
// The auto-approve end-to-end path (relaxed threshold) is verified in a
// child process (engine_approve_check.js) so the strict default bar stays
// untouched. Run: node api/tests/engine_tests.js

const assert = require('assert');
const path = require('path');
const { genPhonePeScreenshot } = require('./gen_screenshot.js');
const supabase = require('../_supabase.js');

// ── 1. Default strict auto-approval bar must be 98 ──
const C = require('../_newEngine/config.js');
assert.strictEqual(C.CONFIDENCE_APPROVE, 98, 'default AUTO_APPROVE_CONFIDENCE must be 98');
assert.strictEqual(C.DECISION.MANUAL_REVIEW, 'manual_review');

const { verifySession } = require('../_verificationEngine.js');

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
    console.log('  [FAIL] ' + name + ' — ' + e.message);
  }
}

function makeOrder(overrides) {
  return Object.assign({
    id: 'ORD-TEST-' + Math.floor(Math.random() * 1e9),
    type: 'registration',
    amount: 120,
    status: 'pending',
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    pending_reg_id: 'PR-TEST-1',
    user_id: null,
    utr: null,
  }, overrides || {});
}

function hasCheck(checks, name) {
  return (checks || []).find(c => c.name === name);
}

function missingItems(reasons) {
  return (reasons || []).filter(r => r.startsWith('Missing: '));
}

function assertHealthy(v, label) {
  assert.ok(Array.isArray(v.checks), label + ': checks must be an array');
  const amt = hasCheck(v.checks, 'amount'); assert.ok(amt && amt.passed, label + ': amount check passed');
  const upi = hasCheck(v.checks, 'upi_id'); assert.ok(upi && upi.passed, label + ': upi check passed');
  const st = hasCheck(v.checks, 'status'); assert.ok(st && st.passed, label + ': status check passed');
  const dt = hasCheck(v.checks, 'date'); assert.ok(dt && dt.passed, label + ': date check passed');
  const utr = hasCheck(v.checks, 'utr'); assert.ok(utr && utr.passed, label + ': utr check passed');
  assert.ok(v.status === 'verified' || v.status === 'manual_review', label + ': status is verified or manual_review (got ' + v.status + ')');
  if (v.status === 'manual_review') {
    const missing = missingItems(v.reasons);
    assert.strictEqual(missing.length, 1, label + ': only confidence missing — reasons=' + (v.reasons || []).join('; '));
    assert.ok(/OCR confidence >= 98/.test(missing[0]), label + ': missing reason is the confidence bar');
  }
  return v;
}

(async () => {
  console.log('== VERIFICATION ENGINE UNIT TESTS ==');

  await test('default strict confidence bar = 98', async () => {
    assert.strictEqual(C.CONFIDENCE_APPROVE, 98);
  });

  const utrA = '1234567892222';
  const utrB = '9988776655443';
  const utrC = '1122334455667';
  const utrDup = '8877665544332';

  // ── HEALTHY CASES ──
  const healthy120 = await genPhonePeScreenshot({ amount: '120.00', utr: utrA, upi: 'jayarajj126-3@okicici', name: 'JEYARAJ ALAGAR' });
  await test('registration ₹120 healthy → verified/manual_review, all checks pass', async () => {
    const v = await verifySession(makeOrder({ type: 'registration', amount: 120, utr: utrA }), healthy120.dataUrl, null, utrA, null, healthy120.buffer);
    assertHealthy(v, 'reg120');
  });

  const healthy500 = await genPhonePeScreenshot({ amount: '500.00', utr: utrB, upi: 'jayarajj126-3@okicici', name: 'JEYARAJ ALAGAR' });
  await test('topup ₹500 healthy → verified/manual_review, all checks pass', async () => {
    const v = await verifySession(makeOrder({ type: 'topup', amount: 500, user_id: 'u-test', utr: utrB }), healthy500.dataUrl, 'u-test', utrB, null, healthy500.buffer);
    assertHealthy(v, 'topup500');
  });

  const healthy1000 = await genPhonePeScreenshot({ amount: '1000.00', utr: utrC, upi: 'jayarajj126-3@okicici', name: 'JEYARAJ ALAGAR' });
  await test('topup ₹1000 healthy → verified/manual_review, all checks pass', async () => {
    const v = await verifySession(makeOrder({ type: 'topup', amount: 1000, user_id: 'u-test', utr: utrC }), healthy1000.dataUrl, 'u-test', utrC, null, healthy1000.buffer);
    assertHealthy(v, 'topup1000');
  });

  // ── NEGATIVE CASES ──
  const wrongAmt = await genPhonePeScreenshot({ amount: '500.00', utr: utrA, upi: 'jayarajj126-3@okicici', name: 'JEYARAJ ALAGAR' });
  await test('wrong amount (500 paid vs 120 expected) → manual_review, amount check fails', async () => {
    const v = await verifySession(makeOrder({ amount: 120, utr: utrA }), wrongAmt.dataUrl, null, utrA, null, wrongAmt.buffer);
    assert.strictEqual(v.status, 'manual_review');
    const amt = hasCheck(v.checks, 'amount');
    assert.ok(amt && !amt.passed, 'amount check must fail');
  });

  const wrongUpi = await genPhonePeScreenshot({ amount: '120.00', utr: utrA, upi: 'someone@okhdfcbank', name: 'SOMEONE ELSE' });
  await test('wrong receiver UPI → manual_review, upi check fails', async () => {
    const v = await verifySession(makeOrder({ amount: 120, utr: utrA }), wrongUpi.dataUrl, null, utrA, null, wrongUpi.buffer);
    assert.strictEqual(v.status, 'manual_review');
    const upi = hasCheck(v.checks, 'upi_id');
    assert.ok(upi && !upi.passed, 'upi check must fail');
  });

  const oldDate = await genPhonePeScreenshot({ amount: '120.00', utr: utrA, upi: 'jayarajj126-3@okicici', name: 'JEYARAJ ALAGAR', date: '01/01/2020' });
  await test('old transaction date → manual_review, date check fails', async () => {
    const v = await verifySession(makeOrder({ amount: 120, utr: utrA }), oldDate.dataUrl, null, utrA, null, oldDate.buffer);
    assert.strictEqual(v.status, 'manual_review');
    const dt = hasCheck(v.checks, 'date');
    assert.ok(dt && !dt.passed, 'date check must fail');
  });

  const failedStatus = await genPhonePeScreenshot({ amount: '120.00', utr: utrA, upi: 'jayarajj126-3@okicici', name: 'JEYARAJ ALAGAR', status: 'FAILED' });
  await test('FAILED transaction status → rejected (hard fail)', async () => {
    const v = await verifySession(makeOrder({ amount: 120, utr: utrA }), failedStatus.dataUrl, null, utrA, null, failedStatus.buffer);
    assert.strictEqual(v.status, 'rejected');
  });

  const dupShot = await genPhonePeScreenshot({ amount: '120.00', utr: utrDup, upi: 'jayarajj126-3@okicici', name: 'JEYARAJ ALAGAR' });
  await test('duplicate UTR → rejected (duplicate detection)', async () => {
    const realRunQuery = supabase.runQuery;
    supabase.runQuery = async (table, filters) => {
      if (table === 'upi_payments' && filters.some(f => f.field === 'utr_hash')) {
        return [{ id: 'dup-existing', status: 'verified' }];
      }
      return [];
    };
    try {
      const v = await verifySession(makeOrder({ amount: 120, utr: utrDup }), dupShot.dataUrl, null, utrDup, null, dupShot.buffer);
      assert.strictEqual(v.status, 'rejected', 'duplicate UTR must reject');
      const dup = hasCheck(v.checks, 'duplicate');
      assert.ok(dup && !dup.passed, 'duplicate check must fail');
    } finally {
      supabase.runQuery = realRunQuery;
    }
  });

  console.log('\n== RESULT: ' + passed + ' passed, ' + failed + ' failed ==');
  if (failures.length) {
    for (const f of failures) console.error('FAILED: ' + f.name + ' — ' + f.error);
    process.exit(1);
  }
  process.exit(0);
})().catch(e => { console.error('HARNESS ERROR:', e.message, e.stack); process.exit(1); });
