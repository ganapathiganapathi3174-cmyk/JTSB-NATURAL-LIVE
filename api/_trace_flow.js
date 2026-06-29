/**
 * Complete data flow trace: Pipeline JSON → Map → Verify → Decision
 * Usage: node _trace_flow.js <payment_id>
 * If no payment_id given, uses the first payment with a real screenshot.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const PYTHON_PATH = 'C:\\Users\\Sahan\\AppData\\Local\\Programs\\Python\\Python312\\python.exe';
const SCRIPT_PATH = path.join(__dirname, '_pipeline.py');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gaqxnvqxgzcvbrpigiad.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdhcXhudnF4Z3pjdmJycGlnaWFkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjE5NDU1MiwiZXhwIjoyMDk3NzcwNTUyfQ.JqhO_ibekW6W6wfN4p3ADgp5pC0zSykGNuGlp1g0A30';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const PAYMENT_ID = process.argv[2] || 'a0f14bd0-e1a9-4b1a-aaed-70708b7186ab';

function sep(title) {
  console.log('\n' + '='.repeat(80));
  console.log('  ' + title);
  console.log('='.repeat(80));
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', function () { this.destroy(); reject(new Error('Timeout')); });
  });
}

function guessExtension(buf) {
  if (!buf || buf.length < 4) return '.jpg';
  if (buf[0] === 0xFF && buf[1] === 0xD8) return '.jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return '.png';
  if (buf[0] === 0x47 && buf[1] === 0x49) return '.gif';
  if (buf[0] === 0x52 && buf[1] === 0x49) return '.webp';
  if (buf[0] === 0x42 && buf[1] === 0x4D) return '.bmp';
  return '.jpg';
}

function runPython(imagePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_PATH, [SCRIPT_PATH, imagePath], {
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: 'True', PYTHONIOENCODING: 'utf-8' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => process.stderr.write(d));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error('Exit=' + code + ', stderr=' + stderr.slice(-200)));
      try { resolve(JSON.parse(stdout)); }
      catch (e) { reject(new Error('Parse error: ' + e.message)); }
    });
    child.on('error', reject);
  });
}

async function main() {
  // ── FETCH PAYMENT ──
  sep('1. PAYMENT FROM DATABASE');
  const { data: payments, error } = await sb.from('upi_payments')
    .select('id, amount, upi_id, utr, screenshot_url, status, user_id, created_at')
    .eq('id', PAYMENT_ID);
  if (error || !payments || payments.length === 0) {
    console.error('Payment not found:', PAYMENT_ID, error);
    process.exit(1);
  }
  const payment = payments[0];
  console.log(JSON.stringify(payment, null, 2));
  console.log('\nExpected values from database:');
  console.log('  ID:             ' + payment.id);
  console.log('  Amount:         ₹' + payment.amount);
  console.log('  Receiver UPI:   ' + payment.upi_id);
  console.log('  Expected UTR:   ' + payment.utr);
  console.log('  Status in DB:   ' + payment.status);
  console.log('  Screenshot URL: ' + payment.screenshot_url);

  const amountNum = Number(payment.amount) || 0;
  const expectedUpiId = (payment.upi_id || '').toLowerCase().trim();
  const expectedUtr = (payment.utr || '').toUpperCase().trim();

  // ── DOWNLOAD SCREENSHOT ──
  sep('2. DOWNLOAD SCREENSHOT');
  console.log('URL: ' + payment.screenshot_url);
  let rawBuf, tempPath;
  try {
    rawBuf = await fetchBuffer(payment.screenshot_url);
    console.log('Size: ' + rawBuf.length + ' bytes');
    console.log('Type: ' + guessExtension(rawBuf));
    const ext = guessExtension(rawBuf);
    const tempName = 'trace_' + crypto.randomBytes(8).toString('hex') + ext;
    tempPath = path.join(os.tmpdir(), tempName);
    fs.writeFileSync(tempPath, rawBuf);
    console.log('Saved to: ' + tempPath);
  } catch (e) {
    console.error('FAILED to download screenshot: ' + e.message);
    console.log('\nCannot proceed — screenshot must be downloadable.\n');
    process.exit(1);
  }

  // ── RUN PYTHON PIPELINE ──
  sep('3. RAW PYTHON PIPELINE JSON');
  let rawPipeline;
  try {
    rawPipeline = await runPython(tempPath);
    const pretty = JSON.stringify(rawPipeline, (key, val) => {
      if (key === 'pipelineLog') return '[ARRAY ' + val.length + ' entries]';
      return val;
    }, 2);
    console.log(pretty);
  } catch (e) {
    console.error('Pipeline failed: ' + e.message);
    process.exit(1);
  } finally {
    try { fs.unlinkSync(tempPath); } catch (_) {}
  }

  if (rawPipeline.error) {
    console.error('Pipeline returned error: ' + rawPipeline.error);
    process.exit(1);
  }
  if (rawPipeline.earlyExit) {
    console.log('\n⚠  Pipeline early exit: ' + (rawPipeline.earlyExitReason || 'unknown'));
  }

  // ── MAP TO VERIFICATION FORMAT ──
  sep('4. MAPPED NODE.JS OBJECT (mapToVerificationFormat)');
  const { mapToVerificationFormat } = require('./_pipeline_bridge.js');
  const mapped = mapToVerificationFormat(rawPipeline);
  console.log(JSON.stringify(mapped, null, 2).substring(0, 6000));
  console.log('...(truncated if >6000 chars)');

  const { ocrResult, visualValidation, imageQuality, parsed } = mapped;
  const rawOcrText = ocrResult.ocrText || '';
  const ocrConfidence = ocrResult.confidence || 0;
  const screenshotHash = ocrResult.imageHash || visualValidation.perceptualHash || '';

  // ── PARSED/NORMALIZED FIELDS ──
  sep('5. NORMALIZED FIELDS (from Pipeline → mapped → parsed)');
  const fieldNames = ['extractedAmount','extractedUtr','extractedReceiverUpi','extractedSenderUpi','extractedDate','extractedTime','extractedStatus','extractedBankName','extractedTxnId','receiverName','senderName','appName'];
  for (const fn of fieldNames) {
    const val = parsed ? parsed[fn] : undefined;
    console.log('  ' + fn + ': ' + (val !== null && val !== undefined ? JSON.stringify(val) : 'null'));
  }
  console.log('\n  ocrConfidence: ' + ocrConfidence + '%');
  console.log('  parsed.confidence: ' + (parsed ? parsed.confidence : 'N/A') + '%');
  console.log('  perceptualHash: ' + (visualValidation.perceptualHash || 'none'));
  console.log('  rawOcrText length: ' + rawOcrText.length + ' chars');
  console.log('  rawOcrText preview: ' + rawOcrText.substring(0, 300));

  // Also print raw fields from pipeline (fieldsNormalized)
  const pipeFields = rawPipeline.fieldsNormalized || rawPipeline.fields || {};
  sep('5b. RAW EXTRACTED FIELDS (from Python pipeline)');
  for (const [k, v] of Object.entries(pipeFields)) {
    if (v && v.value !== undefined) {
      console.log('  ' + k + ': value=' + JSON.stringify(v.value) + ', confidence=' + v.confidence + '%, engine=' + v.engine + ', bbox=' + (v.bbox ? JSON.stringify(v.bbox) : 'null'));
    } else {
      console.log('  ' + k + ': NOT EXTRACTED');
    }
  }

  // ── COMPARISON ──
  sep('6. COMPARISON RESULTS');

  // Parse OCR amount
  function parseOcrAmount(val) {
    if (val === null || val === undefined || val === '') return null;
    const num = Number(String(val).replace(/[^0-9.]/g, ''));
    return isNaN(num) ? null : num;
  }
  const ocrAmount = parseOcrAmount(parsed ? parsed.extractedAmount : null);

  // Amount comparison
  console.log('--- AMOUNT ---');
  console.log('  Expected: ₹' + amountNum);
  console.log('  OCR read: ' + (ocrAmount !== null ? '₹' + ocrAmount : 'NOT EXTRACTED'));
  let amountMatched = false;
  if (ocrAmount !== null && !isNaN(ocrAmount) && ocrAmount > 0) {
    const diff = Math.abs(ocrAmount - amountNum);
    amountMatched = diff <= 1;
    const pct = ocrAmount > 0 ? Math.round((1 - diff / Math.max(ocrAmount, amountNum)) * 100) : 0;
    console.log('  Difference: ₹' + diff);
    console.log('  Match: ' + (amountMatched ? 'YES' : 'NO'));
    console.log('  Similarity: ' + Math.max(0, pct) + '%');
  } else {
    console.log('  Match: NO (amount not extracted or invalid)');
    console.log('  Similarity: 0%');
  }

  // Receiver comparison
  console.log('\n--- RECEIVER UPI ---');
  console.log('  Expected: ' + expectedUpiId);
  const ocrReceiver = parsed ? (parsed.extractedReceiverUpi || '').toLowerCase().trim() : '';
  console.log('  OCR read: ' + (ocrReceiver || 'NOT EXTRACTED'));
  let receiverMatched = false;
  let receiverSim = 0;
  if (ocrReceiver && expectedUpiId) {
    receiverMatched = ocrReceiver === expectedUpiId;
    const maxLen = Math.max(ocrReceiver.length, expectedUpiId.length);
    const dist = levenshtein(ocrReceiver, expectedUpiId);
    receiverSim = maxLen > 0 ? Math.round((1 - dist / maxLen) * 100) : 0;
    console.log('  Exact match: ' + (receiverMatched ? 'YES' : 'NO'));
    console.log('  Levenshtein distance: ' + dist + '/' + maxLen);
    console.log('  Similarity: ' + receiverSim + '%');
  } else {
    console.log('  Exact match: NO (receiver not extracted or not expected)');
    console.log('  Similarity: 0%');
  }

  // UTR comparison
  console.log('\n--- UTR ---');
  console.log('  Expected: ' + expectedUtr);
  const ocrUtr = parsed ? (parsed.extractedUtr || '').toUpperCase().trim() : '';
  console.log('  OCR read: ' + (ocrUtr || 'NOT EXTRACTED'));
  let utrMatched = false;
  let utrSim = 0;
  if (ocrUtr && expectedUtr) {
    utrMatched = ocrUtr === expectedUtr;
    const maxLen = Math.max(ocrUtr.length, expectedUtr.length);
    const dist = levenshtein(ocrUtr, expectedUtr);
    utrSim = maxLen > 0 ? Math.round((1 - dist / maxLen) * 100) : 0;
    console.log('  Exact match: ' + (utrMatched ? 'YES' : 'NO'));
    console.log('  Levenshtein distance: ' + dist + '/' + maxLen);
    console.log('  Similarity: ' + utrSim + '%');
  } else {
    console.log('  Exact match: NO (UTR not extracted or not expected)');
    console.log('  Similarity: 0%');
  }

  // Date comparison
  console.log('\n--- DATE ---');
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const yesterdayStr = new Date(today.getTime() - 86400000).toISOString().split('T')[0];
  const tomorrowStr = new Date(today.getTime() + 86400000).toISOString().split('T')[0];
  const ocrDate = parsed ? parsed.extractedDate : null;
  console.log('  Expected range: ±1 day from ' + todayStr);
  console.log('  OCR date: ' + (ocrDate || 'NOT EXTRACTED'));
  let dateMatched = false;
  if (ocrDate) {
    dateMatched = ocrDate === todayStr || ocrDate === yesterdayStr || ocrDate === tomorrowStr;
    console.log('  Match: ' + (dateMatched ? 'YES' : 'NO'));
  } else {
    console.log('  Match: NO (date not extracted)');
  }

  // Status comparison
  console.log('\n--- STATUS ---');
  const ocrStatus = parsed ? parsed.extractedStatus : null;
  console.log('  Expected: SUCCESS');
  console.log('  OCR status: ' + (ocrStatus || 'NOT EXTRACTED'));
  const statusValid = ocrStatus === 'SUCCESS';
  console.log('  Status valid: ' + (statusValid ? 'YES' : 'NO'));

  // ── VISUAL/TAMPER SCORES ──
  sep('7. VISUAL & QUALITY SCORES');
  console.log('  Image grade:       ' + imageQuality.overallGrade);
  console.log('  Blur score:        ' + visualValidation.blurScore + ' (threshold: 50 = blurry)');
  console.log('  Is blurred:        ' + visualValidation.isBlurred);
  console.log('  Is cropped:        ' + visualValidation.isCropped);
  console.log('  Is tampered:       ' + visualValidation.isTampered);
  console.log('  Tamper score:      ' + visualValidation.tamperScore);
  console.log('  Issues:            ' + JSON.stringify(imageQuality.issues));
  console.log('  Visual score:      ' + (visualValidation.isScreenshot ? 80 : 50));
  console.log('  Quality passed:    ' + imageQuality.passed);
  const tamperingScore = visualValidation.tamperScore || 0;
  const visualScore = visualValidation.isScreenshot ? 80 : 50;

  // ── FRAUD SCORE ──
  sep('8. FRAUD & DUPLICATE SCORE (simulated — no DB queries)');
  let fraudScore = 0;
  const fraudReasons = [];
  if (ocrAmount !== null && !isNaN(ocrAmount) && ocrAmount > 0 && amountNum > 0) {
    if (Math.abs(ocrAmount - amountNum) > 1) {
      fraudScore += 25;
      fraudReasons.push('Wrong amount (OCR: ₹' + ocrAmount + ', expected: ₹' + amountNum + ')');
    }
  }
  if (ocrReceiver && expectedUpiId) {
    if (ocrReceiver !== expectedUpiId) {
      fraudScore += 35;
      fraudReasons.push('Wrong receiver UPI (paid to ' + ocrReceiver + ')');
    }
  }
  if (ocrStatus === 'FAILED') { fraudScore += 20; fraudReasons.push('Payment status is FAILED/CANCELLED'); }
  if (ocrStatus === 'PENDING') { fraudScore += 10; fraudReasons.push('Payment status is PENDING'); }
  if (tamperingScore >= 60) { fraudScore += 30; fraudReasons.push('Visual tampering (score=' + tamperingScore + ')'); }
  if (tamperingScore >= 80) { fraudScore += 20; fraudReasons.push('High-confidence tampering'); }
  fraudScore = Math.min(fraudScore, 100);
  console.log('  Fraud score: ' + fraudScore + '/100');
  if (fraudReasons.length > 0) {
    console.log('  Fraud reasons:');
    fraudReasons.forEach(r => console.log('    - ' + r));
  } else {
    console.log('  No fraud indicators');
  }

  // ── MATCHING SCORE ──
  sep('9. MATCHING SCORE BREAKDOWN');
  let matchScore = 0;
  const matchDetails = [];
  if (amountMatched) { matchScore += 30; matchDetails.push('Amount matched (+30)'); }
  else { matchDetails.push('Amount NOT matched'); }
  if (receiverMatched) { matchScore += 30; matchDetails.push('Receiver matched (+30)'); }
  else { matchDetails.push('Receiver NOT matched'); }
  if (utrMatched) { matchScore += 20; matchDetails.push('UTR matched (+20)'); }
  else { matchDetails.push('UTR NOT matched'); }
  if (dateMatched) { matchScore += 10; matchDetails.push('Date matched (+10)'); }
  else { matchDetails.push('Date NOT matched'); }
  if (statusValid) { matchScore += 10; matchDetails.push('Status valid (+10)'); }
  else { matchDetails.push('Status NOT valid'); }
  console.log('  Match score: ' + matchScore + '/100');
  matchDetails.forEach(d => console.log('    ' + d));

  // ── DECISION TRACE ──
  sep('10. DECISION ENGINE TRACE');
  console.log('  Inputs:');
  console.log('    matching.amountMatched=' + amountMatched);
  console.log('    matching.receiverMatched=' + receiverMatched);
  console.log('    matching.utrMatched=' + utrMatched);
  console.log('    matching.statusValid=' + statusValid);
  console.log('    fraudScore=' + fraudScore);
  console.log('    visualScore=' + visualScore);
  console.log('    tamperingScore=' + tamperingScore);
  console.log('    imageQuality.overallGrade=' + imageQuality.overallGrade);
  console.log('    ocrConfidence=' + ocrConfidence);
  console.log('    parsed.confidence=' + (parsed ? parsed.confidence : 0));
  console.log('    parsed.extractedReceiverUpi=' + JSON.stringify(parsed ? parsed.extractedReceiverUpi : null));
  console.log('    parsed.extractedAmount=' + JSON.stringify(parsed ? parsed.extractedAmount : null));
  console.log('    parsed.extractedStatus=' + JSON.stringify(parsed ? parsed.extractedStatus : null));
  console.log('    parsed.ambiguous=' + (parsed ? parsed.ambiguous : false));
  console.log('');

  // Now trace each IF in order from makeDecision (lines 503-655)
  const DECISIONS = [
    { line: 522, label: 'Force-approve (all fields match)', condition: amountMatched && receiverMatched && utrMatched && statusValid && fraudScore < 15 && visualScore >= 70 && tamperingScore < 30 && imageQuality.overallGrade !== 'poor' },
    { line: 530, label: 'High-confidence approve (amount+receiver match)', condition: amountMatched && receiverMatched && fraudScore < 20 && visualScore >= 60 && tamperingScore < 40 && imageQuality.overallGrade !== 'poor' },
    { line: 541, label: 'Force-reject: duplicate UTR', condition: false },  // No DB query so always false
    { line: 547, label: 'Force-reject: wrong receiver UPI', condition: !!(parsed && parsed.extractedReceiverUpi && receiverMatched === false) },
    { line: 553, label: 'Force-reject: wrong amount', condition: !!(amountMatched === false && parsed && parsed.extractedAmount !== null && parsed.extractedAmount !== undefined && Number(parsed.extractedAmount) > 0 && Math.abs(Number(parsed.extractedAmount) - amountNum) > 1) },
    { line: 562, label: 'Force-reject: cancelled/failed payment', condition: !!(parsed && parsed.extractedStatus === 'FAILED') },
    { line: 568, label: 'Force-reject: pending payment', condition: !!(parsed && parsed.extractedStatus === 'PENDING') },
    { line: 574, label: 'Force-reject: high fraud score', condition: fraudScore >= 60 },
    { line: 581, label: 'Force-reject: visual tampering', condition: tamperingScore >= 70 },
    { line: 587, label: 'Force-reject: AI generation', condition: tamperingScore >= 60 && fraudScore >= 30 },
    { line: 595, label: 'Manual review: poor image quality', condition: imageQuality.overallGrade === 'poor' },
    { line: 602, label: 'Manual review: moderate tampering', condition: tamperingScore >= 40 && tamperingScore < 70 },
    { line: 608, label: 'Manual review: low OCR confidence', condition: ocrConfidence < 40 && (parsed ? parsed.confidence : 0) < 30 },
    { line: 620, label: 'Manual review: missing ≥2 key fields', condition: (() => { const m = []; if (!parsed || !parsed.extractedAmount) m.push('amount'); if (!parsed || !parsed.extractedUtr) m.push('UTR'); if (!parsed || !parsed.extractedReceiverUpi) m.push('receiver UPI'); if (!parsed || !parsed.extractedStatus) m.push('status'); return m.length >= 2; })() },
    { line: 626, label: 'Manual review: low OCR + 1 missing field', condition: (() => { const m = []; if (!parsed || !parsed.extractedAmount) m.push('amount'); if (!parsed || !parsed.extractedUtr) m.push('UTR'); if (!parsed || !parsed.extractedReceiverUpi) m.push('receiver UPI'); if (!parsed || !parsed.extractedStatus) m.push('status'); return ocrConfidence < 60 && m.length === 1; })() },
    { line: 632, label: 'Manual review: ambiguous screenshot', condition: !!(parsed && parsed.ambiguous) },
    { line: 638, label: 'Manual review: medium fraud score', condition: fraudScore >= 30 && fraudScore < 60 },
    { line: 644, label: 'Manual review: low visual + good match', condition: visualScore < 50 && amountMatched && receiverMatched },
    { line: 649, label: 'Manual review: insufficient evidence (default)', condition: true },
  ];

  for (const d of DECISIONS) {
    const status = d.condition ? '◉ HIT' : '○ SKIP';
    console.log('  [' + status + '] api/_verificationEngine.js:' + d.line + ' — ' + d.label);
    if (d.condition) {
      if (d.line === 547) {
        console.log('    ↳ Reject because: receiverMatch=false');
        console.log('    ↳ Expected: ' + expectedUpiId);
        console.log('    ↳ OCR: ' + (parsed ? parsed.extractedReceiverUpi : 'NOT EXTRACTED'));
        console.log('    ↳ Similarity: ' + receiverSim + '%');
        console.log('    ↳ Decision: REJECTED');
      } else if (d.line === 553) {
        console.log('    ↳ Reject because: amount mismatch');
        console.log('    ↳ Expected: ₹' + amountNum);
        console.log('    ↳ OCR: ₹' + ocrAmount);
        console.log('    ↳ Difference: ₹' + Math.abs(ocrAmount - amountNum));
        console.log('    ↳ Decision: REJECTED');
      } else if (d.line === 562) {
        console.log('    ↳ Reject because: status=FAILED');
        console.log('    ↳ Decision: REJECTED');
      } else if (d.line === 568) {
        console.log('    ↳ Reject because: status=PENDING');
        console.log('    ↳ Decision: REJECTED');
      } else if (d.line === 574) {
        console.log('    ↳ Reject because: fraudScore=' + fraudScore + ' >= 60');
        console.log('    ↳ Decision: REJECTED');
      } else if (d.line === 581) {
        console.log('    ↳ Reject because: tamperingScore=' + tamperingScore + ' >= 70');
        console.log('    ↳ Decision: REJECTED');
      } else if (d.line === 587) {
        console.log('    ↳ Reject because: tampering=' + tamperingScore + ' >= 60 && fraudScore=' + fraudScore + ' >= 30');
        console.log('    ↳ Decision: REJECTED');
      } else if (d.line === 541) {
        console.log('    ↳ Reject because: duplicate UTR detected');
        console.log('    ↳ Decision: REJECTED');
      }
      break;
    }
  }

  // ── FULL DECISION SUMMARY ──
  sep('11. DECISION SUMMARY');
  for (const d of DECISIONS) {
    if (d.condition) {
      console.log('  DECISION: ' + d.label.replace(/^[^:]*:\s*/, ''));
      console.log('  TRIGGERED BY: api/_verificationEngine.js:' + d.line);
      console.log('');
      if (d.label.includes('approve')) console.log('  STATUS: APPROVED');
      else if (d.label.includes('reject')) console.log('  STATUS: REJECTED');
      else console.log('  STATUS: MANUAL_REVIEW');
      break;
    }
  }
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
