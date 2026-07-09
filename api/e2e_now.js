// E2E Test Script — Tests complete payment flow via HTTP APIs only (no DB)
// Run: node api/e2e_now.js
// Requires: API server running on localhost:3001

const http = require('http');

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3001';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'jayaraj@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'jayaraj7523';

let results = { passed: 0, failed: 0, errors: [] };

function assert(condition, message) {
  if (condition) {
    results.passed++;
    console.log(`  \u2705 ${message}`);
  } else {
    results.failed++;
    results.errors.push(message);
    console.log(`  \u274c ${message}`);
  }
}

function httpRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 3001,
      path: url.pathname,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function pad(n) { return n.toString().padStart(2, '0'); }

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function runE2ETest() {
  console.log('\n' + '='.repeat(55));
  console.log('  E2E Test \u2014 Full Payment Flow');
  console.log('='.repeat(55));
  console.log(`  Admin: ${ADMIN_EMAIL}`);
  console.log(`  Server: ${BASE_URL}`);
  console.log('='.repeat(55));

  // ── Step 1: Admin Login ──
  console.log('\n\uD83D\uDCCC Step 1: Admin Login');
  const loginRes = await httpRequest('POST', '/api/adminLogin', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  assert(loginRes.status === 200, `Login returned ${loginRes.status}`);
  assert(!!loginRes.body?.token, 'Auth token received');
  const adminToken = loginRes.body.token;
  const adminInfo = loginRes.body.admin;
  if (adminInfo) console.log(`  Logged in as: ${adminInfo.email} (${adminInfo.role})`);

  // ── Step 2: Pre-register a test user ──
  console.log('\n\uD83D\uDCCC Step 2: User Registration');
  const ts = Date.now();
  const testEmail = `e2e_${ts}@test.com`;
  const testPhone = `999999${String(ts).slice(-6)}`;
  const regRes = await httpRequest('POST', '/api/preRegister', {
    name: 'E2E Test User',
    email: testEmail,
    phone: testPhone,
    password: 'Test@123',
    referralCode: null,
  });
  assert(regRes.status === 200, `Registration returned ${regRes.status}`);
  const pendingRegId = regRes.body?.pendingRegId;
  assert(!!pendingRegId, `pendingRegId received: ${pendingRegId}`);

  // ── Step 3: Submit UPI Payment ──
  console.log('\n\uD83D\uDCCC Step 3: Submit UPI Payment');
  const utr = `E2E${ts}${Math.random().toString(36).slice(2, 6)}`.toUpperCase().slice(0, 12);
  const payRes = await httpRequest('POST', '/api/verifyUPIPayment', {
    pendingRegId,
    type: 'registration',
    amount: 120,
    utr,
    upiId: 'jayarajj-3@okicici',
    paymentDate: todayStr(),
    screenshotUrl: 'https://example.com/e2e_test.png',
  });
  assert(payRes.status === 200, `Payment submission returned ${payRes.status}`);
  const paymentId = payRes.body?.paymentId;
  assert(!!paymentId, `paymentId received: ${paymentId}`);
  console.log(`  UTR: ${utr}`);
  console.log(`  Initial status: ${payRes.body?.status}`);

  // ── Step 4: Process Pending Payments ──
  console.log('\n\uD83D\uDCCC Step 4: Process Pending Payments');
  const procRes = await httpRequest('POST', '/api/processPendingPayments', {}, adminToken);
  assert(procRes.status === 200, `Process payments returned ${procRes.status}`);
  console.log(`  Processed: ${procRes.body?.processed}`);
  console.log(`  Approved: ${procRes.body?.approved}`);
  console.log(`  Rejected: ${procRes.body?.rejected}`);
  console.log(`  Manual Review: ${procRes.body?.manualReview}`);
  assert(typeof procRes.body?.processed === 'number', 'Got processed count');
  if (procRes.body?.errors?.length) {
    procRes.body.errors.forEach(e => console.log(`  \u26a0 Error: ${e.utr} - ${e.error}`));
  }

  // ── Step 5: Check Payment Status ──
  console.log('\n\uD83D\uDCCC Step 5: Check Payment Status');
  const paymentsRes = await httpRequest('POST', '/api/getUPIPayments', {}, adminToken);
  assert(paymentsRes.status === 200, `Get payments returned ${paymentsRes.status}`);
  const payments = Array.isArray(paymentsRes.body) ? paymentsRes.body : [];
  const ourPayment = payments.find(p =>
    (p.paymentId && p.paymentId === paymentId) ||
    (p.id && p.id === paymentId) ||
    (p.utr && p.utr === utr)
  );
  assert(!!ourPayment, 'Our payment found in payments list');
  if (ourPayment) {
    console.log(`  Status: ${ourPayment.status}`);
    console.log(`  OCR Confidence: ${ourPayment.ocrConfidence || ourPayment.ocr_confidence || 'N/A'}`);
    console.log(`  Score: ${ourPayment.final_score || 'N/A'}`);
    if (ourPayment.rejection_reasons) {
      console.log(`  Reasons: ${Array.isArray(ourPayment.rejection_reasons) ? ourPayment.rejection_reasons.join('; ') : ourPayment.rejection_reasons}`);
    }
  }

  // ── Step 6: Approve Payment ──
  console.log('\n\uD83D\uDCCC Step 6: Approve Payment');
  const needsApproval = ourPayment && ourPayment.status !== 'verified' && ourPayment.status !== 'approved';
  if (needsApproval) {
    const approveRes = await httpRequest('POST', '/api/approveUPIPayment', { paymentId }, adminToken);
    assert(approveRes.status === 200, `Approve returned ${approveRes.status}`);
    if (approveRes.body?.status === 'approved' || approveRes.body?.idempotent) {
      assert(true, `Approved / idempotent status: ${approveRes.body?.status}`);
      if (approveRes.body?.userId) {
        console.log(`  User created: ${approveRes.body.userId}`);
      }
    } else {
      assert(false, `Unexpected approve status: ${approveRes.body?.status}`);
    }
    console.log(`  Approve response: ${JSON.stringify(approveRes.body)}`);
  } else if (ourPayment) {
    console.log(`  Payment already in ${ourPayment.status} state, skipping approval`);
  } else {
    assert(false, 'Could not find payment to approve');
  }

  // ── Step 7: Verify via Dashboard ──
  console.log('\n\uD83D\uDCCC Step 7: Verify Dashboard After Approval');
  const dashRes = await httpRequest('POST', '/api/getAdminDashboardData', {}, adminToken);
  assert(dashRes.status === 200, `Dashboard returned ${dashRes.status}`);
  assert(dashRes.body?.success === true, 'Dashboard success flag is true');

  const users = dashRes.body?.users || [];
  const createdUser = users.find(u => u.email === testEmail);
  assert(!!createdUser, 'Created user found in dashboard users list');
  if (createdUser) {
    console.log(`  User: ${createdUser.name} (${createdUser.email})`);
    console.log(`  Account status: ${createdUser.account_status}`);
    console.log(`  Payment status: ${createdUser.payment_status}`);
  }

  const dashPayments = dashRes.body?.pendingPayments || [];
  const dashPayment = dashPayments.find(p => p.id === paymentId);
  assert(!!dashPayment, 'Payment found in dashboard pendingPayments');
  if (dashPayment) {
    console.log(`  Dashboard payment status: ${dashPayment.payment_status}`);
    console.log(`  Dashboard status: ${dashPayment.status}`);
  }

  // ── Summary ──
  const total = results.passed + results.failed;
  console.log('\n' + '='.repeat(55));
  console.log('  RESULTS');
  console.log('='.repeat(55));
  console.log(`  \u2705 Passed: ${results.passed}`);
  console.log(`  \u274c Failed: ${results.failed}`);
  console.log(`  \uD83D\uDCCA Total:  ${total}`);
  if (results.errors.length > 0) {
    console.log('\n  Failures:');
    results.errors.forEach(e => console.log(`    \u2022 ${e}`));
  }
  console.log('='.repeat(55));
  console.log();

  process.exit(results.failed > 0 ? 1 : 0);
}

runE2ETest().catch(err => {
  console.error(`\n\u274c Fatal Error: ${err.message}`);
  process.exit(1);
});
