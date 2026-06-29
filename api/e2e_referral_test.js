const http = require('http');
const crypto = require('crypto');

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3001';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'jayaraj@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'jayaraj7523';

const ts = Date.now();
const SPONSOR = { name: 'Demo Sponsor', email: `demo.sponsor.${ts}@test.local`, phone: `900000${String(ts).slice(-6)}` };
const USER1   = { name: 'Demo User One', email: `demo.user1.${ts}@test.local`, phone: `900001${String(ts).slice(-6)}` };
const USER2   = { name: 'Demo User Two', email: `demo.user2.${ts}@test.local`, phone: `900002${String(ts).slice(-6)}` };
const USER3   = { name: 'Demo User Three', email: `demo.user3.${ts}@test.local`, phone: `900003${String(ts).slice(-6)}` };

const createdIds = { sponsorId: null, user1Id: null, user2Id: null, payment1Id: null, payment2Id: null };
let adminToken = null;
let sponsorReferralCode = null;

let passed = 0, failed = 0, errors = [];

function pad(n) { return n.toString().padStart(2, '0'); }
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  \u2705 ${msg}`); }
  else { failed++; errors.push(msg); console.log(`  \u274c ${msg}`); }
}

function httpRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const opts = {
      hostname: url.hostname, port: url.port || 3001, path: url.pathname,
      method, headers: { 'Content-Type': 'application/json' }, timeout: 30000,
    };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timed out')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function uid() { return crypto.randomBytes(16).toString('hex'); }

async function deleteUser(userId) {
  if (!userId) return;
  await httpRequest('POST', '/api/bulkDeleteUsers', { userIds: [userId], reason: 'E2E test cleanup' }, adminToken).catch(() => {});
}

async function run() {
  console.log('\n' + '='.repeat(60));
  console.log('  REFERRAL LIFECYCLE E2E TEST');
  console.log('='.repeat(60));

  // ── Step 1: Admin Login ──
  console.log('\n\uD83D\uDCCC Step 1: Admin Login');
  const login = await httpRequest('POST', '/api/adminLogin', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  assert(login.status === 200, 'Admin login success');
  assert(!!login.body?.token, 'Auth token received');
  adminToken = login.body.token;
  console.log(`  Token: ${adminToken ? adminToken.substring(0, 20) + '...' : 'NONE'}`);

  // ── Step 2: Create Sponsor ──
  console.log('\n\uD83D\uDCCC Step 2: Create Demo Sponsor');
  // 2a: Pre-register sponsor
  const regSponsor = await httpRequest('POST', '/api/preRegister', { ...SPONSOR, password: 'Test@123', referralCode: null });
  assert(regSponsor.status === 200, 'Sponsor pre-registration success');
  assert(!!regSponsor.body?.pendingRegId, 'Sponsor pendingRegId received');
  const sponsorPendingId = regSponsor.body.pendingRegId;
  console.log(`  Sponsor pendingRegId: ${sponsorPendingId}`);

  // 2b: Admin approve sponsor directly
  const approveSponsor = await httpRequest('POST', '/api/approvePendingRegistration', { pendingRegId: sponsorPendingId }, adminToken);
  assert(approveSponsor.status === 200, 'Sponsor direct approval success');
  assert(!!approveSponsor.body?.userId, 'Sponsor userId received');
  createdIds.sponsorId = approveSponsor.body.userId;
  console.log(`  Sponsor userId: ${createdIds.sponsorId}`);

  // 2c: Get sponsor's referral code from dashboard
  const dash1 = await httpRequest('POST', '/api/getAdminDashboardData', {}, adminToken);
  assert(dash1.status === 200, 'Dashboard data loaded');
  const sponsorUser = (dash1.body?.users || []).find(u => u.id === createdIds.sponsorId);
  assert(!!sponsorUser, 'Sponsor found in dashboard');
  sponsorReferralCode = sponsorUser.referral_code;
  assert(!!sponsorReferralCode, `Sponsor referral code: ${sponsorReferralCode}`);
  console.log(`  Sponsor referral code: ${sponsorReferralCode}`);

  // ── Step 3: Register User 1 with referral ──
  console.log('\n\uD83D\uDCCC Step 3: Register User 1 using sponsor referral');
  const reg1 = await httpRequest('POST', '/api/preRegister', { ...USER1, password: 'Test@123', referralCode: sponsorReferralCode });
  assert(reg1.status === 200, 'User 1 pre-registration with referral success');
  assert(!!reg1.body?.pendingRegId, 'User 1 pendingRegId received');
  const pendingId1 = reg1.body.pendingRegId;
  assert(reg1.body?.referrer?.code === sponsorReferralCode, 'Referrer info matches sponsor code');
  console.log(`  pendingRegId: ${pendingId1}, referrer: ${reg1.body?.referrer?.name || 'N/A'}`);

  // ── Step 4: Submit payment for User 1 ──
  console.log('\n\uD83D\uDCCC Step 4: Submit payment for User 1');
  const utr1 = `E2E${ts}1${uid().slice(0,4)}`.toUpperCase().slice(0, 12);
  const pay1 = await httpRequest('POST', '/api/verifyUPIPayment', {
    pendingRegId: pendingId1, type: 'registration', amount: 120, utr: utr1,
    upiId: 'jayarajj126-3@okicici', paymentDate: todayStr(), screenshotUrl: 'https://example.com/ss1.png',
  });
  assert(pay1.status === 200, 'User 1 payment submitted');
  assert(!!pay1.body?.paymentId, 'User 1 paymentId received');
  createdIds.payment1Id = pay1.body.paymentId;
  console.log(`  Payment ID: ${createdIds.payment1Id}, UTR: ${utr1}`);

  // ── Step 5: Approve User 1 ──
  console.log('\n\uD83D\uDCCC Step 5: Approve User 1 payment');
  const approve1 = await httpRequest('POST', '/api/approveUPIPayment', { paymentId: createdIds.payment1Id }, adminToken);
  assert(approve1.status === 200, 'User 1 payment approved');
  assert(approve1.body?.status === 'approved', `Status: ${approve1.body?.status}`);
  createdIds.user1Id = approve1.body.userId;
  console.log(`  User 1 created: ${createdIds.user1Id}`);

  // ── Step 6: Verify Sponsor after 1st referral ──
  console.log('\n\uD83D\uDCCC Step 6: Verify Sponsor status after 1st referral');
  await new Promise(r => setTimeout(r, 500));
  const dashAfter1 = await httpRequest('POST', '/api/getAdminDashboardData', {}, adminToken);
  assert(dashAfter1.status === 200, 'Dashboard loaded');
  const sponsorAfter1 = (dashAfter1.body?.users || []).find(u => u.id === createdIds.sponsorId);
  assert(!!sponsorAfter1, 'Sponsor found');
  console.log(`  Referrals count: ${sponsorAfter1.referrals_count}`);
  assert(sponsorAfter1.referrals_count === 1, `Referral count is 1 (got ${sponsorAfter1.referrals_count})`);
  assert(sponsorAfter1.account_status === 'active', `Sponsor still ACTIVE (got ${sponsorAfter1.account_status})`);
  console.log(`  Account status: ${sponsorAfter1.account_status}`);

  // ── Step 7: Register User 2 with same referral ──
  console.log('\n\uD83D\uDCCC Step 7: Register User 2 using same referral');
  const reg2 = await httpRequest('POST', '/api/preRegister', { ...USER2, password: 'Test@123', referralCode: sponsorReferralCode });
  assert(reg2.status === 200, 'User 2 pre-registration with referral success');
  assert(!!reg2.body?.pendingRegId, 'User 2 pendingRegId received');
  const pendingId2 = reg2.body.pendingRegId;
  console.log(`  pendingRegId: ${pendingId2}`);

  // ── Step 8: Submit payment for User 2 ──
  console.log('\n\uD83D\uDCCC Step 8: Submit payment for User 2');
  const utr2 = `E2E${ts}2${uid().slice(0,4)}`.toUpperCase().slice(0, 12);
  const pay2 = await httpRequest('POST', '/api/verifyUPIPayment', {
    pendingRegId: pendingId2, type: 'registration', amount: 120, utr: utr2,
    upiId: 'jayarajj126-3@okicici', paymentDate: todayStr(), screenshotUrl: 'https://example.com/ss2.png',
  });
  assert(pay2.status === 200, 'User 2 payment submitted');
  assert(!!pay2.body?.paymentId, 'User 2 paymentId received');
  createdIds.payment2Id = pay2.body.paymentId;
  console.log(`  Payment ID: ${createdIds.payment2Id}, UTR: ${utr2}`);

  // ── Step 9: Approve User 2 ──
  console.log('\n\uD83D\uDCCC Step 9: Approve User 2 payment');
  const approve2 = await httpRequest('POST', '/api/approveUPIPayment', { paymentId: createdIds.payment2Id }, adminToken);
  assert(approve2.status === 200, 'User 2 payment approved');
  assert(approve2.body?.status === 'approved', `Status: ${approve2.body?.status}`);
  createdIds.user2Id = approve2.body.userId;
  console.log(`  User 2 created: ${createdIds.user2Id}`);

  // ── Step 10: Verify Sponsor after 2nd referral ──
  console.log('\n\uD83D\uDCCC Step 10: Verify Sponsor after 2nd referral (should be INACTIVE)');
  await new Promise(r => setTimeout(r, 500));
  const dashAfter2 = await httpRequest('POST', '/api/getAdminDashboardData', {}, adminToken);
  assert(dashAfter2.status === 200, 'Dashboard loaded');
  const sponsorAfter2 = (dashAfter2.body?.users || []).find(u => u.id === createdIds.sponsorId);
  assert(!!sponsorAfter2, 'Sponsor found');
  console.log(`  Referrals count: ${sponsorAfter2.referrals_count}`);
  assert(sponsorAfter2.referrals_count === 2, `Referral count is 2 (got ${sponsorAfter2.referrals_count})`);
  assert(sponsorAfter2.account_status === 'inactive', `Sponsor INACTIVE (got ${sponsorAfter2.account_status})`);
  assert(sponsorAfter2.referral_limit_reached === true, 'referral_limit_reached is true');
  console.log(`  Account status: ${sponsorAfter2.account_status}`);
  console.log(`  Inactive reason: ${sponsorAfter2.inactive_reason || 'N/A'}`);

  // ── Step 11: Verify User 3 registration is REJECTED ──
  console.log('\n\uD83D\uDCCC Step 11: Verify 3rd referral attempt is REJECTED');
  const reg3 = await httpRequest('POST', '/api/preRegister', { ...USER3, password: 'Test@123', referralCode: sponsorReferralCode });
  assert(reg3.status === 400, `User 3 registration rejected with ${reg3.status}`);
  const errMsg = (reg3.body?.error || '').toLowerCase();
  assert(errMsg.includes('expired') || errMsg.includes('limit'), `Error message mentions expired/link: "${reg3.body?.error}"`);
  console.log(`  Response: ${reg3.status} — ${reg3.body?.error}`);

  // ── Step 12: Admin Approve Sponsor ──
  console.log('\n\uD83D\uDCCC Step 12: Admin approves sponsor reactivation');
  const approveSponsorAct = await httpRequest('POST', '/api/approveSponsor', { userId: createdIds.sponsorId }, adminToken);
  assert(approveSponsorAct.status === 200, 'Sponsor reactivation success');
  assert(approveSponsorAct.body?.status === 'approved', `Status: ${approveSponsorAct.body?.status}`);
  console.log(`  Response: ${JSON.stringify(approveSponsorAct.body)}`);

  // ── Step 13: Verify Sponsor ACTIVE again ──
  console.log('\n\uD83D\uDCCC Step 13: Verify Sponsor is ACTIVE again');
  await new Promise(r => setTimeout(r, 500));
  const dashAfterApprove = await httpRequest('POST', '/api/getAdminDashboardData', {}, adminToken);
  assert(dashAfterApprove.status === 200, 'Dashboard loaded');
  const sponsorFinal = (dashAfterApprove.body?.users || []).find(u => u.id === createdIds.sponsorId);
  assert(!!sponsorFinal, 'Sponsor found');
  assert(sponsorFinal.account_status === 'active', `Sponsor ACTIVE (got ${sponsorFinal.account_status})`);
  console.log(`  Account status: ${sponsorFinal.account_status}`);

  // ── Step 14: Verify old referral link still expired ──
  console.log('\n\uD83D\uDCCC Step 14: Verify old referral link still EXPIRED after approval');
  const reg3again = await httpRequest('POST', '/api/preRegister', {
    name: 'Demo User Three Retry', email: `demo.user3.retry.${ts}@test.local`,
    phone: `900004${String(ts).slice(-6)}`, password: 'Test@123',
    referralCode: sponsorReferralCode,
  });
  assert(reg3again.status === 400, '3rd registration still rejected after sponsor reactivation');
  console.log(`  Response: ${reg3again.status} — ${reg3again.body?.error}`);

  // ── Summary ──
  const total = passed + failed;
  console.log('\n' + '='.repeat(60));
  console.log('  RESULTS');
  console.log('='.repeat(60));
  console.log(`  \u2705 Passed: ${passed}`);
  console.log(`  \u274c Failed: ${failed}`);
  console.log(`  \uD83D\uDCCA Total:  ${total}`);
  if (errors.length) {
    console.log('\n  Failures:');
    errors.forEach(e => console.log(`    \u2022 ${e}`));
  }
  console.log('='.repeat(60));
  console.log();

  // Clean up demo users
  console.log('Cleaning up demo users...');
  await deleteUser(createdIds.sponsorId);
  await deleteUser(createdIds.user1Id);
  await deleteUser(createdIds.user2Id);
  console.log('Cleanup complete.\n');

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error(`\n\u274c Fatal: ${err.message}`);
  // Clean up on error too
  (async () => {
    if (adminToken) {
      await deleteUser(createdIds.sponsorId);
      await deleteUser(createdIds.user1Id);
      await deleteUser(createdIds.user2Id);
    }
    process.exit(1);
  })();
});
