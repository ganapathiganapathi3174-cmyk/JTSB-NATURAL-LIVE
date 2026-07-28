const { Jimp, loadFont } = require('jimp');
const path = require('path');

const TODAY = new Date();
const DD = String(TODAY.getDate()).padStart(2, '0');
const MM = String(TODAY.getMonth() + 1).padStart(2, '0');
const YYYY = TODAY.getFullYear();
const NOW_H = TODAY.getHours();
const NOW_MI = TODAY.getMinutes();
const AMPM = NOW_H >= 12 ? 'PM' : 'AM';
const DISPLAY_H = NOW_H % 12 || 12;
const TODAY_STR = YYYY + '-' + MM + '-' + DD;
const TODAY_DISPLAY = DD + '/' + MM + '/' + YYYY;
const TEST_AMOUNT = 120;
const TEST_UTR = '123456789012';
const TEST_UPI = 'jayarajj126-3@okicici';

console.log('=== VERIFICATION ENGINE V5 E2E TEST ===');
console.log('Date:', TODAY_STR);
console.log('Time:', DISPLAY_H + ':' + NOW_MI + ' ' + AMPM);
console.log('Expected amount:', TEST_AMOUNT);
console.log('Expected UTR:', TEST_UTR);
console.log('Expected UPI:', TEST_UPI);
console.log('');

async function generateUPIImage() {
  const W = 800, H = 500;
  const img = new Jimp({ width: W, height: H, color: 0xFFFFFFFF });

  for (let y = 0; y < 60; y++) {
    for (let x = 0; x < W; x++) {
      img.setPixelColor(0xFF4CAF50, x, y);
    }
  }

  const fontDir = path.join(__dirname, 'node_modules', '@jimp', 'plugin-print', 'dist', 'fonts', 'open-sans');
  const font16 = await loadFont(path.join(fontDir, 'open-sans-16-black', 'open-sans-16-black.fnt'));
  const font32 = await loadFont(path.join(fontDir, 'open-sans-32-black', 'open-sans-32-black.fnt'));
  const font64 = await loadFont(path.join(fontDir, 'open-sans-64-black', 'open-sans-64-black.fnt'));

  img.print({ font: font16, x: 20, y: 20, text: 'PhonePe' });
  img.print({ font: font64, x: 280, y: 80, text: '\u20B9' + String(TEST_AMOUNT) });

  let yPos = 180;
  const lineH = 45;

  function drawField(label, value) {
    img.print({ font: font16, x: 30, y: yPos + 6, text: label });
    img.print({ font: font32, x: 170, y: yPos, text: value });
    yPos += lineH;
  }

  drawField('UPI ID:', TEST_UPI);
  drawField('UTR:', TEST_UTR);
  drawField('Date:', TODAY_DISPLAY);
  drawField('Time:', DISPLAY_H + ':' + String(NOW_MI).padStart(2, '0') + ' ' + AMPM);
  drawField('Status:', 'SUCCESS');

  const buf = await img.getBuffer('image/png');
  console.log('Test image: ' + buf.length + ' bytes');
  return buf;
}

async function main() {
  const buf = await generateUPIImage();

  const verificationEngine = require('./_verification/index.js');
  const testOrder = {
    id: 'e2e-test-order',
    amount: TEST_AMOUNT,
    type: 'registration',
    user_id: 'test-user-001',
    utr: TEST_UTR,
    created_at: new Date().toISOString(),
  };

  console.log('');
  console.log('--- RUNNING V5 ENGINE ---');
  const t0 = Date.now();
  const result = await verificationEngine.run(testOrder, null, testOrder.user_id, TEST_UTR, buf);
  const elapsed = Date.now() - t0;
  console.log('Engine duration: ' + elapsed + 'ms');
  console.log('');

  console.log('=== ENGINE RESULT ===');
  console.log('Status: ' + result.status);
  console.log('Score: ' + result.verificationScore + '%');
  console.log('Auto-verified: ' + result.autoVerified);
  console.log('Manual review: ' + result.manualReviewRequired);
  console.log('Fraud score: ' + (result.fraudScore || 0));
  console.log('');

  console.log('=== MATCHED FIELDS ===');
  console.log('Amount:   ' + (result.matchedAmount ? '✓' : '✗') + (result.ocrData ? ' (' + result.ocrData.amount + ')' : ''));
  console.log('UPI:      ' + (result.matchedReceiver ? '✓' : '✗') + (result.ocrData ? ' (' + result.ocrData.receiverUpi + ')' : ''));
  console.log('Name:     ' + (result.matchedName ? '✓' : '✗') + (result.ocrData ? ' (' + result.ocrData.receiverName + ')' : ''));
  console.log('UTR:      ' + (result.matchedUtr ? '✓' : '✗') + (result.ocrData ? ' (' + result.ocrData.utr + ')' : ''));
  console.log('Date:     ' + (result.matchedDate ? '✓' : '✗') + (result.ocrData ? ' (' + result.ocrData.date + ')' : ''));
  console.log('Status:   ' + (result.matchedStatus ? '✓' : '✗') + (result.ocrData ? ' (' + result.ocrData.paymentStatus + ')' : ''));
  console.log('UTR user: ' + (result.userUtrMatched ? '✓' : '✗'));
  console.log('');

  console.log('=== REASONS ===');
  for (const r of (result.reasons || [])) {
    console.log('  - ' + r);
  }
  console.log('');

  console.log('=== SUCCESS CRITERIA ===');
  let passed = 0, failed = 0;
  const checks = [
    ['Pipeline completed without crash', true],
    ['Status is defined', !!result.status],
    ['No score 0%', (result.verificationScore || 0) > 0],
    ['Not rejected (valid screenshot)', result.status !== 'rejected'],
    ['UTR extracted (' + TEST_UTR + ')', result.matchedUtr === true],
    ['Date = today (' + TODAY_STR + ')', result.matchedDate === true],
    ['Fraud score low' + (result.fraudScore < 30 ? '' : ' (' + result.fraudScore + ')'), (result.fraudScore || 0) < 30],
    ['Amount matched (₹' + TEST_AMOUNT + ')', result.matchedAmount === true],
    ['UPI matched (' + TEST_UPI + ')', result.matchedReceiver === true],
    ['Reasons array populated', Array.isArray(result.reasons) && result.reasons.length > 0],
    ['Timings recorded', Object.keys(result.timings || {}).length > 0],
  ];
  for (const [label, ok] of checks) {
    console.log('  [' + (ok ? 'PASS' : 'FAIL') + '] ' + label);
    if (ok) passed++; else failed++;
  }
  console.log('');
  console.log('=== VERDICT ===');
  if (failed === 0) {
    console.log('ALL ' + passed + '/' + passed + ' V5 E2E TESTS PASSED');
    process.exit(0);
  } else {
    console.log(passed + '/' + (passed + failed) + ' passed, ' + failed + ' FAILED');
    process.exit(1);
  }
}

main().catch(e => {
  console.error('FATAL:', e.message);
  console.error(e.stack);
  process.exit(1);
});