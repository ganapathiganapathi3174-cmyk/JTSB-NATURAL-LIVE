const https = require('https');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');
const { analyzeImageQuality } = require('./_imageQuality.js');
const { parseBankSmsOcr } = require('./_bankSmsParser.js');
const { runQuery } = require('./_supabase.js');
const { COL_UPI_PAYMENTS, ADMIN_UPI_ID } = require('./_shared.js');
const metrics = require('./_metrics.js');
const { broadcast } = require('./_sse.js');

let Tesseract = null;
try {
  Tesseract = require('tesseract.js');
} catch (e) {
  console.log('[BANK-SMS] Tesseract.js not available: ' + e.message);
}

const UTR_MIN_LENGTH = 10;
const UTR_MAX_LENGTH = 30;
const MIN_IMAGE_SIZE = 20000;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const ALLOWED_AMOUNTS = [120, 500, 1000];
const VERIFY_TIMEOUT_MS = 90000;
const FRAUD_SCORE_REJECT_THRESHOLD = 50;
const VERIFICATION_SCORE_APPROVE_THRESHOLD = 80;
const DEBUG_DIR = path.join(__dirname, '..', 'debug_ocr');
const MAX_OCR_STRATEGIES = 3;
const FRAUD_CACHE_TTL = 100;

const BANK_SMS_KEYWORDS = [
  'credited', 'debited', 'upi', 'ref', 'txn', 'trf', 'transfer',
  'account', 'a/c', 'ac/no', 'available balance', 'bal',
  'bank', 'sbi', 'hdfc', 'icici', 'axis', 'pnb', 'kotak',
  'yes bank', 'idfc', 'indusind', 'federal', 'rbl',
  'canara', 'union bank', 'bob', 'baroda', 'iob',
  'paytm', 'phonepe', 'gpay', 'google pay', 'amazon pay',
  'bhim', 'rupay', 'visa', 'mastercard',
];

const INDIAN_BANK_PATTERNS = [
  /(sbi|state\s*bank\s*of\s*india|hdfc|icici|axis|pnb|punjab\s*national\s*bank|kotak|yes\s*bank|idfc|indusind|federal|rbl|canara|union\s*bank|bank\s*of\s*baroda|bob|iob|indian\s*bank|uco\s*bank)/i,
  /(credited?\s*(?:to|in)\s*(?:your\s*)?(?:account|a\/c|savings|current)?)/i,
  /(debited?\s*(?:from|in)\s*(?:your\s*)?(?:account|a\/c))/i,
  /(upi\s*(?:ref|reference|transaction|trxn)?\s*:?\s*[a-z0-9]{10,})/i,
  /(available\s*(?:balance|bal|limit|amt))/i,
  /(ac\s*(?:no|number|\.)?\s*:?\s*\d{4,})/i,
];

function log(msg) {
  console.log('[' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '] [BANK-SMS] ' + msg);
}

function ensureDebugDir() {
  try { if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true }); } catch (_) {}
}

function saveDebugImage(buffer, name) {
  try {
    ensureDebugDir();
    const ts = Date.now();
    const f = path.join(DEBUG_DIR, ts + '_' + name + '.png');
    fs.writeFileSync(f, buffer);
    log('Saved debug image: ' + f);
    return f;
  } catch (e) { log('Debug save failed: ' + e.message); return null; }
}

function fetchBufferFromURL(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(url, { timeout: 15000 }, (res) => {
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

// ── Worker pool (2 workers for parallel OCR) ──
let workerPool = [];
let workerPoolSize = 0;
const POOL_SIZE = 2;
const WORKER_MAX_USES = 20;

async function initWorkerPool() {
  if (!Tesseract) return;
  const needed = POOL_SIZE - workerPool.length;
  for (let i = 0; i < needed; i++) {
    try {
      log('Creating worker ' + (workerPool.length + 1) + '/' + POOL_SIZE + '...');
      const w = await Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text' && m.progress) {
            if (Math.round(m.progress * 10) % 3 === 0) {
              log('OCR progress: ' + Math.round(m.progress * 100) + '%');
            }
          }
        },
      });
      await w.setParameters({
        tessedit_char_whitelist: '',
        preserve_interword_spaces: '1',
        tessedit_pageseg_mode: '3',
        textord_heavy_nr: '1',
        textord_min_linesize: '2.5',
      });
      workerPool.push({ worker: w, uses: 0 });
    } catch (e) {
      log('Worker creation failed: ' + e.message);
    }
  }
  workerPoolSize = workerPool.length;
}

function getWorkerFromPool() {
  if (workerPool.length === 0) return null;
  const entry = workerPool.reduce((a, b) => a.uses <= b.uses ? a : b);
  entry.uses++;
  if (entry.uses >= WORKER_MAX_USES) {
    entry.worker.terminate().catch(() => {});
    workerPool = workerPool.filter(e => e !== entry);
    workerPoolSize = workerPool.length;
    initWorkerPool();
  }
  return entry.worker;
}

