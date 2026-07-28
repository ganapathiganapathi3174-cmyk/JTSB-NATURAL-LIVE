// OCR Flow Test v2 — generates clearer high-contrast screenshot
const https = require('https');
const http = require('http');
const J = require('jimp');
const { Jimp: JimpCtor } = J;

const BASE_URL = process.env.E2E_BASE_URL || 'https://jsree-apex.vercel.app';

function rand(n) { return Math.random().toString(36).slice(2, 2+n).toUpperCase(); }

async function generateScreenshot(amount, utr, receiverUpi) {
  const w = 1200, h = 1800;
  const img = new JimpCtor({ width: w, height: h, color: 0xFFFFFFFF });

  // White background
  const white = J.rgbaToInt(255, 255, 255, 255);
  const black = J.rgbaToInt(0, 0, 0, 255);
  const green = J.rgbaToInt(22, 163, 74, 255);
  const gray = J.rgbaToInt(120, 120, 120, 255);
  const lightGray = J.rgbaToInt(245, 247, 250, 255);
  const cardBg = J.rgbaToInt(252, 252, 253, 255);

  // Fill background
  for (let y = 0; y < h; y+=10)
    for (let x = 0; x < w; x+=10)
      img.setPixelColor(lightGray, x, y);

  // Top banner
  for (let y = 0; y < 160; y+=5)
    for (let x = 0; x < w; x+=5)
      img.setPixelColor(J.rgbaToInt(95, 37, 159, 255), x, y);

  // Payment card
  for (let y = 200; y < 700; y+=5)
    for (let x = 60; x < w-60; x+=5)
      img.setPixelColor(white, x, y);

  // Success badge
  for (let y = 280; y < 360; y++)
    for (let x = 520; x < w-520; x++)
      img.setPixelColor(green, x, y);

  // Details card
  for (let y = 750; y < 1450; y+=5)
    for (let x = 60; x < w-60; x+=5)
      img.setPixelColor(cardBg, x, y);

  // Load fonts
  try {
    const font64 = await J.loadFont(J.FONT_SANS_64_BLACK);
    const font32 = await J.loadFont(J.FONT_SANS_32_BLACK);
    const font16 = await J.loadFont(J.FONT_SANS_16_BLACK);

    // App name
    img.print(font32, 60, 60, 'PhonePe');

    // Success message
    const successMsg = 'PAYMENT SUCCESSFUL';
    const smW = J.measureText(font32, successMsg);
    img.print(font32, (w - smW) / 2, 295, successMsg);

    // Amount
    const amtStr = '\u20B9 ' + Number(amount).toFixed(2);
    const amtW = J.measureText(font64, amtStr);
    img.print(font64, (w - amtW) / 2, 420, amtStr);

    // UPI reference
    const upiStr = 'UPI: ' + receiverUpi;
    const upiW = J.measureText(font32, upiStr);
    img.print(font32, (w - upiW) / 2, 530, upiStr);

    // Transaction details
    const labels = [
      'Transaction ID', 'UTR Number', 'Date & Time',
      'From', 'To', 'Status', 'Remark'
    ];
    const values = [
      'TXN' + rand(10), utr, '27 Jun 2026  02:30 PM',
      'Test User  (test@upi)', receiverUpi, 'SUCCESS', 'Payment for registration'
    ];

    let yPos = 810;
    for (let i = 0; i < labels.length; i++) {
      img.print(font16, 80, yPos, labels[i]);
      img.print(font32, 80, yPos + 28, values[i]);
      yPos += 82;
    }
  } catch (e) {
    console.log('Font error:', e.message);
  }

  const buf = await img.getBuffer('image/png');
  return 'data:image/png;base64,' + buf.toString('base64');
}

function httpRequest(method, path, body, token, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const mod = url.protocol === 'https:' ? https : http;
    const opt = {
      hostname: url.hostname, port: url.port || 443,
      path: url.pathname, method,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      timeout: timeoutMs,
    };
    if (token) opt.headers['Authorization'] = `Bearer ${token}`;
    const r = mod.request(opt, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try {resolve({status:res.statusCode, body: JSON.parse(d)});} catch {resolve({status:res.statusCode, body: d});} }); });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  console.log('=== OCR FLOW TEST v2 ===\n');

  const amount = 500;
  const utr = 'HDFC' + rand(12);
  const receiverUpi = 'jayarajj126-3@okicici';

  console.log('Generating high-contrast payment screenshot...');
  const startGen = Date.now();
  const dataUrl = await generateScreenshot(amount, utr, receiverUpi);
  console.log('Done: ' + ((Date.now()-startGen)/1000).toFixed(1) + 's, ' + (dataUrl.length / 1024).toFixed(0) + 'KB\n');

  const email = 'ocr2_' + Date.now() + '@test.com';
  const phone = '9' + Math.random().toString().slice(2, 11);

  console.log('1. Pre-register: ' + email);
  const reg = await httpRequest('POST', '/api/preRegister', {
    name: 'OCR Test User', email, phone, password: 'TestPass@123', referralCode: null,
  });
  if (reg.status !== 200) { console.log('FAIL:', JSON.stringify(reg.body)); return; }
  const pendingRegId = reg.body.pendingRegId;
  console.log('   OK: ' + pendingRegId + '\n');

  console.log('2. Create order for \u20B9' + amount);
  const order = await httpRequest('POST', '/api/createPaymentOrder', {
    type: 'registration', amount, pendingRegId,
  });
  if (order.status !== 200) { console.log('FAIL:', JSON.stringify(order.body)); return; }
  const orderId = order.body.orderId;
  console.log('   OK: ' + orderId + '\n');

  console.log('3. Submit payment proof (OCR will analyze screenshot)...');
  console.log('   UTR: ' + utr);
  const start = Date.now();
  const proof = await httpRequest('POST', '/api/submitPaymentProof', {
    orderId, screenshot: dataUrl, utr, upiId: receiverUpi,
  }, null, 90000);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log('   HTTP ' + proof.status + ' in ' + elapsed + 's\n');

  if (proof.status === 200 && proof.body) {
    const b = proof.body;
    console.log('=== RESULT ===');
    console.log('Status:       ' + b.status);
    console.log('Score:        ' + (b.verificationScore ?? 'N/A'));
    if (b.ocrData) {
      console.log('OCR Amount:   ' + b.ocrData.extractedAmount);
      console.log('OCR UTR:      ' + b.ocrData.extractedUtr);
      console.log('OCR Receiver: ' + b.ocrData.extractedReceiverName);
      console.log('OCR Date:     ' + b.ocrData.extractedDate);
      console.log('Confidence:   ' + b.ocrData.confidence);
    } else {
      console.log('OCR Data:     (none extracted)');
    }
    console.log('Match Amt:    ' + b.matchedAmount);
    console.log('Match UTR:    ' + b.matchedUtr);
    console.log('Match Rcvr:   ' + b.matchedReceiver);
    console.log('Fraud Score:  ' + (b.fraudScore ?? 0));
    if (b.reasons?.length) console.log('Reasons:      ' + b.reasons.join(', '));

    if (b.status === 'verified') console.log('\n✅ VERIFIED - Pipeline works!');
    else if (b.status === 'pending') console.log('\n⏳ PENDING - Queued for async processing');
    else console.log('\n❌ REJECTED - Details above');
  } else {
    console.log('ERROR:', proof.status, JSON.stringify(proof.body).slice(0, 200));
  }
}

main().catch(e => console.error('FATAL:', e.message));
