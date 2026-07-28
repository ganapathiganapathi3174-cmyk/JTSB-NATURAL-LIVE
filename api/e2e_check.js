const { Jimp, loadFont } = require('jimp');
const path = require('path');
const engine = require('./_verification/index.js');

const NOW = new Date();
const DD = String(NOW.getDate()).padStart(2, '0');
const MM = String(NOW.getMonth() + 1).padStart(2, '0');
const YYYY = NOW.getFullYear();
const HH = NOW.getHours() % 12 || 12;
const MI = String(NOW.getMinutes()).padStart(2, '0');
const AP = NOW.getHours() >= 12 ? 'PM' : 'AM';
const TODAY = YYYY + '-' + MM + '-' + DD;
const DISP = DD + '/' + MM + '/' + YYYY;

const TESTS = [
  { label: 'Membership 120', amount: 120, utr: 'MEM120TEST01' },
  { label: 'Topup 500',      amount: 500, utr: 'TOP500TEST01' },
  { label: 'Topup 1000',     amount: 1000, utr: 'TOP1KTEST01' },
];

let passed = 0, failed = 0;

async function genImg(amount, utr) {
  const W = 800, H = 500;
  const img = new Jimp({ width: W, height: H, color: 0xFFFFFFFF });
  for (let y = 0; y < 60; y++)
    for (let x = 0; x < W; x++)
      img.setPixelColor(0xFF4CAF50, x, y);
  const fd = path.join(__dirname, 'node_modules', '@jimp', 'plugin-print', 'dist', 'fonts', 'open-sans');
  const f16 = await loadFont(path.join(fd, 'open-sans-16-black', 'open-sans-16-black.fnt'));
  const f32 = await loadFont(path.join(fd, 'open-sans-32-black', 'open-sans-32-black.fnt'));
  const f64 = await loadFont(path.join(fd, 'open-sans-64-black', 'open-sans-64-black.fnt'));
  img.print({ font: f16, x: 20, y: 20, text: 'PhonePe' });
  img.print({ font: f64, x: 280, y: 80, text: String(amount) });
  let yp = 180;
  function df(l, v) { img.print({ font: f16, x: 30, y: yp + 6, text: l }); img.print({ font: f32, x: 170, y: yp, text: v }); yp += 45; }
  df('Name:', 'JEYARAJ ALAGAR');
  df('UPI:', 'jayarajj126-3@okicici');
  df('UTR:', utr);
  df('Date:', DISP);
  df('Time:', HH + ':' + MI + ' ' + AP);
  df('Status:', 'SUCCESS');
  return img.getBuffer('image/png');
}

async function main() {
  console.log('=== NUCLEAR ENGINE E2E ===');
  console.log('Date:', TODAY, 'Time:', HH + ':' + MI, AP);
  console.log('');
  for (const t of TESTS) {
    const buf = await genImg(t.amount, t.utr);
    const order = { id: 'e2e-' + t.utr, amount: t.amount, type: t.amount === 120 ? 'registration' : 'topup', user_id: 'e2e-user', utr: t.utr, created_at: new Date().toISOString() };
    const r = await engine.run(order, null, 'e2e-user', t.utr, buf);
    const ok = r.status === 'verified' || r.status === 'manual_review';
    console.log('[' + (ok ? 'PASS' : 'FAIL') + '] ' + t.label + ' -> ' + r.status + ' score=' + r.verificationScore + ' reasons=' + (r.reasons || []).join('; '));
    if (ok) passed++; else failed++;
  }
  console.log('');
  if (failed === 0) { console.log('ALL ' + passed + '/' + passed + ' PASSED'); process.exit(0); }
  else { console.log(passed + '/' + (passed + failed) + ' passed, ' + failed + ' FAILED'); process.exit(1); }
}
main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
