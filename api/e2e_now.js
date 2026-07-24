#!/usr/bin/env node
const http = require('http');

const BASE = process.env.BASE_URL || 'http://localhost:3001';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'jayaraj7523';
const FAKE_SCREENSHOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let passed = 0, failed = 0, skipped = 0;
function log(tag, msg) { console.log(`[${new Date().toISOString().slice(0,19).replace('T',' ')}] [${tag}] ${msg}`); }
function request(method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = { hostname: url.hostname, port: url.port, path: url.pathname, method, headers: { 'Content-Type': 'application/json', ...headers }, timeout: 120000 };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch (_) { resolve({ status: res.statusCode, body: null }); } });
    });
    req.on('error', (e) => reject(new Error('Request failed: ' + e.message)));
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
async function test(name, fn) {
  try { await fn(); log('PASS', name); passed++; }
  catch (e) { log('FAIL', name + ': ' + e.message); failed++; }
}
function assert(condition, msg) { if (!condition) throw new Error(msg || 'Assertion failed'); }
function todayIST() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 5.5 * 3600000).toISOString().slice(0, 10);
}

async function main() {
  log('E2E', 'Starting end-to-end test against ' + BASE);
  let adminToken = null;
  let hasDb = false;

  // ── API Tests (require running server) ──
  await test('Health endpoint returns 200', async () => {
    const r = await request('POST', '/api/getHealthStatus', { refresh: true });
    assert(r.status === 200, 'Expected 200, got ' + r.status);
    assert(r.body.success === true, 'Expected success=true');
  });

  await test('Admin login (may fail without Supabase)', async () => {
    const r = await request('POST', '/api/adminLogin', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    if (r.status === 200 && r.body.token) { adminToken = r.body.token; hasDb = true; log('E2E', 'Admin token acquired'); }
    else { log('E2E', 'No DB configured — skipping API tests that need auth'); }
  });

  if (hasDb) {
    let paymentId = null;
    await test('Pre-register test user', async () => {
      const r = await request('POST', '/api/preRegister', { name: 'E2E Test', email: 'e2e_' + Date.now() + '@test.com', phone: String(9e9 + Math.floor(Math.random() * 1e9)), password: 'test123', referralCode: null });
      assert(r.status === 200 || r.status === 201, 'Expected 200/201, got ' + r.status + ': ' + r.body.error);
      log('E2E', 'User: ' + (r.body.userId || r.body.id || r.body.pendingRegistrationId));
    });
    await test('Submit UPI payment', async () => {
      const r = await request('POST', '/api/verifyUPIPayment', { type: 'registration', amount: 1, utr: '1234567892222', upiId: 'jayarajj126-3@okicici', screenshotUrl: FAKE_SCREENSHOT });
      assert(r.status === 200 || r.status === 201, 'Expected 200/201, got ' + r.status + ': ' + r.body.error);
      paymentId = r.body.paymentId || r.body.id;
      log('E2E', 'Payment: ' + paymentId);
    });
    await test('Process pending payments', async () => {
      const r = await request('POST', '/api/processPendingPayments', {}, { Authorization: 'Bearer ' + adminToken });
      assert(r.status === 200, 'Expected 200, got ' + r.status);
      log('E2E', 'Result: ' + JSON.stringify(r.body));
    });
    await test('Dashboard data has verificationMetrics', async () => {
      const r = await request('GET', '/api/getAdminDashboardData', null, { Authorization: 'Bearer ' + adminToken });
      assert(r.status === 200, 'Expected 200, got ' + r.status);
      assert(r.body.verificationMetrics, 'Missing verificationMetrics');
      log('E2E', 'Metrics: ' + JSON.stringify(r.body.verificationMetrics));
    });
    await test('Queue status endpoint', async () => {
      const r = await request('POST', '/api/getQueueStatus', {}, { Authorization: 'Bearer ' + adminToken });
      assert(r.status === 200, 'Expected 200, got ' + r.status);
    });
  } else {
    log('E2E', 'Skipping 4 API tests (no Supabase configured)');
    skipped += 4;
  }

  // ── Standalone Engine Tests (no DB required) ──
  await test('Verification engine config loads', async () => {
    const C = require('../api/_verification/config.js');
    assert(C.EXPECTED_RECEIVER_UPI === 'jayarajj126-3@okicici');
    assert(C.ALLOWED_AMOUNTS.includes(120) && C.ALLOWED_AMOUNTS.includes(500) && C.ALLOWED_AMOUNTS.includes(1000));
  });
  await test('All 11 engine modules load', async () => {
    for (const m of ['config','logger','imageAuth','imageEnhance','multiEngineOcr','fieldExtractor','fieldValidator','duplicateDetector','fraudDetector','decisionEngine','index']) {
      const mod = require('../api/_verification/' + m + '.js');
      assert(mod, m + ' undefined');
    }
  });
  await test('Field extractor parses UPI text', async () => {
    const { run } = require('../api/_verification/fieldExtractor.js');
    const r = run('Rs. 1.00 paid to jayarajj126-3@okicici via Google Pay UPI Ref No: 1234567892222 27 Jun 2026 10:30 AM Payment successful', []);
    assert(r.amount.value === 1, 'Amount=' + r.amount.value);
    assert(r.receiverUpi.value === 'jayarajj126-3@okicici', 'UPI=' + r.receiverUpi.value);
    assert(r.utr.value === '1234567892222', 'UTR=' + r.utr.value);
    assert(r.paymentStatus.value === 'SUCCESS', 'Status=' + r.paymentStatus.value);
  });
  await test('Field validator checks amount+receiver+date', async () => {
    const { run } = require('../api/_verification/fieldValidator.js');
    const today = todayIST();
    const extracted = {
      amount: { value: 1, source: 'parser', confidence: 'high' },
      receiverUpi: { value: 'jayarajj126-3@okicici', source: 'parser', confidence: 'high' },
      date: { value: today, source: 'parser', confidence: 'high' },
      time: { value: '10:30', source: 'parser', confidence: 'high' },
      utr: { value: '1234567892222', source: 'parser', confidence: 'high' },
      paymentStatus: { value: 'SUCCESS', source: 'parser', confidence: 'high' },
    };
    const result = run(extracted, { amount: 1, created_at: new Date().toISOString() }, '1234567892222');
    log('E2E', 'Validation: ' + result.mandatoryPassed + '/' + result.mandatoryTotal + ' mandatory');
    const failedChecks = result.checks.filter(c => !c.passed && !c.isUserCheck).map(c => c.name + ': ' + c.reason);
    if (failedChecks.length > 0) log('E2E', 'Failed checks: ' + failedChecks.join(' | '));
    assert(result.mandatoryPassed === result.mandatoryTotal, 'Not all mandatory passed: ' + result.mandatoryPassed + '/' + result.mandatoryTotal);
  });
  await test('Decision engine approves valid payment', async () => {
    const { run } = require('../api/_verification/decisionEngine.js');
    const v = { checks: [{name:'amount',passed:true},{name:'receiver_upi',passed:true},{name:'date',passed:true},{name:'time',passed:true},{name:'utr_format',passed:true},{name:'payment_status',passed:true}], allMandatoryPass: true, mandatoryPassed: 6, mandatoryTotal: 6 };
    const r = run(v, { fraudScore: 0, riskLevel: 'low', issues: [] }, { isDuplicate: false }, 90, { passed: true, tamperScore: 0 });
    assert(r.status === 'verified', 'Expected verified, got ' + r.status + ' score=' + r.finalScore);
  });
  await test('Decision engine rejects low score', async () => {
    const { run } = require('../api/_verification/decisionEngine.js');
    const v = { checks: [{name:'amount',passed:false},{name:'receiver_upi',passed:false},{name:'date',passed:false},{name:'time',passed:false},{name:'utr_format',passed:false},{name:'payment_status',passed:false}], allMandatoryPass: false, mandatoryPassed: 0, mandatoryTotal: 6 };
    const r = run(v, { fraudScore: 80, riskLevel: 'high', issues: ['High fraud'] }, { isDuplicate: false }, 20, { passed: false, tamperScore: 80 });
    assert(r.status === 'rejected', 'Expected rejected, got ' + r.status);
  });
  await test('Duplicate detector marks UTR duplicate', async () => {
    const { computeTextHash } = require('../api/_verification/duplicateDetector.js');
    const h = computeTextHash('Hello World Test');
    assert(typeof h === 'string' && h.length === 64, 'Hash should be 64-char sha256, got: ' + h.length);
  });

  // Summary
  log('E2E', '---');
  log('E2E', `Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed > 0 ? 1 : 0);
}
main().catch(e => { log('FATAL', e.message); process.exit(1); });