async function runTesseractOCR(imageBuffer) {
  const worker = getWorkerFromPool();
  if (!worker) {
    await initWorkerPool();
    const w = getWorkerFromPool();
    if (!w) return { text: '', words: [], confidence: 0, wordConf: 0, topConf: 0 };
  }
  const { data } = await worker.recognize(imageBuffer);
  const text = data.text || '';
  const words = data.words || [];
  const wordConf = words.length > 0
    ? Math.round((words.reduce((s, w) => s + (w.confidence || 0), 0) / words.length) * 100) / 100
    : 0;
  const topConf = data.confidence !== undefined ? data.confidence : 0;
  const effectiveConf = wordConf > 0 ? wordConf : topConf;
  log('Tesseract: ' + text.length + ' chars, wordConf=' + wordConf + '%, topConf=' + topConf + '%, effectiveConf=' + effectiveConf + '%');
  return { text, words, confidence: effectiveConf, wordConf, topConf };
}

async function shutdownWorker() {
  for (const entry of workerPool) {
    try { await entry.worker.terminate(); } catch (_) {}
  }
  workerPool = [];
  workerPoolSize = 0;
}

function preprocessForOcr(rawBuf) {
  return Jimp.read(rawBuf).then(img => {
    const maxDim = 2400;
    if (img.bitmap.width > maxDim || img.bitmap.height > maxDim) {
      if (img.bitmap.width > img.bitmap.height) {
        img.resize(maxDim, Jimp.AUTO);
      } else {
        img.resize(Jimp.AUTO, maxDim);
      }
    }
    return img.getBuffer('image/png');
  }).catch(() => rawBuf);
}

// ── Simplified strategies — only 3 runs max ──
const STRATEGIES = [
  { name: 'original', fn: async (buf) => buf },
  { name: 'grayscale', fn: async (buf) => {
    const img = await Jimp.read(buf);
    img.greyscale();
    return img.getBuffer('image/png');
  }},
  { name: 'upscale_2x', fn: async (buf) => {
    const img = await Jimp.read(buf);
    img.greyscale();
    img.contrast(0.35);
    if (img.bitmap.width < 2000) {
      img.resize(img.bitmap.width * 2, Jimp.AUTO);
    }
    return img.getBuffer('image/png');
  }},
];

async function ocrWithRetry(rawBuf, orderId) {
  log('Running OCR with up to ' + Math.min(STRATEGIES.length, MAX_OCR_STRATEGIES) + ' strategies...');
  saveDebugImage(rawBuf, orderId + '_original');

  const resizedBuf = await preprocessForOcr(rawBuf);

  let bestResult = { text: '', confidence: 0, strategy: 'none' };
  const results = [];
  const usedStrategies = STRATEGIES.slice(0, MAX_OCR_STRATEGIES);

  // Run all strategies in parallel (each uses a different worker from pool)
  const parallelResults = await Promise.all(usedStrategies.map(async (strategy) => {
    try {
      log('Strategy: ' + strategy.name + '...');
      const processedBuf = await strategy.fn(resizedBuf);
      if (strategy.name !== 'original') {
        saveDebugImage(processedBuf, orderId + '_' + strategy.name);
      }
      const data = await runTesseractOCR(processedBuf);
      const ocrText = data.text || '';
      const effectiveConf = data.confidence || 0;
      log('  ' + strategy.name + ': ' + ocrText.length + ' chars @ ' + effectiveConf + '% (wordConf=' + (data.wordConf || 0) + '%, topConf=' + (data.topConf || 0) + '%)');
      return { strategy: strategy.name, text: ocrText, confidence: effectiveConf };
    } catch (e) {
      log('  ' + strategy.name + ' failed: ' + e.message);
      return null;
    }
  }));

  for (const r of parallelResults) {
    if (!r) continue;
    results.push(r);
    if (r.confidence > bestResult.confidence || (r.confidence === bestResult.confidence && r.text.length > bestResult.text.length)) {
      bestResult = r;
    }
  }

  log('Best strategy: ' + bestResult.strategy + ' (' + bestResult.confidence + '%, ' + bestResult.text.length + ' chars)');
  log('All OCR results: ' + JSON.stringify(results.map(r => r.strategy + '=' + r.confidence + '%/' + r.text.length + 'c')));

  return bestResult;
}

function exactAmountMatch(ocrAmount, expectedAmount) {
  if (ocrAmount === null || ocrAmount === undefined) return false;
  return Math.abs(Number(ocrAmount) - Number(expectedAmount)) < 0.01;
}

function validateUtr(utr) {
  if (!utr || typeof utr !== 'string') return false;
  const clean = utr.replace(/\s+/g, '').trim().toUpperCase();
  if (clean.length < UTR_MIN_LENGTH || clean.length > UTR_MAX_LENGTH) return false;
  if (!/^[A-Z0-9]+$/.test(clean)) return false;
  return clean;
}

function detectBankSmsText(text) {
  if (!text || text.length < 20) return { isBankSms: false, score: 0, matchedKeywords: 0, matchedPatterns: 0 };
  const upper = text.toUpperCase();
  const matchedKeywords = BANK_SMS_KEYWORDS.filter(kw => upper.includes(kw.toUpperCase()));
  const matchedPatterns = INDIAN_BANK_PATTERNS.filter(p => p.test(text));
  const score = (matchedKeywords.length * 5) + (matchedPatterns.length * 20);
  return { isBankSms: score >= 20, score, matchedKeywords: matchedKeywords.length, matchedPatterns: matchedPatterns.length };
}

function computeImageHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function computeTextHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function isToday(dateStr) {
  if (!dateStr) return false;
  try {
    const parsed = new Date(dateStr);
    if (isNaN(parsed.getTime())) return false;
    const now = new Date();
    return parsed.getFullYear() === now.getFullYear() &&
           parsed.getMonth() === now.getMonth() &&
           parsed.getDate() === now.getDate();
  } catch { return false; }
}

function isAfterOrderCreation(timeStr, orderCreatedAt) {
  if (!timeStr || !orderCreatedAt) return true;
  try {
    const parts = timeStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM|am|pm))?/);
    if (!parts) return true;
    let hour = parseInt(parts[1]);
    const minute = parseInt(parts[2]);
    const ampm = parts[4] ? parts[4].toUpperCase() : null;
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour >= 12) hour = 0;
    const orderTime = new Date(orderCreatedAt).getTime();
    const smsTime = new Date(
      new Date().getFullYear(), new Date().getMonth(), new Date().getDate(),
      hour, minute
    ).getTime();
    return smsTime >= orderTime;
  } catch { return true; }
}

function isBeforeOrderExpiry(timeStr, orderExpiresAt) {
  if (!timeStr || !orderExpiresAt) return true;
  try {
    const parts = timeStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM|am|pm))?/);
    if (!parts) return true;
    let hour = parseInt(parts[1]);
    const minute = parseInt(parts[2]);
    const ampm = parts[4] ? parts[4].toUpperCase() : null;
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour >= 12) hour = 0;
    const expiryTime = new Date(orderExpiresAt).getTime();
    const smsTime = new Date(
      new Date().getFullYear(), new Date().getMonth(), new Date().getDate(),
      hour, minute
    ).getTime();
    return smsTime <= expiryTime;
  } catch { return true; }
}

function receiverDetailsMatch(extractedReceiver, expectedUpi) {
  if (!extractedReceiver) return { matched: true, available: false };
  const cleanExtracted = extractedReceiver.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9@]/g, '');
  const expectedHandle = expectedUpi.split('@')[0].toLowerCase();
  const cleanExpected = expectedHandle.toLowerCase();

  if (cleanExtracted === expectedUpi.toLowerCase().replace(/\s+/g, '')) {
    return { matched: true, available: true };
  }
  if (cleanExtracted.includes(cleanExpected) || cleanExpected.includes(cleanExtracted)) {
    return { matched: true, available: true };
  }

  if (/^\d{4,}$/.test(cleanExtracted.replace(/[^0-9]/g, '')) && cleanExtracted.length <= 8) {
    return { matched: true, available: false };
  }

  if (!cleanExtracted.includes('@')) {
    return { matched: true, available: false };
  }

  return { matched: false, available: true };
}

// ── In-memory fraud cache (100ms TTL) ──
let fraudCache = null;
let fraudCacheTime = 0;

async function fetchPaymentsCached() {
  if (fraudCache && (Date.now() - fraudCacheTime) < FRAUD_CACHE_TTL) {
    return fraudCache;
  }
  const payments = await runQuery(COL_UPI_PAYMENTS, [], { limit: 2000 });
  fraudCache = payments;
  fraudCacheTime = Date.now();
  return payments;
}

async function checkFraud(imageHash, utr, ocrText, userId, excludeOrderId) {
  const fraudFlags = [];
  let fraudScore = 0;
  try {
    const payments = await fetchPaymentsCached();
    const cleanUtr = utr ? utr.toUpperCase().trim() : '';
    const textHash = ocrText ? computeTextHash(ocrText) : '';
    for (const p of payments) {
      if (p.id === excludeOrderId) continue;
      if (cleanUtr && p.utr && p.utr.toUpperCase().trim() === cleanUtr && p.status !== 'rejected') {
        fraudFlags.push('duplicate_utr');
        fraudScore += 35;
      }
      if (imageHash && p.screenshot_hash === imageHash) {
        fraudFlags.push('duplicate_screenshot');
        fraudScore += 30;
      }
      if (cleanUtr && p.utr && p.utr.toUpperCase().trim() === cleanUtr && userId && p.user_id && p.user_id !== userId) {
        fraudFlags.push('different_user_same_utr');
        fraudScore += 25;
      }
      if (textHash && p.ocr_text_hash === textHash && p.status !== 'rejected') {
        fraudFlags.push('duplicate_ocr_text');
        fraudScore += 20;
      }
      const pOcrResult = p.ocr_result || {};
      const pText = (pOcrResult.rawText || pOcrResult.ocrText || '');
      if (textHash && pText && computeTextHash(pText) === textHash && p.status !== 'rejected' && p.id !== excludeOrderId) {
        if (!fraudFlags.includes('duplicate_ocr_text')) {
          fraudFlags.push('duplicate_ocr_text');
          fraudScore += 15;
        }
      }
      if (imageHash && p.screenshot_hash === imageHash && userId && p.user_id && p.user_id !== userId) {
        fraudFlags.push('different_user_same_screenshot');
        fraudScore += 20;
      }
    }
  } catch (e) {
    log('Fraud check error: ' + e.message);
  }
  fraudScore = Math.min(fraudScore, 100);
  return { fraudScore, fraudFlags: [...new Set(fraudFlags)] };
}

