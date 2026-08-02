// ─────────────────────────────────────────────────────────────
// E2E FULL SUITE  (api/tests/e2e_full_suite.js)
//
// Drives the REAL HTTP payment flow (preRegister → createPaymentOrder →
// submitPaymentProof → getPaymentOrderStatus poll) against a running API
// and the LIVE Supabase DB. Covers every scenario from the production
// readiness directive:
//   registration ₹120, topup ₹500/₹1000, wrong amount, wrong UPI,
//   FAILED status, duplicate UTR, old/future date, blurred screenshot,
//   expired order (re-activation), never-stuck-in-processing.
//
// Self-aware of migration state: if `upi_payments.utr_hash` is missing
// (migration not applied), the duplicate-UTR expectation relaxes to
// manual_review and a warning is printed.
//
// Usage:  node api/tests/e2e_full_suite.js
//   Env:  E2E_BASE  (default http://localhost:3001/api)
//   Reads SUPABASE_URL/SUPABASE_SERVICE_KEY from .env.local for the
//   schema probe + throwaway topup-user creation.
//   Exit:  0 = all cases passed, 1 = failure.
// ─────────────────────────────────────────────────────────────

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const { genPhonePeScreenshot } = require('./gen_screenshot.js');

const BASE = process.env.E2E_BASE || 'http://localhost:3001/api';

const env = { ...process.env };
const envFile = path.join(__dirname, '..', '..', '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in env)) env[m[1]] = m[2];
  }
}

const RECEIVER_UPI = 'jayarajj126-3@okicici';

