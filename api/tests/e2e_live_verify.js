const { genPhonePeScreenshot } = require('./gen_screenshot.js');

const BASE = 'https://starlightascent.vercel.app/api';

async function req(path, opts) {
  const res = await fetch(BASE + path, opts);
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, text };
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const now = Date.now();
  const email = 'e2e.live.' + now + '@example.com';
  const phone = '9' + String(now).slice(-9);
  const rnd = String(now).slice(-8);

  console.log('== E2E: LIVE VERIFICATION TRACE ==');
  console.log('email:', email);

  // 1. preRegister
  let r = await req('/preRegister', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Trace User', email, phone, password: 'Passw0rd!' }),
  });
  console.log('\n[1] preRegister ->', r.status, JSON.stringify(r.body));
  const pendingRegId = r.body.pendingRegId;
  if (!pendingRegId) { console.log('ABORT: no pendingRegId'); process.exit(1); }

  // 2. createPaymentOrder
  r = await req('/createPaymentOrder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'registration', amount: 120, pendingRegId }),
  });
  console.log('\n[2] createPaymentOrder ->', r.status, JSON.stringify(r.body));
  const orderId = r.body.orderId;
  if (!orderId) { console.log('ABORT: no orderId'); process.exit(1); }

  // 3. generate screenshot
  console.log('\n[3] generating synthetic PhonePe screenshot...');
  const utr = '98765' + rnd;
  const shot = await genPhonePeScreenshot({
    amount: '120.00',
    utr,
    upi: 'jayarajj126-3@okicici',
    name: 'JEYARAJ ALAGAR',
  });
  console.log('[3] screenshot', shot.buffer.length, 'bytes');

  // 4. submitPaymentProof
  console.log('\n[4] submitPaymentProof (t0=' + new Date().toISOString() + ')');
  const t0 = Date.now();
  r = await req('/submitPaymentProof', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId,
      screenshot: shot.dataUrl,
      upiId: 'jayarajj126-3@okicici',
      utr,
    }),
  });
  console.log('[4] submitPaymentProof ->', r.status, 'after', Date.now() - t0, 'ms');
  console.log('[4] response body:', JSON.stringify(r.body).slice(0, 400));

  // 5. poll getPaymentOrderStatus
  console.log('\n[5] polling getPaymentOrderStatus every 3s (up to 30)...');
  let finalStatus = null;
  for (let i = 1; i <= 30; i++) {
    await wait(3000);
    r = await req('/getPaymentOrderStatus?orderId=' + orderId);
    const b = r.body;
    const elapsed = Math.round((Date.now() - t0) / 1000);
    console.log('[5.' + i + '] +' + elapsed + 's status=' + b.status + ' verificationStatus=' + b.verificationStatus +
      ' score=' + b.verificationScore + ' screenshotUrl=' + String(b.screenshotUrl).substring(0, 50));
    if (b.status === 'verified' || b.status === 'rejected' || b.status === 'manual_review') {
      finalStatus = b.status;
      break;
    }
  }

  console.log('\n== E2E RESULT ==');
  console.log('orderId:', orderId, 'pendingRegId:', pendingRegId);
  console.log('finalStatus:', finalStatus || 'STILL PENDING after 90s');

  // 6. Also fetch via getUPIPayments / direct order check through a public endpoint
  r = await req('/getPaymentOrderStatus?orderId=' + orderId);
  console.log('\n[6] final getPaymentOrderStatus:', r.status, JSON.stringify(r.body));

  process.exit(0);
})().catch(e => { console.error('E2E ERROR:', e.message, e.stack); process.exit(1); });