function emitProgress(orderId, phase, pct) {
  try { broadcast('verificationProgress', { orderId, phase, percent: pct }); } catch {}
}

async function runBankSmsVerification(order, screenshotUrl, userId, userEnteredUtr) {
  const T = { start: Date.now(), imageLoad: 0, preprocess: 0, ocr: 0, parser: 0, fraud: 0, db: 0, decision: 0 };
  function stageTiming(stage) {
    const elapsed = Date.now() - T.start;
    log('[TIMING] ' + stage + ' at +' + elapsed + 'ms');
    if (elapsed > 3000 && !stage.includes('Total')) {
      log('[BOTTLENECK] ⚠️ Stage "' + stage + '" at +' + elapsed + 'ms exceeds 3s threshold');
    }
    return elapsed;
  }
  function printTimingsTable() {
    const stages = [
      ['Image Load', T.imageLoad],
      ['Image Processing', T.preprocess],
      ['OCR', T.ocr],
      ['Field Parsing', T.parser],
      ['Fraud Detection', T.fraud],
      ['Database', T.db],
      ['Decision', T.decision],
    ];
    log('=== TIMING TABLE ===');
    for (const [name, ms] of stages) {
      const flag = ms > 3000 ? ' ⚠️ BOTTLENECK (>3s)' : '';
      log('  ' + name + ': ' + ms + 'ms' + flag);
    }
    log('  Total: ' + (Date.now() - T.start) + 'ms');
    log('===================');
  }

  const expectedAmount = Number(order.amount) || 0;
  const expectedUpi = order.expected_upi_id || ADMIN_UPI_ID;
  const orderId = order.id;
  const type = order.type || 'unknown';
  const orderCreatedAt = order.created_at || '';
  const orderExpiresAt = order.expires_at || '';

  log('=== Bank SMS Verification for ' + orderId + ' ===');
  log('Type=' + type + ', Amount=' + expectedAmount + ', ExpectedUPI=' + expectedUpi + ', UserEnteredUTR=' + (userEnteredUtr || 'not provided'));
  stageTiming('Request Received');

  const result = {
    status: 'rejected',
    verificationScore: 0,
    verificationDuration: 0,
    autoVerified: false,
    manualReviewRequired: true,
    reasons: [],
    checks: [],
    ocrData: null,
    imageQuality: null,
    matchedAmount: false,
    matchedReceiver: false,
    matchedUtr: false,
    matchedDate: false,
    matchedStatus: false,
    fraudScore: 0,
    fraudFlags: [],
    duplicateUtrDetected: false,
    screenshotHash: '',
    textHash: '',
    bankSmsDetected: false,
    bankSmsScore: 0,
    userEnteredUtr: userEnteredUtr || null,
    userUtrMatched: false,
    allowedAmounts: ALLOWED_AMOUNTS,
    debug: { ocrResults: [] },
    timings: {},
  };

  try {
    // STEP 0: ORDER VALIDATION
    if (!expectedAmount || !ALLOWED_AMOUNTS.includes(expectedAmount)) {
      result.reasons.push('Invalid amount: ' + expectedAmount + '. Allowed: ' + ALLOWED_AMOUNTS.join(', '));
      result.verificationDuration = Date.now() - T.start;
      stageTiming('Response Sent (invalid amount)');
      return result;
    }

    if (!screenshotUrl) {
      result.reasons.push('No screenshot provided');
      result.verificationDuration = Date.now() - T.start;
      stageTiming('Response Sent (no screenshot)');
      return result;
    }
    stageTiming('Order Validation');

    emitProgress(orderId, 'fetching', 5);

    // STEP 1: FETCH & BASIC VALIDATION
    log('Fetching screenshot...');
    let rawBuf;
    try {
      const t0 = Date.now();
      rawBuf = await fetchBufferFromURL(screenshotUrl);
      T.imageLoad = Date.now() - t0;
      log('Fetched ' + rawBuf.length + ' bytes in ' + T.imageLoad + 'ms');
      stageTiming('Image Load');
    } catch (e) {
      result.reasons.push('Could not fetch screenshot: ' + e.message);
      result.verificationDuration = Date.now() - T.start;
      return result;
    }

    if (rawBuf.length < MIN_IMAGE_SIZE) {
      result.reasons.push('Screenshot too small (' + rawBuf.length + ' bytes)');
      result.verificationDuration = Date.now() - T.start;
      return result;
    }
    if (rawBuf.length > MAX_IMAGE_SIZE) {
      result.reasons.push('Screenshot too large (' + (rawBuf.length / 1024 / 1024).toFixed(1) + 'MB)');
      result.verificationDuration = Date.now() - T.start;
      return result;
    }

    const imageHash = computeImageHash(rawBuf);
    result.screenshotHash = imageHash;
    log('Screenshot hash=' + imageHash.substring(0, 12));

    // Initialize worker pool (await to ensure workers are ready before OCR starts)
    if (workerPool.length === 0) {
      const tInit = Date.now();
      await initWorkerPool();
      log('Worker pool initialized in ' + (Date.now() - tInit) + 'ms, pool size=' + workerPool.length);
    }

    // STEP 2: RUN OCR + IMAGE QUALITY + FRAUD DB QUERY IN PARALLEL
    emitProgress(orderId, 'preprocessing', 10);

    const tPre = Date.now();
    const resizedBuf = await preprocessForOcr(rawBuf);
    T.preprocess = Date.now() - tPre;
    stageTiming('Image Processing');

    emitProgress(orderId, 'ocr', 20);

    if (!Tesseract) {
      result.reasons.push('OCR engine not available');
      result.verificationDuration = Date.now() - T.start;
      return result;
    }

    // Run OCR, image quality analysis, and fraud DB query in parallel
    const tOcr = Date.now();
    const [ocrResult, imageQuality, fraudPreQuery] = await Promise.all([
      ocrWithRetry(rawBuf, orderId),
      analyzeImageQuality(rawBuf).catch(() => ({
        passed: true, overallGrade: 'unknown', issues: [], warnings: [],
        blurScore: 0, cropRatio: 1.0, lowResolution: false, darkScore: 0,
        glareScore: 0, compressionScore: 0, dimensions: { width: 0, height: 0 },
      })),
      fetchPaymentsCached().then(() => true).catch(() => false),
    ]);
    T.ocr = Date.now() - tOcr;
    stageTiming('OCR');

    result.debug.ocrResults = ocrResult;

    const ocrText = ocrResult.text || '';
    const avgConfidence = ocrResult.confidence || 0;
    log('OCR output [' + ocrResult.strategy + ']: "' + ocrText.substring(0, 200) + '"');
    log('OCR confidence: ' + avgConfidence + '%');

    const textHash = computeTextHash(ocrText);
    result.textHash = textHash;

    result.checks.push({ name: 'ocr_completed', passed: ocrText.trim().length >= 10, charCount: ocrText.length, confidence: avgConfidence, strategy: ocrResult.strategy });

    // STEP 2B: IMAGE QUALITY (non-rejecting)
    result.imageQuality = imageQuality;
    result.checks.push({ name: 'image_quality', passed: imageQuality.passed, grade: imageQuality.overallGrade, issues: imageQuality.issues, blurScore: imageQuality.blurScore, cropRatio: imageQuality.cropRatio });
    if (!imageQuality.passed) log('Image quality warnings: ' + imageQuality.issues.join(', '));
    if (imageQuality.blurScore > 70) log('Blur detected (score=' + imageQuality.blurScore + ')');
    if (imageQuality.cropRatio < 0.5) log('Crop ratio low: ' + imageQuality.cropRatio);
    if (imageQuality.darkScore > 80) log('Dark image (score=' + imageQuality.darkScore + ')');

    // STEP 3: OCR CONFIDENCE LEVEL DECISION
    emitProgress(orderId, 'parsing', 50);
    let ocrLevel;
    if (avgConfidence < 30) {
      ocrLevel = 'poor';
      log('OCR confidence poor (<30%)');
    } else if (avgConfidence < 60) {
      ocrLevel = 'fair';
      log('OCR confidence fair (30-60%)');
    } else {
      ocrLevel = 'good';
      log('OCR confidence good (>60%)');
    }

    if (ocrLevel === 'poor' || ocrText.trim().length < 10) {
      result.reasons.push('OCR confidence too low: ' + avgConfidence + '%');
      result.verificationDuration = Date.now() - T.start;
      log('Aborting — OCR confidence too low');
      return result;
    }

    // STEP 4: BANK SMS DETECTION
    log('Detecting bank SMS format...');
    const bankSms = detectBankSmsText(ocrText);
    result.bankSmsDetected = bankSms.isBankSms;
    result.bankSmsScore = bankSms.score;
    result.checks.push({ name: 'bank_sms_detected', passed: bankSms.isBankSms, score: bankSms.score, keywords: bankSms.matchedKeywords, patterns: bankSms.matchedPatterns });

    if (!bankSms.isBankSms) {
      result.reasons.push('Not a valid bank SMS screenshot (score=' + bankSms.score + ')');
    }

    // STEP 5: PARSE OCR TEXT
    const tParse = Date.now();
    const parsed = parseBankSmsOcr(ocrText);
    T.parser = Date.now() - tParse;

    log('Parsed fields:');
    log('  Amount=' + parsed.extractedAmount);
    log('  UTR=' + parsed.extractedUtr);
    log('  TxnRef=' + parsed.extractedTransactionRef);
    log('  SenderVPA=' + parsed.extractedSenderVpa);
    log('  ReceiverName=' + parsed.extractedReceiverName);
    log('  ReceiverAccount=' + parsed.extractedReceiverAccount);
    log('  Bank=' + parsed.extractedBankName);
    log('  Date=' + parsed.extractedDate);
    log('  Time=' + parsed.extractedTime);
    log('  Status=' + parsed.extractedPaymentStatus);
    log('  Parser confidence=' + parsed.confidence + '%, fieldCount=' + parsed.fieldCount);
    stageTiming('Field Parsing');

    const ocrData = {
      rawText: parsed.rawText || ocrText,
      extractedAmount: parsed.extractedAmount,
      extractedUtr: parsed.extractedUtr,
      extractedTransactionRef: parsed.extractedTransactionRef,
      extractedSenderVpa: parsed.extractedSenderVpa,
      extractedReceiverName: parsed.extractedReceiverName,
      extractedReceiverAccount: parsed.extractedReceiverAccount,
      extractedBankName: parsed.extractedBankName || parsed.extractedAppName,
      extractedDate: parsed.extractedDate,
      extractedTime: parsed.extractedTime,
      extractedPaymentStatus: parsed.extractedPaymentStatus,
      confidence: parsed.confidence || avgConfidence,
      wordCount: parsed.wordCount,
      fieldCount: parsed.fieldCount,
    };
    result.ocrData = ocrData;

    // STEP 6: AMOUNT MATCH
    const amountMatch = exactAmountMatch(ocrData.extractedAmount, expectedAmount);
    result.matchedAmount = amountMatch;
    result.checks.push({ name: 'amount_match', passed: amountMatch, extracted: ocrData.extractedAmount, expected: expectedAmount });
    if (!amountMatch) log('Amount mismatch: found=' + ocrData.extractedAmount + ', expected=' + expectedAmount);

    // STEP 7: UTR VALIDATION
    const validUtr = validateUtr(ocrData.extractedUtr);
    result.matchedUtr = !!validUtr;
    result.checks.push({ name: 'utr_validation', passed: !!validUtr, extracted: ocrData.extractedUtr });
    if (!validUtr) log('Invalid UTR: ' + ocrData.extractedUtr);

    // STEP 7B: USER-ENTERED UTR vs OCR UTR MATCH
    let userUtrMatch = false;
    let userUtrReason = '';
    if (!userEnteredUtr || !userEnteredUtr.trim()) {
      userUtrReason = 'No UTR entered by user';
      log('User-entered UTR: MISSING');
    } else if (!validUtr) {
      userUtrReason = 'OCR could not extract a valid UTR from the SMS';
      log('User-entered UTR: ' + userEnteredUtr + ' but OCR UTR is invalid');
    } else {
      const cleanedUserUtr = userEnteredUtr.trim().toUpperCase().replace(/\s+/g, '');
      const cleanedOcrUtr = validUtr.toUpperCase().replace(/\s+/g, '');
      userUtrMatch = cleanedUserUtr === cleanedOcrUtr;
      if (userUtrMatch) {
        log('User-entered UTR MATCHES OCR UTR: ' + cleanedUserUtr);
      } else {
        userUtrReason = 'Entered UTR does not match the SMS. Entered: ' + cleanedUserUtr + ', OCR: ' + cleanedOcrUtr;
        log('User-entered UTR MISMATCH: entered=' + cleanedUserUtr + ', ocr=' + cleanedOcrUtr);
      }
    }
    result.userUtrMatched = userUtrMatch;
    result.checks.push({ name: 'user_utr_match', passed: userUtrMatch, entered: userEnteredUtr || '', extracted: validUtr || '' });
    if (!userUtrMatch && userUtrReason) {
      result.reasons.push(userUtrReason);
    }

    emitProgress(orderId, 'checking', 65);

    // STEP 8: UTR DUPLICATE CHECK (runs inline — fraud cache already loaded)
    const tDb = Date.now();
    let utrDuplicate = { isDuplicate: false };
    if (validUtr) {
      utrDuplicate = await checkDuplicateUtr(validUtr, orderId);
    }
    T.db = Date.now() - tDb;
    stageTiming('Database');
    result.duplicateUtrDetected = utrDuplicate.isDuplicate;
    result.checks.push({ name: 'utr_duplicate', passed: !utrDuplicate.isDuplicate, isDuplicate: utrDuplicate.isDuplicate });
    if (utrDuplicate.isDuplicate) log('Duplicate UTR: ' + validUtr);

    // STEP 9: DATE VALIDATION
    const dateValid = isToday(ocrData.extractedDate);
    result.matchedDate = dateValid;
    result.checks.push({ name: 'date_validation', passed: dateValid, extracted: ocrData.extractedDate });
    if (!dateValid) log('Date not today: ' + ocrData.extractedDate);

    // STEP 10: TIME VALIDATION
    const timeAfterCreation = isAfterOrderCreation(ocrData.extractedTime, orderCreatedAt);
    const timeBeforeExpiry = isBeforeOrderExpiry(ocrData.extractedTime, orderExpiresAt);
    const timeValid = timeAfterCreation && timeBeforeExpiry;
    result.checks.push({ name: 'time_validation', passed: timeValid, afterCreation: timeAfterCreation, beforeExpiry: timeBeforeExpiry });

    // STEP 11: RECEIVER VALIDATION
    let receiverCheck = { matched: true, available: false };
    const hasReceiverDetails = !!(ocrData.extractedReceiverName || ocrData.extractedReceiverAccount);
    if (hasReceiverDetails) {
      const checkName = ocrData.extractedReceiverName ? receiverDetailsMatch(ocrData.extractedReceiverName, expectedUpi) : null;
      const checkAccount = ocrData.extractedReceiverAccount ? receiverDetailsMatch(ocrData.extractedReceiverAccount, expectedUpi) : null;

      if (checkName && checkName.matched && checkName.available) {
        receiverCheck = checkName;
      } else if (checkAccount && checkAccount.matched && checkAccount.available) {
        receiverCheck = checkAccount;
      } else if (checkName && checkName.available && !checkName.matched) {
        const isUpiHandle = (ocrData.extractedReceiverName || '').includes('@');
        if (isUpiHandle) {
          receiverCheck = { matched: false, available: true };
          log('Receiver UPI handle mismatch: ' + ocrData.extractedReceiverName + ' != ' + expectedUpi);
        } else {
          receiverCheck = { matched: true, available: false };
          log('Receiver name present but not a UPI handle (merchant/bank name), skipping: ' + ocrData.extractedReceiverName);
        }
      } else {
        receiverCheck = { matched: true, available: false };
        log('Receiver details present but not actionable (account number / generic), skipping');
      }
    }

    result.matchedReceiver = receiverCheck.matched;
    result.checks.push({ name: 'receiver_validation', passed: receiverCheck.matched, available: receiverCheck.available, hasReceiverDetails });

    if (hasReceiverDetails && !receiverCheck.matched && receiverCheck.available) {
      result.reasons.push('Receiver details mismatch');
      log('Receiver MISMATCH: name=' + ocrData.extractedReceiverName + ', account=' + ocrData.extractedReceiverAccount + ', expected=' + expectedUpi);
    } else {
      log('Receiver validation: ' + (hasReceiverDetails ? 'passed/skipped' : 'skipped (no details in SMS)'));
    }

    emitProgress(orderId, 'fraud', 80);

    // STEP 12: FRAUD DETECTION
    const tFraud = Date.now();
    const fraud = await checkFraud(imageHash, validUtr, ocrText, userId, orderId);
    T.fraud = Date.now() - tFraud;
    stageTiming('Fraud Detection');
    result.fraudScore = fraud.fraudScore;
    result.fraudFlags = fraud.fraudFlags;
    result.checks.push({ name: 'fraud_detection', passed: fraud.fraudScore < FRAUD_SCORE_REJECT_THRESHOLD, fraudScore: fraud.fraudScore, flags: fraud.fraudFlags });
    if (fraud.fraudScore >= FRAUD_SCORE_REJECT_THRESHOLD) {
      log('Fraud detected: ' + fraud.fraudFlags.join(', ') + ' (score=' + fraud.fraudScore + ')');
    }

    emitProgress(orderId, 'scoring', 90);

    // STEP 13: SCORING
    const tDecision = Date.now();
    let verificationScore = 0;
    let totalWeight = 0;
    let earnedWeight = 0;

    const scoreWeights = [
      { pass: ocrLevel !== 'poor', weight: 10, label: 'ocr_level' },
      { pass: amountMatch, weight: 20, label: 'amount_match' },
      { pass: userUtrMatch, weight: 20, label: 'user_utr_match' },
      { pass: !!validUtr, weight: 10, label: 'utr_valid' },
      { pass: !utrDuplicate.isDuplicate, weight: 10, label: 'utr_unique' },
      { pass: dateValid, weight: 10, label: 'date_valid' },
      { pass: bankSms.isBankSms, weight: 10, label: 'bank_sms' },
      { pass: fraud.fraudScore < FRAUD_SCORE_REJECT_THRESHOLD, weight: 10, label: 'fraud_clean' },
      { pass: !hasReceiverDetails || receiverCheck.matched, weight: 5, label: 'receiver' },
    ];

    for (const sw of scoreWeights) {
      totalWeight += sw.weight;
      if (sw.pass) earnedWeight += sw.weight;
      log('  Score: ' + sw.label + '=' + (sw.pass ? sw.weight : 0) + '/' + sw.weight + (sw.pass ? ' ✓' : ' ✗'));
    }

    verificationScore = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0;
    result.verificationScore = verificationScore;
    log('Scoring: ' + earnedWeight + '/' + totalWeight + ' = ' + verificationScore + '%');

    // STEP 14: DECISION
    const rejectSignals = [];
    if (!amountMatch) rejectSignals.push('amount_mismatch');
    if (!validUtr) rejectSignals.push('invalid_utr');
    if (!userUtrMatch && userEnteredUtr && userEnteredUtr.trim()) rejectSignals.push('utr_mismatch');
    if (utrDuplicate.isDuplicate) rejectSignals.push('duplicate_utr');
    if (!bankSms.isBankSms) rejectSignals.push('invalid_bank_sms');
    if (!imageQuality.passed) {
      rejectSignals.push('image_quality_failed');
      if (!result.reasons.includes('Invalid screenshot')) result.reasons.push('Invalid screenshot: ' + (imageQuality.issues || []).join(', '));
    }
    if (fraud.fraudScore >= FRAUD_SCORE_REJECT_THRESHOLD) rejectSignals.push('fraud_detected');
    if (hasReceiverDetails && !receiverCheck.matched && receiverCheck.available) rejectSignals.push('receiver_mismatch');
    if (verifyTimeoutExceeded(T.start)) rejectSignals.push('timeout');

    let finalStatus;
    let autoVerified = false;

    if (rejectSignals.length > 0) {
      finalStatus = 'rejected';
      autoVerified = true;
      result.manualReviewRequired = false;
      log('DECISION: REJECTED — ' + rejectSignals.join(', '));
    } else if (ocrLevel === 'fair' && verificationScore >= VERIFICATION_SCORE_APPROVE_THRESHOLD) {
      finalStatus = 'pending_review';
      autoVerified = false;
      result.manualReviewRequired = true;
      result.reasons = ['Low OCR confidence (' + avgConfidence + '%), flagged for manual review'];
      log('DECISION: PENDING REVIEW — fair OCR, score=' + verificationScore);
    } else if (verificationScore >= VERIFICATION_SCORE_APPROVE_THRESHOLD) {
      finalStatus = 'verified';
      autoVerified = true;
      result.manualReviewRequired = false;
      result.reasons = ['All verification checks passed'];
      log('DECISION: VERIFIED — score=' + verificationScore);
    } else {
      finalStatus = 'pending_review';
      autoVerified = false;
      result.manualReviewRequired = true;
      log('DECISION: PENDING REVIEW — score=' + verificationScore + ' < ' + VERIFICATION_SCORE_APPROVE_THRESHOLD);
    }

    T.decision = Date.now() - tDecision;

    printTimingsTable();
    stageTiming('Response Sent');
    // Check for any stage exceeding 3 seconds
    const stageThreshold = 3000;
    const timingEntries = { imageLoad: T.imageLoad, preprocess: T.preprocess, ocr: T.ocr, parser: T.parser, fraud: T.fraud, db: T.db, decision: T.decision };
    for (const [stage, ms] of Object.entries(timingEntries)) {
      if (ms > stageThreshold) {
        log('[BOTTLENECK] ⚠️ Stage "' + stage + '" took ' + ms + 'ms (exceeds ' + stageThreshold + 'ms threshold)');
      }
    }

    result.status = finalStatus;
    result.autoVerified = autoVerified;
    result.verificationDuration = Date.now() - T.start;
    result.timings = {
      imageLoad: T.imageLoad,
      preprocess: T.preprocess,
      ocr: T.ocr,
      parser: T.parser,
      fraud: T.fraud,
      db: T.db,
      decision: T.decision,
      total: result.verificationDuration,
    };
    metrics.trackOCR(autoVerified);

    emitProgress(orderId, 'complete', 100);

    log('');
    log('=== TIMING ===');
    log('Image Load: ' + T.imageLoad + ' ms');
    log('Preprocessing: ' + T.preprocess + ' ms');
    log('OCR: ' + T.ocr + ' ms');
    log('Parser: ' + T.parser + ' ms');
    log('Fraud Detection: ' + T.fraud + ' ms');
    log('Database: ' + T.db + ' ms');
    log('Decision: ' + T.decision + ' ms');
    log('Total: ' + result.verificationDuration + ' ms');
    log('');
    log('=== VERIFICATION SUMMARY for ' + orderId + ' ===');
    log('  OCR:    strategy=' + ocrResult.strategy + ', text=' + ocrText.length + ' chars, conf=' + avgConfidence + '%, level=' + ocrLevel);
    log('  Parse:  amount=' + ocrData.extractedAmount + ', utr=' + ocrData.extractedUtr + ', bank=' + ocrData.extractedBankName + ', date=' + ocrData.extractedDate + ', status=' + ocrData.extractedPaymentStatus);
    log('  User:   enteredUtr=' + (userEnteredUtr || 'none') + ' matched=' + userUtrMatch);
    log('  Checks: amount=' + amountMatch + ' utr=' + !!validUtr + ' utrMatch=' + userUtrMatch + ' date=' + dateValid + ' receiver=' + receiverCheck.matched + ' fraud=' + fraud.fraudScore + ' bankSms=' + bankSms.isBankSms + ' imgQuality=' + imageQuality.overallGrade);
    log('  Score:  ' + earnedWeight + '/' + totalWeight + ' = ' + verificationScore + '%');
    log('  Signals: ' + JSON.stringify(rejectSignals));
    log('  Result: ' + finalStatus + ' | autoVerified=' + autoVerified + ' | manualReview=' + result.manualReviewRequired + ' | duration=' + result.verificationDuration + 'ms');
    log('  Reasons: ' + JSON.stringify(result.reasons));
    log('=== END ===');

  } catch (e) {
    log('Fatal error: ' + e.message);
    log('Stack: ' + e.stack);
    result.status = 'rejected';
    result.reasons = ['Verification error: ' + e.message];
    result.manualReviewRequired = true;
    result.verificationDuration = Date.now() - T.start;
  }

  return result;
}

function verifyTimeoutExceeded(startTime) {
  return (Date.now() - startTime) > VERIFY_TIMEOUT_MS;
}

async function checkDuplicateUtr(utr, excludeOrderId) {
  if (!utr) return { isDuplicate: false };
  try {
    const cleanUtr = utr.toUpperCase().trim();
    const payments = await fetchPaymentsCached();
    const dup = payments.find(p =>
      p.utr && p.utr.toUpperCase().trim() === cleanUtr &&
      p.status !== 'rejected' &&
      p.id !== excludeOrderId
    );
    if (dup) return { isDuplicate: true, existingPayment: dup.id, existingUser: dup.user_id };
    return { isDuplicate: false };
  } catch (e) {
    log('Duplicate UTR check error: ' + e.message);
    return { isDuplicate: false, error: e.message };
  }
}

module.exports = { runBankSmsVerification, VERIFY_TIMEOUT_MS, shutdownWorker, initWorkerPool, ALLOWED_AMOUNTS, ADMIN_UPI_ID };
