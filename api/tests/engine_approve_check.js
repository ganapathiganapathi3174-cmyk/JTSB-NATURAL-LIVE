// AUTO-APPROVE E2E — verifies the full relaxed-threshold auto-approval path.
//
// MUST be run in a child process with AUTO_APPROVE_CONFIDENCE=30 so the
// strict default bar (98) is never polluted. Generates a healthy topup ₹500
// screenshot with a unique UTR and expects verifySession() to return
// status='verified'. Exits 0 on success, 1 on failure.
//
//   set AUTO_APPROVE_CONFIDENCE=30 && node api/tests/engine_approve_check.js

const { genPhonePeScreenshot } = require('./gen_screenshot.js');
const { verifySession } = require('../_verificationEngine.js');

(async () => {
  const utr = '77' + String(Math.floor(Math.random() * 1e10)).padStart(10, '0');
  const shot = await genPhonePeScreenshot({ amount: '500.00', utr, upi: 'jayarajj126-3@okicici', name: 'JEYARAJ ALAGAR' });

  const order = {
    id: 'ORD-APPROVE-' + Date.now(),
    type: 'topup',
    amount: 500,
    status: 'pending',
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    user_id: 'u-test-approve',
    utr,
  };

  const v = await verifySession(order, shot.dataUrl, 'u-test-approve', utr, null, shot.buffer);

  console.log('STATUS=' + v.status);
  console.log('CONFIDENCE=' + v.confidence);
  console.log('CHECKS=' + JSON.stringify((v.checks || []).map(c => ({ name: c.name, passed: c.passed }))));
  console.log('REASONS=' + JSON.stringify(v.reasons || []));

  if (v.status === 'verified') {
    console.log('RESULT=VERIFIED');
    process.exit(0);
  }
  console.log('RESULT=NOT_VERIFIED');
  process.exit(1);
})().catch(e => { console.error('ERR', e.message, e.stack); process.exit(1); });
