// Comprehensive E2E Test — tests system init, registration, payments, referrals, wallet, admin
// Run: node api/e2e_comprehensive.js
// Requires: API server running on localhost:3001

const http = require('http');

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3001';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'jayaraj@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'jayaraj7523';

let results = { passed: 0, failed: 0, errors: [] };
let adminToken = null;
let createdUsers = [];

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
      timeout: 120000,
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
function rng(len) { return Math.random().toString(36).slice(2, 2 + len).toUpperCase(); }

async function step(n, label, fn) {
  console.log(`\n\uD83D\uDCCC Step ${n}: ${label}`);
  const start = Date.now();
  try {
    await fn();
  } catch (err) {
    assert(false, `${label} threw: ${err.message}`);
  }
  console.log(`  (\u23F1 ${Date.now() - start}ms)`);
}

async function test() {
  console.log('\n' + '='.repeat(60));
  console.log('  COMPREHENSIVE E2E TEST');
  console.log('='.repeat(60));
  console.log(`  Admin: ${ADMIN_EMAIL}`);
  console.log(`  Server: ${BASE_URL}`);
  console.log('='.repeat(60));

  // ── 1. Admin Login ──
  await step(1, 'Admin Login — JWT Authentication', async () => {
    const res = await httpRequest('POST', '/api/adminLogin', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    assert(res.status === 200, `Login status ${res.status}`);
    assert(!!res.body?.token, 'JWT token received');
    assert(!!res.body?.admin, 'Admin info received');
    assert(res.body?.admin?.role === 'admin', 'Admin role confirmed');
    adminToken = res.body.token;
  });

  // ── 2. Health Check ──
  await step(2, 'System Health Check', async () => {
    const res = await httpRequest('GET', '/api/getHealthStatus');
    assert(res.status === 200, `Health status ${res.status}`);
    const ok = res.status === 200;
    assert(ok, 'Health endpoint responds');
  });

  // ── 3. Verify System Users exist ──
  await step(3, 'System Users Verification', async () => {
    const res = await httpRequest('POST', '/api/getAdminDashboardData', {}, adminToken);
    assert(res.status === 200, `Dashboard status ${res.status}`);
    const users = res.body?.users || [];
    const sysUsers = users.filter(u =>
      u.email && u.email.includes('system') &&
      ['SYS001', 'SYS002', 'SYS003'].includes(u.referral_code)
    );
    assert(sysUsers.length === 3, `3 system users found: got ${sysUsers.length}`);
    sysUsers.forEach(u => {
      const code = u.referral_code;
      assert(u.active === true || u.account_status === 'active', `System user ${code} is active`);
      assert(!!u.referral_code, `System user ${code} has referral_code`);
      console.log(`    ${code}: ${u.name} (${u.email}) — active=${u.active}, referrals=${u.referrals_count || 0}`);
    });
  });

  // ── 4. Register + Payment for ₹120 ──
  await step(4, 'Registration + Payment: ₹120 under System User 1 (SYS001)', async () => {
    const ts = Date.now();
    const email = `e2e_120_${ts}@test.com`;
    const phone = `91111${String(ts).slice(-6)}`;
    const regRes = await httpRequest('POST', '/api/preRegister', {
      name: 'E2E User 120', email, phone, password: 'Test@123',
      referralCode: 'SYS001',
    });
    assert(regRes.status === 200, `Pre-register status ${regRes.status}`);
    assert(!!regRes.body?.pendingRegId, 'pendingRegId received');
    assert(!!regRes.body?.referrer, 'Referrer info received');
    assert(regRes.body.referrer.code === 'SYS001', 'Referrer is SYS001');
    const pendingRegId = regRes.body.pendingRegId;

    const utr = `UTR120${ts}${rng(4)}`.slice(0, 16);
    const payRes = await httpRequest('POST', '/api/verifyUPIPayment', {
      pendingRegId, type: 'registration', amount: 120, utr,
      upiId: 'jayarajj-3@okicici', paymentDate: todayStr(),
      screenshotUrl: 'https://placehold.co/400x800/png?text=Test+Payment+120',
    });
    assert(payRes.status === 200, `Payment status ${payRes.status}`);
    assert(!!payRes.body?.paymentId, 'paymentId received');
    console.log(`    UTR: ${utr}, status: ${payRes.body.status}, score: ${payRes.body.verificationScore}`);

    createdUsers.push({ pendingRegId, paymentId: payRes.body.paymentId, utr, email, amount: 120, type: 'registration' });
  });

  // ── 5. Approve the ₹120 Payment ──
  await step(5, 'Approve Registration Payment: ₹120', async () => {
    const last = createdUsers[createdUsers.length - 1];
    const res = await httpRequest('POST', '/api/approveUPIPayment', { paymentId: last.paymentId }, adminToken);
    assert(res.status === 200, `Approve status ${res.status}`);
    assert(res.body?.status === 'approved' || res.body?.idempotent, `Approved: ${res.body?.status}`);
    if (res.body?.userId) {
      last.userId = res.body.userId;
      console.log(`    User created: ${res.body.userId}`);
    }
  });

  // ── 6. Register + Payment for ₹500 ──
  await step(6, 'Registration + Payment: ₹500 under System User 1 (SYS001)', async () => {
    const ts = Date.now();
    const email = `e2e_500_${ts}@test.com`;
    const phone = `92222${String(ts).slice(-6)}`;
    const regRes = await httpRequest('POST', '/api/preRegister', {
      name: 'E2E User 500', email, phone, password: 'Test@123',
      referralCode: 'SYS001',
    });
    assert(regRes.status === 200, `Pre-register status ${regRes.status}`);
    assert(!!regRes.body?.pendingRegId, 'pendingRegId received');
    assert(regRes.body.referrer.code === 'SYS001', 'Referrer is SYS001');
    const pendingRegId = regRes.body.pendingRegId;

    const utr = `UTR500${ts}${rng(4)}`.slice(0, 16);
    const payRes = await httpRequest('POST', '/api/verifyUPIPayment', {
      pendingRegId, type: 'registration', amount: 500, utr,
      upiId: 'jayarajj-3@okicici', paymentDate: todayStr(),
      screenshotUrl: 'https://placehold.co/400x800/png?text=Test+Payment+500',
    });
    assert(payRes.status === 200, `Payment status ${payRes.status}`);
    assert(!!payRes.body?.paymentId, 'paymentId received');
    console.log(`    UTR: ${utr}, status: ${payRes.body.status}, score: ${payRes.body.verificationScore}`);

    createdUsers.push({ pendingRegId, paymentId: payRes.body.paymentId, utr, email, amount: 500, type: 'registration' });
  });

  // ── 7. Approve the ₹500 Payment ──
  await step(7, 'Approve Registration Payment: ₹500', async () => {
    const last = createdUsers[createdUsers.length - 1];
    const res = await httpRequest('POST', '/api/approveUPIPayment', { paymentId: last.paymentId }, adminToken);
    assert(res.status === 200, `Approve status ${res.status}`);
    assert(res.body?.status === 'approved' || res.body?.idempotent, `Approved: ${res.body?.status}`);
    if (res.body?.userId) {
      last.userId = res.body.userId;
      console.log(`    User created: ${res.body.userId}`);
    }
  });

  // ── 8. Register + Payment for ₹1000 under SYS002 ──
  await step(8, 'Registration + Payment: ₹1000 under System User 2 (SYS002)', async () => {
    const ts = Date.now();
    const email = `e2e_1000_${ts}@test.com`;
    const phone = `93333${String(ts).slice(-6)}`;
    const regRes = await httpRequest('POST', '/api/preRegister', {
      name: 'E2E User 1000', email, phone, password: 'Test@123',
      referralCode: 'SYS002',
    });
    assert(regRes.status === 200, `Pre-register status ${regRes.status}`);
    assert(!!regRes.body?.pendingRegId, 'pendingRegId received');
    assert(regRes.body.referrer.code === 'SYS002', 'Referrer is SYS002');
    const pendingRegId = regRes.body.pendingRegId;

    const utr = `UTR1000${ts}${rng(4)}`.slice(0, 16);
    const payRes = await httpRequest('POST', '/api/verifyUPIPayment', {
      pendingRegId, type: 'registration', amount: 1000, utr,
      upiId: 'jayarajj-3@okicici', paymentDate: todayStr(),
      screenshotUrl: 'https://placehold.co/400x800/png?text=Test+Payment+1000',
    });
    assert(payRes.status === 200, `Payment status ${payRes.status}`);
    assert(!!payRes.body?.paymentId, 'paymentId received');
    console.log(`    UTR: ${utr}, status: ${payRes.body.status}, score: ${payRes.body.verificationScore}`);

    createdUsers.push({ pendingRegId, paymentId: payRes.body.paymentId, utr, email, amount: 1000, type: 'registration' });
  });

  // ── 9. Approve the ₹1000 Payment ──
  await step(9, 'Approve Registration Payment: ₹1000', async () => {
    const last = createdUsers[createdUsers.length - 1];
    const res = await httpRequest('POST', '/api/approveUPIPayment', { paymentId: last.paymentId }, adminToken);
    assert(res.status === 200, `Approve status ${res.status}`);
    assert(res.body?.status === 'approved' || res.body?.idempotent, `Approved: ${res.body?.status}`);
    if (res.body?.userId) {
      last.userId = res.body.userId;
      console.log(`    User created: ${res.body.userId}`);
    }
  });

  // ── 10. Duplicate UTR Rejection ──
  await step(10, 'Duplicate UTR Rejection', async () => {
    const ts = Date.now();
    const dupEmail = `e2e_dup_${ts}@test.com`;
    const dupPhone = `94444${String(ts).slice(-6)}`;
    const regRes = await httpRequest('POST', '/api/preRegister', {
      name: 'E2E Duplicate UTR', email: dupEmail, phone: dupPhone,
      password: 'Test@123', referralCode: 'SYS003',
    });
    assert(regRes.status === 200, 'Pre-register for dup test ok');
    const pendingRegId = regRes.body.pendingRegId;

    const existingUtr = createdUsers[0]?.utr;
    if (existingUtr) {
      const payRes = await httpRequest('POST', '/api/verifyUPIPayment', {
        pendingRegId, type: 'registration', amount: 120, utr: existingUtr,
        upiId: 'jayarajj-3@okicici', paymentDate: todayStr(),
        screenshotUrl: 'https://placehold.co/400x800/png?text=Duplicate+UTR',
      });
      console.log(`    Duplicate UTR result: status=${payRes.status}, body=${JSON.stringify(payRes.body)}`);
      assert(payRes.status === 400 || payRes.body?.status === 'rejected' || payRes.body?.error,
        'Duplicate UTR rejected or errored');
    } else {
      assert(false, 'No existing UTR to test duplicate');
    }
  });

  // ── 11. Wrong Amount ──
  await step(11, 'Wrong Amount Validation', async () => {
    const ts = Date.now();
    const email = `e2e_wa_${ts}@test.com`;
    const phone = `95555${String(ts).slice(-6)}`;
    const regRes = await httpRequest('POST', '/api/preRegister', {
      name: 'E2E Wrong Amount', email, phone,
      password: 'Test@123', referralCode: 'SYS001',
    });
    assert(regRes.status === 200, 'Pre-register for wrong amount ok');
    const pendingRegId = regRes.body.pendingRegId;

    const payRes = await httpRequest('POST', '/api/verifyUPIPayment', {
      pendingRegId, type: 'registration', amount: 999, utr: `WRONGAMT${ts}`,
      upiId: 'jayarajj-3@okicici', paymentDate: todayStr(),
      screenshotUrl: 'https://placehold.co/400x800/png?text=Wrong+Amount',
    });
    console.log(`    Wrong amount result: status=${payRes.status}, body=${JSON.stringify(payRes.body)}`);
    assert(payRes.status === 400 || payRes.body?.error || payRes.body?.status === 'rejected',
      'Wrong amount rejected or errored');
  });

  // ── 12. Topup ₹120 ──
  await step(12, 'Topup: ₹120 for last created user', async () => {
    const last = createdUsers[createdUsers.length - 1];
    if (!last.userId) {
      assert(false, 'No user to topup');
      return;
    }
    const ts = Date.now();
    const utr = `TOP120${ts}${rng(4)}`.slice(0, 16);
    const payRes = await httpRequest('POST', '/api/verifyUPIPayment', {
      userId: last.userId, type: 'topup', amount: 120, utr,
      upiId: 'jayarajj-3@okicici', paymentDate: todayStr(),
      screenshotUrl: 'https://placehold.co/400x800/png?text=Topup+120',
    });
    assert(payRes.status === 200, `Topup payment status ${payRes.status}`);
    assert(!!payRes.body?.paymentId, 'Topup paymentId received');

    const approveRes = await httpRequest('POST', '/api/approveUPIPayment', { paymentId: payRes.body.paymentId }, adminToken);
    assert(approveRes.status === 200, `Topup approve status ${approveRes.status}`);
    assert(approveRes.body?.status === 'approved' || approveRes.body?.idempotent, `Topup approved: ${approveRes.body?.status}`);
    console.log(`    Topup UTR: ${utr}, approved: ${approveRes.body?.status}`);
  });

  // ── 13. Topup ₹500 ──
  await step(13, 'Topup: ₹500 for first created user', async () => {
    const first = createdUsers[0];
    if (!first.userId) {
      assert(false, 'No user to topup');
      return;
    }
    const ts = Date.now();
    const utr = `TOP500${ts}${rng(4)}`.slice(0, 16);
    const payRes = await httpRequest('POST', '/api/verifyUPIPayment', {
      userId: first.userId, type: 'topup', amount: 500, utr,
      upiId: 'jayarajj-3@okicici', paymentDate: todayStr(),
      screenshotUrl: 'https://placehold.co/400x800/png?text=Topup+500',
    });
    assert(payRes.status === 200, `Topup 500 payment status ${payRes.status}`);
    assert(!!payRes.body?.paymentId, 'Topup 500 paymentId received');

    const approveRes = await httpRequest('POST', '/api/approveUPIPayment', { paymentId: payRes.body.paymentId }, adminToken);
    assert(approveRes.status === 200, `Topup 500 approve status ${approveRes.status}`);
    assert(approveRes.body?.status === 'approved' || approveRes.body?.idempotent, `Topup 500 approved: ${approveRes.body?.status}`);
    console.log(`    Topup UTR: ${utr}, approved: ${approveRes.body?.status}`);
  });

  // ── 14. Topup ₹1000 ──
  await step(14, 'Topup: ₹1000 for second created user', async () => {
    const second = createdUsers[1];
    if (!second || !second.userId) {
      assert(false, 'No user to topup');
      return;
    }
    const ts = Date.now();
    const utr = `TOP1000${ts}${rng(4)}`.slice(0, 16);
    const payRes = await httpRequest('POST', '/api/verifyUPIPayment', {
      userId: second.userId, type: 'topup', amount: 1000, utr,
      upiId: 'jayarajj-3@okicici', paymentDate: todayStr(),
      screenshotUrl: 'https://placehold.co/400x800/png?text=Topup+1000',
    });
    assert(payRes.status === 200, `Topup 1000 payment status ${payRes.status}`);
    assert(!!payRes.body?.paymentId, 'Topup 1000 paymentId received');

    const approveRes = await httpRequest('POST', '/api/approveUPIPayment', { paymentId: payRes.body.paymentId }, adminToken);
    assert(approveRes.status === 200, `Topup 1000 approve status ${approveRes.status}`);
    assert(approveRes.body?.status === 'approved' || approveRes.body?.idempotent, `Topup 1000 approved: ${approveRes.body?.status}`);
    console.log(`    Topup UTR: ${utr}, approved: ${approveRes.body?.status}`);
  });

  // ── 15. Dashboard Verification ──
  await step(15, 'Admin Dashboard Verification', async () => {
    const res = await httpRequest('POST', '/api/getAdminDashboardData', {}, adminToken);
    assert(res.status === 200, `Dashboard status ${res.status}`);
    assert(res.body?.success === true, 'Dashboard success flag');

    const users = res.body?.users || [];
    const payments = res.body?.pendingPayments || [];
    const stats = res.body?.stats || {};

    const ourEmails = createdUsers.map(u => u.email);
    const found = users.filter(u => ourEmails.includes(u.email));
    assert(found.length >= 3, `At least 3 created users found in dashboard: ${found.length}`);

    console.log(`    Total users: ${users.length}`);
    console.log(`    Pending payments: ${payments.length}`);
    console.log(`    Stats: ${JSON.stringify(stats).slice(0, 200)}`);
    found.forEach(u => {
      console.log(`    ${u.email}: status=${u.account_status}, approved=${u.approved}`);
    });
  });

  // ── 16. Payment List Verification ──
  await step(16, 'Payment List & Status Verification', async () => {
    const res = await httpRequest('POST', '/api/getUPIPayments', {}, adminToken);
    assert(res.status === 200, `Payments list status ${res.status}`);
    const payments = Array.isArray(res.body) ? res.body : (res.body?.payments || []);
    const ourPaymentIds = createdUsers.map(u => u.paymentId);
    const found = payments.filter(p => ourPaymentIds.includes(p.id || p.paymentId));
    assert(found.length >= 3, `At least 3 payments found: ${found.length}`);
    found.forEach(p => {
      console.log(`    Payment ${p.id || p.paymentId}: status=${p.status}, score=${p.final_score || 'N/A'}`);
      assert(p.status === 'verified' || p.status === 'approved',
        `Payment ${p.id || p.paymentId} is verified/approved`);
    });
  });

  // ── 17. Referral Creation Verification ──
  await step(17, 'Referral Tree Verification', async () => {
    const res = await httpRequest('POST', '/api/getAdminDashboardData', {}, adminToken);
    const users = res.body?.users || [];
    const sys1 = users.find(u => u.referral_code === 'SYS001');
    assert(!!sys1, 'SYS001 found');
    assert(sys1.referrals_count >= 2, `SYS001 has >= 2 referrals: ${sys1.referrals_count}`);
    console.log(`    SYS001 referrals: ${sys1.referrals_count}`);
    console.log(`    SYS001 referral_active: ${sys1.referral_active}`);
    console.log(`    SYS001 referral_limit_reached: ${sys1.referral_limit_reached}`);
    assert(sys1.referral_active === true, 'SYS001 stays active (unlimited referrals)');
    assert(sys1.referral_limit_reached !== true, 'SYS001 not marked as limit reached');
  });

  // ── 18. JWT Token Rotation ──
  await step(18, 'JWT Auth — Admin Logout & Token Blacklist', async () => {
    const logoutRes = await httpRequest('POST', '/api/adminLogout', {}, adminToken);
    assert(logoutRes.status === 200, `Logout status ${logoutRes.status}`);

    const dashRes = await httpRequest('POST', '/api/getAdminDashboardData', {}, adminToken);
    assert(dashRes.status === 401, 'Blocked request with blacklisted token');

    const loginRes = await httpRequest('POST', '/api/adminLogin', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    assert(loginRes.status === 200, 'Re-login successful');
    adminToken = loginRes.body.token;
    console.log('    Token re-issued after logout');
  });

  // ── 19. Idempotency Check ──
  await step(19, 'Idempotency — Double approve returns existing status', async () => {
    const last = createdUsers[createdUsers.length - 1];
    const res = await httpRequest('POST', '/api/approveUPIPayment', { paymentId: last.paymentId }, adminToken);
    assert(res.status === 200, `Double approve status ${res.status}`);
    assert(res.body?.idempotent === true, 'Idempotent flag set');
    console.log(`    Status: ${res.body?.status}, idempotent: ${res.body?.idempotent}`);
  });

  // ── 20. Queue Status ──
  await step(20, 'Queue Status', async () => {
    const res = await httpRequest('GET', '/api/getQueueStatus', null, adminToken);
    assert(res.status === 200, `Queue status ${res.status}`);
    console.log(`    Queue: ${JSON.stringify(res.body).slice(0, 200)}`);
  });

  // ── Summary ──
  const total = results.passed + results.failed;
  console.log('\n' + '='.repeat(60));
  console.log('  RESULTS');
  console.log('='.repeat(60));
  console.log(`  \u2705 Passed: ${results.passed}`);
  console.log(`  \u274c Failed: ${results.failed}`);
  console.log(`  \uD83D\uDCCA Total:  ${total}`);
  if (results.errors.length > 0) {
    console.log('\n  Failures:');
    results.errors.forEach(e => console.log(`    \u2022 ${e}`));
  }
  console.log('='.repeat(60));
  console.log();

  process.exit(results.failed > 0 ? 1 : 0);
}

test().catch(err => {
  console.error(`\n\u274c Fatal Error: ${err.message}`);
  process.exit(1);
});