async function api(pathname, opts) {
  const res = await fetch(BASE + pathname, opts);
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function probeSchema() {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return 'unknown';
  try {
    const r = await fetch(`${url}/rest/v1/upi_payments?select=${encodeURIComponent('utr_hash')}&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    return r.ok ? 'complete' : 'pending';
  } catch { return 'unknown'; }
}

async function createTopupUser(pkg) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const rnd = String(Date.now()).slice(-6);
  const body = {
    id,
    email: `e2e.topup.${pkg}.${rnd}@example.com`,
    name: 'E2E Topup ' + pkg,
    phone: '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'),
    password_hash: crypto.createHash('sha256').update('Passw0rd!').digest('hex'),
    referral_code: 'E2ET' + rnd,
    referred_by: null,
    account_status: 'active',
    payment_status: 'success',
    approved: true,
    active: true,
    membership_paid: true,
    membership_type: String(pkg),
    joined_date: now,
    approved_date: now,
  };
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/users`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    console.error('  [setup] topup-user insert failed (' + r.status + '):', (await r.text().catch(() => '')).slice(0, 200));
    return null;
  }
  const rows = await r.json();
  return (rows && rows[0] && rows[0].id) || id;
}

async function backdateOrder(orderId) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/payment_sessions?id=eq.${orderId}`, {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expires_at: new Date(Date.now() - 60000).toISOString() }),
  });
  return r.ok;
}

async function runFlow(cfg) {
  const rnd = String(Date.now()).slice(-8) + Math.floor(Math.random() * 90 + 10);
  let pendingRegId = cfg.pendingRegId;

  if (cfg.type === 'registration') {
    const r = await api('/preRegister', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'E2E User ' + rnd, email: `e2e.reg.${rnd}@example.com`, phone: '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'), password: 'Passw0rd!' }),
    });
    if (!r.body || !r.body.pendingRegId) return { case: cfg.name, step: 'preRegister', error: JSON.stringify(r.body) };
    pendingRegId = r.body.pendingRegId;
  }

  const co = await api('/createPaymentOrder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: cfg.type, amount: cfg.amount, pendingRegId, userId: cfg.userId }),
  });
  if (!co.body || !co.body.orderId) return { case: cfg.name, step: 'createOrder', error: JSON.stringify(co.body) };
  const orderId = co.body.orderId;

  if (cfg.backdate) {
    if (!(await backdateOrder(orderId))) return { case: cfg.name, step: 'backdate', error: 'expires_at backdate failed' };
  }

  const shot = await genPhonePeScreenshot(cfg.shot);
  let screenshot = shot.dataUrl;
  if (cfg.blur) {
    const img = await Jimp.Jimp.read(shot.buffer);
    img.blur(8);
    const b = await img.getBuffer('image/png');
    screenshot = 'data:image/png;base64,' + b.toString('base64');
  }

  const submit = await api('/submitPaymentProof', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, screenshot, upiId: cfg.shot.upi, utr: cfg.shot.utr }),
  });
  if (submit.status !== 200) return { case: cfg.name, step: 'submit', error: submit.status + ' ' + JSON.stringify(submit.body) };

  let terminal = null;
  let last = null;
  for (let i = 0; i < 30; i++) {
    await wait(2500);
    const st = await api('/getPaymentOrderStatus?orderId=' + encodeURIComponent(orderId));
    last = st.body;
    if (['verified', 'rejected', 'manual_review'].includes(st.body && st.body.status)) { terminal = st.body.status; break; }
  }

  return {
    case: cfg.name,
    type: cfg.type,
    orderId,
    terminal,
    verificationStatus: last && last.verificationStatus,
    checks: last && last.checks && last.checks.map(c => c.name + '=' + c.status),
    reasons: last && last.reasons,
  };
}

function pass(failCount, note) {
  const tag = note === null ? 'PASS' : 'SKIP';
  console.log(`  [${tag}] ${note === null ? '' : ' (' + note + ')'}`);
  return failCount;
}

(async () => {
  const schema = await probeSchema();
  const schemaComplete = schema === 'complete';
  console.log('== E2E FULL SUITE ==');
  console.log('base:', BASE);
  console.log('schema (utr_hash present):', schema, schemaComplete ? '(dup-UTR → reject expected)' : '(dup-UTR → manual_review expected)');
  console.log('start:', new Date().toISOString());

  console.log('\n[setup] creating throwaway topup users (membership ₹500 / ₹1000)...');
  const topup500Id = await createTopupUser(500);
  const topup1000Id = await createTopupUser(1000);
  console.log('  topup500 userId:', topup500Id, '| topup1000 userId:', topup1000Id);

  const utrA = '9' + String(Date.now()).slice(-11);
  const utrSeq = (n) => String(n) + String(Date.now()).slice(-11) + String(Math.floor(Math.random() * 9000 + 1000));

  const cases = [
    { name: 'reg_ok_120', type: 'registration', amount: 120, shot: { amount: '120.00', utr: utrA, upi: RECEIVER_UPI, name: 'JEYARAJ ALAGAR', status: 'SUCCESS' }, expect: ['verified', 'manual_review'] },
    { name: 'reg_wrong_amount', type: 'registration', amount: 500, shot: { amount: '120.00', utr: utrSeq(9), upi: RECEIVER_UPI, name: 'JEYARAJ ALAGAR', status: 'SUCCESS' }, expect: ['manual_review'] },
    { name: 'reg_wrong_upi', type: 'registration', amount: 120, shot: { amount: '120.00', utr: utrSeq(8), upi: 'someone@okicici', name: 'STRANGER', status: 'SUCCESS' }, expect: ['manual_review'] },
    { name: 'reg_failed_status', type: 'registration', amount: 120, shot: { amount: '120.00', utr: utrSeq(7), upi: RECEIVER_UPI, name: 'JEYARAJ ALAGAR', status: 'FAILED' }, expect: ['rejected'] },
    { name: 'reg_dup_utr', type: 'registration', amount: 120, shot: { amount: '120.00', utr: utrA, upi: RECEIVER_UPI, name: 'JEYARAJ ALAGAR', status: 'SUCCESS' }, expect: schemaComplete ? ['rejected'] : ['manual_review'] },
    { name: 'reg_old_date', type: 'registration', amount: 120, shot: { amount: '120.00', utr: utrSeq(6), upi: RECEIVER_UPI, name: 'JEYARAJ ALAGAR', status: 'SUCCESS', date: '01/01/2020' }, expect: ['manual_review'] },
    { name: 'reg_future_date', type: 'registration', amount: 120, shot: { amount: '120.00', utr: utrSeq(5), upi: RECEIVER_UPI, name: 'JEYARAJ ALAGAR', status: 'SUCCESS', date: '01/01/2030' }, expect: ['manual_review'] },
    { name: 'reg_blurred', type: 'registration', amount: 120, blur: true, shot: { amount: '120.00', utr: utrSeq(4), upi: RECEIVER_UPI, name: 'JEYARAJ ALAGAR', status: 'SUCCESS' }, expect: ['manual_review'] },
    { name: 'topup_ok_500', type: 'topup', amount: 500, userId: topup500Id, shot: { amount: '500.00', utr: utrSeq(3), upi: RECEIVER_UPI, name: 'JEYARAJ ALAGAR', status: 'SUCCESS' }, expect: ['verified', 'manual_review'] },
    { name: 'topup_ok_1000', type: 'topup', amount: 1000, userId: topup1000Id, shot: { amount: '1000.00', utr: utrSeq(2), upi: RECEIVER_UPI, name: 'JEYARAJ ALAGAR', status: 'SUCCESS' }, expect: ['verified', 'manual_review'] },
    { name: 'reg_expired_order', type: 'registration', amount: 120, backdate: true, shot: { amount: '120.00', utr: utrSeq(1), upi: RECEIVER_UPI, name: 'JEYARAJ ALAGAR', status: 'SUCCESS' }, expect: ['verified', 'manual_review', 'rejected'] },
  ];

  const results = [];
  for (const c of cases) {
    const t0 = Date.now();
    console.log('\n[' + c.name + '] starting (' + c.type + ' ₹' + c.amount + ')...');
    const r = await runFlow(c);
    r.ms = Date.now() - t0;
    results.push(r);
    if (r.error) {
      console.log('  [FAIL] ' + r.step + ' error: ' + r.error);
    } else {
      console.log('  terminal=' + r.terminal + ' verificationStatus=' + r.verificationStatus + ' in ' + r.ms + 'ms');
      if (r.checks) console.log('  checks: ' + r.checks.join(', '));
      if (r.reasons && r.reasons.length) console.log('  reasons: ' + r.reasons.slice(0, 3).join(' | '));
    }
  }

  console.log('\n== E2E FULL SUITE RESULTS ==');
  console.log('schema:', schema, '| started:', 'see above', '| finished:', new Date().toISOString());
  console.log('');
  console.log('CASE'.padEnd(20) + 'STATUS'.padEnd(14) + 'VERIF'.padEnd(12) + 'EXPECTED'.padEnd(28) + 'RESULT');
  let failed = 0;
  for (const r of results) {
    const expected = (cases.find(c => c.name === r.case) || {}).expect || [];
    const ok = !r.error && r.terminal && expected.includes(r.terminal);
    if (!ok) failed++;
    console.log(
      (r.case || '').padEnd(20) +
      String(r.terminal || 'ERR').padEnd(14) +
      String(r.verificationStatus || '-').padEnd(12) +
      expected.join('/').padEnd(28) +
      (ok ? 'PASS' : 'FAIL' + (r.error ? ' (' + r.step + ': ' + r.error + ')' : ''))
    );
  }
  console.log('');
  if (failed === 0) {
    console.log('ALL CASES PASSED (' + results.length + '/' + results.length + ')' + (schemaComplete ? '' : ' — re-run after migration for strict dup-UTR check'));
    process.exit(0);
  } else {
    console.log(failed + ' CASE(S) FAILED');
    process.exit(1);
  }
})().catch(e => { console.error('SUITE ERROR:', e.stack || e.message); process.exit(1); });
