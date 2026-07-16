// OCR Test: Generate realistic screenshot, upload, verify extraction
// Run: node api/test_ocr_flow.js

const https = require('https');
const http = require('http');
const Jimp = require('jimp');
const { Jimp: JimpCtor } = Jimp;

const BASE_URL = process.env.E2E_BASE_URL || 'https://starlightascent.vercel.app';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'jayaraj@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'jayaraj7523';

function rand(n) { return Math.random().toString().slice(2, 2+n); }

async function generateScreenshot(amount, utr, receiverUpi, senderName) {
  const w = 1080, h = 1920;
  const img = new JimpCtor({ width: w, height: h, color: 0xFFFFFFFF });

  // Background color (light gray)
  const bgColor = Jimp.rgbaToInt(245, 247, 250, 255);
  for (let y = 0; y < h; y+=5) {
    for (let x = 0; x < w; x+=5) {
      img.setPixelColor(bgColor, x, y);
    }
  }

  // Helper to draw text using Jimp's print
  async function drawText(text, x, y, size, color, font) {
    try {
      const fnt = await Jimp.loadFont(font || Jimp.FONT_SANS_32_BLACK);
      const j = new JimpCtor({ width: w, height: h, color: 0x00000000 });
      const loaded = await Jimp.loadFont(font || Jimp.FONT_SANS_32_BLACK);
      j.print(loaded, x, y, text, w - x - 40);
      img.composite(j, 0, 0, {
        mode: Jimp.BLEND_SRC_OVER,
        opacitySource: 1,
        opacityDest: 1,
      });
    } catch(e) { /* skip font errors */ }
  }

  // Merchant/App Header
  await drawText('PhonePe', 60, 80, 48, 0x5F259FFF, Jimp.FONT_SANS_64_BLACK);

  // Payment card (white)
  const white = Jimp.rgbaToInt(255, 255, 255, 255);
  for (let y = 200; y < 700; y+=5) {
    for (let x = 40; x < w-40; x+=5) {
      img.setPixelColor(white, x, y);
    }
  }

  await drawText('Payment Successful', 200, 260, 42, 0x16A34AFF, Jimp.FONT_SANS_32_WHITE);
  await drawText('₹' + Number(amount).toFixed(2), 60, 340, 72, 0x000000FF, Jimp.FONT_SANS_64_BLACK);
  await drawText('Paid to ' + receiverUpi, 60, 440, 36, 0x000000FF, Jimp.FONT_SANS_32_BLACK);

  // Transaction details card
  for (let y = 760; y < 1200; y++) {
    for (let x = 40; x < w-40; x+=5) {
      img.setPixelColor(0xFFF9F9FF, x, y);
    }
  }

  let yOff = 820;
  const details = [
    ['Transaction ID', 'TXN' + rand(10)],
    ['UTR Number', utr],
    ['Date & Time', new Date().toLocaleDateString('en-IN') + ' 14:30'],
    ['From', senderName + ' (' + rand(10) + '@upi)'],
    ['To', receiverUpi],
    ['Status', 'SUCCESS'],
    ['Ref No', 'REF' + rand(12)],
  ];
  for (const [label, value] of details) {
    await drawText(label, 60, yOff, 26, 0x888888FF, Jimp.FONT_SANS_32_BLACK);
    await drawText(value, 60, yOff + 36, 30, 0x000000FF, Jimp.FONT_SANS_32_BLACK);
    yOff += 90;
  }

  const buf = await img.getBuffer('image/png');
  const b64 = buf.toString('base64');
  return 'data:image/png;base64,' + b64;
}

function httpRequest(method, path, body, token, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const mod = url.protocol === 'https:' ? https : http;
    const opt = {
      hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
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
  console.log('=== OCR FLOW TEST ===\n');

  // Generate screenshot
  const amount = 500;
  const utr = 'HDFC' + rand(8) + 'N';
  const receiverUpi = 'jayarajj126-3@okicici';
  const senderName = 'Test User';
  console.log('Generating test screenshot...');
  const dataUrl = await generateScreenshot(amount, utr, receiverUpi, senderName);
  console.log('Screenshot generated: ' + (dataUrl.length / 1024).toFixed(0) + 'KB\n');

  // Pre-register
  const email = 'ocr_test_' + Date.now() + '@test.com';
  const phone = '9' + rand(9);
  console.log('1. Pre-registering user: ' + email);
  const reg = await httpRequest('POST', '/api/preRegister', {
    name: 'OCR Test User', email, phone, password: 'Test@123', referralCode: null,
  });
  if (reg.status !== 200) { console.log('FAIL: ' + JSON.stringify(reg.body)); return; }
  const pendingRegId = reg.body.pendingRegId;
  console.log('   pendingRegId: ' + pendingRegId + '\n');

  // Create payment order
  console.log('2. Creating payment order for ₹' + amount);
  const order = await httpRequest('POST', '/api/createPaymentOrder', {
    type: 'registration', amount, pendingRegId,
  });
  if (order.status !== 200) { console.log('FAIL: ' + JSON.stringify(order.body)); return; }
  const orderId = order.body.orderId;
  console.log('   orderId: ' + orderId + '\n');

  // Submit payment proof
  console.log('3. Submitting payment proof (OCR will run)...');
  console.log('   UTR: ' + utr);
  console.log('   Amount: ₹' + amount);
  console.log('   Receiver: ' + receiverUpi);
  const start = Date.now();
  const proof = await httpRequest('POST', '/api/submitPaymentProof', {
    orderId, screenshot: dataUrl, utr, upiId: receiverUpi,
  }, null, 90000);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log('   Response: ' + proof.status + ' (' + elapsed + 's)\n');

  // Report
  if (proof.status === 200) {
    const b = proof.body;
    console.log('=== OCR RESULT ===');
    console.log('Status:        ' + b.status);
    console.log('Score:         ' + (b.verificationScore ?? 'N/A') + '%');
    if (b.ocrData) {
      console.log('Extracted Amt: ' + b.ocrData.extractedAmount);
      console.log('Extracted UTR: ' + b.ocrData.extractedUtr);
      console.log('Extracted Rcvr: ' + b.ocrData.extractedReceiverName);
      console.log('Extracted Date: ' + b.ocrData.extractedDate);
      console.log('Confidence:    ' + b.ocrData.confidence);
    }
    console.log('Matched Amt:   ' + b.matchedAmount);
    console.log('Matched UTR:   ' + b.matchedUtr);
    console.log('Matched Rcvr:  ' + b.matchedReceiver);
    console.log('Matched Date:  ' + b.matchedDate);
    if (b.reasons?.length) console.log('Reasons:       ' + b.reasons.join(', '));
    if (b.fraudScore != null) console.log('Fraud Score:   ' + b.fraudScore);
    console.log('\n=== VERDICT ===');
    if (b.status === 'verified') console.log('✅ PAYMENT VERIFIED - Pipeline works correctly!');
    else if (b.status === 'pending') console.log('⏳ PENDING - OCR queued for async processing');
    else console.log('❌ REJECTED - OCR extraction failed or mismatched');
  } else {
    console.log('ERROR: ' + JSON.stringify(proof.body).slice(0, 200));
  }
}

main().catch(e => console.error('FATAL:', e.message));
