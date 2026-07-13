const https = require('https');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const { Jimp } = require('jimp');
const { analyzeImageQuality } = require('./_imageQuality.js');
const { parseBankSmsOcr } = require('./_bankSmsParser.js');
const { runQuery } = require('./_supabase.js');
const { COL_UPI_PAYMENTS, ADMIN_UPI_ID, ADMIN_ACCOUNT_MASK } = require('./_shared.js');
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
const MIN_OCR_CONFIDENCE = 80;
const MIN_BANK_SMS_SCORE = 30;
const MAX_SESSION_AGE_MINUTES = 60;
const DEBUG_DIR = path.join(__dirname, '..', 'debug_ocr');
const MAX_OCR_STRATEGIES = 3;
const FRAUD_CACHE_TTL = 100;
const OCR_STRATEGY_TIMEOUT_MS = 20000;
const OCR_WATCHDOG_TIMEOUT_MS = 25000;
const EXPECTED_RECEIVER_UPI = ADMIN_UPI_ID.toLowerCase();
const ACCEPTED_PAYMENT_STATUSES = ['SUCCESS', 'SUCCESSFUL', 'CREDITED', 'PAID'];
const REJECTED_PAYMENT_STATUSES = ['FAILED', 'DECLINED', 'PENDING', 'PROCESSING', 'TIMEOUT', 'CANCELLED'];
const APPROVED_STATUS = 'verified';
const REJECTED_STATUS = 'rejected';

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

async function saveDebugImage(buffer, name) {
  try {
    ensureDebugDir();
    const ts = Date.now();
    const f = path.join(DEBUG_DIR, ts + '_' + name + '.png');
    await fsPromises.writeFile(f, buffer);
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
  if (workerPool.length === 0) return { worker: null, needsReplace: false };
  const entry = workerPool.reduce((a, b) => a.uses <= b.uses ? a : b);
  entry.uses++;
  const needsReplace = entry.uses >= WORKER_MAX_USES;
  return { worker: entry.worker, needsReplace, poolEntry: entry };
}

async function runTesseractOCR(imageBuffer) {
  let wp = getWorkerFromPool();
  if (!wp.worker) {
    await initWorkerPool();
    wp = getWorkerFromPool();
    if (!wp.worker) {
      log('No worker available after pool init — returning empty OCR');
      return { text: '', words: [], confidence: 0, wordConf: 0, topConf: 0 };
    }
  }
  const { data } = await wp.worker.recognize(imageBuffer);
  const text = data.text || '';
  const words = data.words || [];
  const wordConf = words.length > 0
    ? Math.round((words.reduce((s, w) => s + (w.confidence || 0), 0) / words.length) * 100) / 100
    : 0;
  const topConf = data.confidence !== undefined ? data.confidence : 0;
  const effectiveConf = wordConf > 0 ? wordConf : topConf;
  log('Tesseract: ' + text.length + ' chars, wordConf=' + wordConf + '%, topConf=' + topConf + '%, effectiveConf=' + effectiveConf + '%');

  // Replace exhausted workers after recognition (never during — keeps pool non-empty)
  if (wp.needsReplace && wp.poolEntry) {
    wp.poolEntry.worker.terminate().catch(() => {});
    workerPool = workerPool.filter(e => e !== wp.poolEntry);
    workerPoolSize = workerPool.length;
    initWorkerPool().catch(e => log('Worker replacement failed: ' + e.message));
  }

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
  await saveDebugImage(rawBuf, orderId + '_original');
  const resizedBuf = await preprocessForOcr(rawBuf);
  let bestResult = { text: '', confidence: 0, strategy: 'none' };
  const results = [];
  const usedStrategies = STRATEGIES.slice(0, MAX_OCR_STRATEGIES);

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(label + ' timed out after ' + ms + 'ms')), ms)),
    ]);
  }

  const parallelResults = await Promise.all(usedStrategies.map(async (strategy) => {
    try {
      log('Strategy: ' + strategy.name + '...');
      const processedBuf = await withTimeout(strategy.fn(resizedBuf), OCR_STRATEGY_TIMEOUT_MS, strategy.name + ' preprocess');
      if (strategy.name !== 'original') {
        await saveDebugImage(processedBuf, orderId + '_' + strategy.name);
      }
      const data = await withTimeout(runTesseractOCR(processedBuf), OCR_STRATEGY_TIMEOUT_MS, strategy.name + ' OCR');
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
  if (!utr || typeof utr !== 'string') return null;
  const clean = utr.replace(/\s+/g, '').trim().toUpperCase();
  if (clean.length < UTR_MIN_LENGTH || clean.length > UTR_MAX_LENGTH) return null;
  if (!/^[A-Z0-9]+$/.test(clean)) return null;
  return clean;
}

function detectBankSmsText(text) {
  if (!text || text.length < 20) return { isBankSms: false, score: 0, matchedKeywords: 0, matchedPatterns: 0 };
  const upper = text.toUpperCase();
  const matchedKeywords = BANK_SMS_KEYWORDS.filter(kw => upper.includes(kw.toUpperCase()));
  const matchedPatterns = INDIAN_BANK_PATTERNS.filter(p => p.test(text));
  const score = (matchedKeywords.length * 5) + (matchedPatterns.length * 20);
  return { isBankSms: score >= MIN_BANK_SMS_SCORE, score, matchedKeywords: matchedKeywords.length, matchedPatterns: matchedPatterns.length };
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

function isFutureDate(dateStr) {
  if (!dateStr) return false;
  try {
    const parsed = new Date(dateStr);
    if (isNaN(parsed.getTime())) return false;
    const now = new Date();
    if (parsed.getFullYear() > now.getFullYear()) return true;
    if (parsed.getFullYear() === now.getFullYear() && parsed.getMonth() > now.getMonth()) return true;
    if (parsed.getFullYear() === now.getFullYear() && parsed.getMonth() === now.getMonth() && parsed.getDate() > now.getDate()) return true;
    return false;
  } catch { return false; }
}

function isWithinSessionWindow(timeStr, orderCreatedAt, maxMinutes) {
  if (!timeStr || !orderCreatedAt) return false;
  try {
    const parts = timeStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM|am|pm))?/);
    if (!parts) return false;
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
    if (isNaN(orderTime) || isNaN(smsTime)) return false;
    const diffMinutes = (smsTime - orderTime) / (1000 * 60);
    return diffMinutes >= 0 && diffMinutes <= maxMinutes;
  } catch { return false; }
}

function isFutureTime(timeStr) {
  if (!timeStr) return false;
  try {
    const parts = timeStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM|am|pm))?/);
    if (!parts) return false;
    let hour = parseInt(parts[1]);
    const minute = parseInt(parts[2]);
    const ampm = parts[4] ? parts[4].toUpperCase() : null;
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour >= 12) hour = 0;
    const now = new Date();
    const smsTime = new Date(
      now.getFullYear(), now.getMonth(), now.getDate(), hour, minute
    ).getTime();
    const currentTime = now.getTime();
    return smsTime > currentTime;
  } catch { return false; }
}

function receiverExactMatch(extractedReceiver) {
  if (!extractedReceiver) return false;
  const clean = extractedReceiver.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9@._-]/g, '');
  return clean === EXPECTED_RECEIVER_UPI;
}

function receiverAccountMatch(extractedAccount) {
  if (!extractedAccount) return false;
  const clean = extractedAccount.replace(/\s+/g, '').replace(/[^0-9]/g, '');
  if (!clean) return false;
  const mask = ADMIN_ACCOUNT_MASK.replace(/\s+/g, '').replace(/[^0-9]/g, '');
  return clean === mask || clean.endsWith(mask);
}

function paymentStatusAccepted(status) {
  if (!status) return false;
  const upper = status.toUpperCase().trim();
  if (ACCEPTED_PAYMENT_STATUSES.includes(upper)) return true;
  if (REJECTED_PAYMENT_STATUSES.includes(upper)) return false;
  return false;
}

function paymentStatusRejected(status) {
  if (!status) return false;
  const upper = status.toUpperCase().trim();
  if (REJECTED_PAYMENT_STATUSES.includes(upper)) return true;
  return false;
}

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
      if (cleanUtr && p.utr && p.utr.toUpperCase().trim() === cleanUtr && p.status !== REJECTED_STATUS) {
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
      if (textHash && p.ocr_text_hash === textHash && p.status !== REJECTED_STATUS) {
        fraudFlags.push('duplicate_ocr_text');
        fraudScore += 20;
      }
      const pOcrResult = p.ocr_result || {};
      const pText = (pOcrResult.rawText || pOcrResult.ocrText || '');
      if (textHash && pText && computeTextHash(pText) === textHash && p.status !== REJECTED_STATUS && p.id !== excludeOrderId) {
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

async function checkDuplicateUtr(utr, excludeOrderId) {
  if (!utr) return { isDuplicate: false };
  try {
    const cleanUtr = utr.toUpperCase().trim();
    const payments = await fetchPaymentsCached();
    const dup = payments.find(p =>
      p.utr && p.utr.toUpperCase().trim() === cleanUtr &&
      p.status !== REJECTED_STATUS &&
      p.id !== excludeOrderId
    );
    if (dup) return { isDuplicate: true, existingPayment: dup.id, existingUser: dup.user_id };
    return { isDuplicate: false };
  } catch (e) {
    log('Duplicate UTR check error: ' + e.message);
    return { isDuplicate: false, error: e.message };
  }
}

async function checkScreenshotHashDuplicate(imageHash, excludeOrderId) {
  if (!imageHash) return { isDuplicate: false };
  try {
    const payments = await fetchPaymentsCached();
    const dup = payments.find(p =>
      p.screenshot_hash === imageHash &&
      p.status !== REJECTED_STATUS &&
      p.id !== excludeOrderId
    );
    if (dup) return { isDuplicate: true, existingPayment: dup.id };
    return { isDuplicate: false };
  } catch (e) {
    log('Screenshot hash check error: ' + e.message);
    return { isDuplicate: false };
  }
}

async function checkOcrTextHashDuplicate(textHash, excludeOrderId) {
  if (!textHash) return { isDuplicate: false };
  try {
    const payments = await fetchPaymentsCached();
    const dup = payments.find(p =>
      p.ocr_text_hash === textHash &&
      p.status !== REJECTED_STATUS &&
      p.id !== excludeOrderId
    );
    if (dup) return { isDuplicate: true, existingPayment: dup.id };
    return { isDuplicate: false };
  } catch (e) {
    log('OCR text hash check error: ' + e.message);
    return { isDuplicate: false };
  }
}

async function runBankSmsVerification(order, screenshotUrl, userId, userEnteredUtr, userEnteredUpi) {
  const T = { start: Date.now(), imageLoad: 0, preprocess: 0, ocr: 0, parser: 0, fraud: 0, db: 0, decision: 0 };
  function stageTiming(stage) {
    const elapsed = Date.now() - T.start;
    log('[TIMING] ' + stage + ' at +' + elapsed + 'ms');
    if (elapsed > 3000 && !stage.includes('Total')) {
      log('[BOTTLENECK] Stage "' + stage + '" at +' + elapsed + 'ms exceeds 3s threshold');
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
      const flag = ms > 3000 ? ' BOTTLENECK (>3s)' : '';
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
    status: REJECTED_STATUS,
    verificationScore: 0,
    verificationDuration: 0,
    autoVerified: false,
    manualReviewRequired: false,
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
    userEnteredUpi: userEnteredUpi || null,
    userUpiMatched: false,
    allowedAmounts: ALLOWED_AMOUNTS,
    debug: { ocrResults: [] },
    timings: {},
  };

  try {
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

    if (workerPool.length === 0) {
      const tInit = Date.now();
      await initWorkerPool();
      log('Worker pool initialized in ' + (Date.now() - tInit) + 'ms, pool size=' + workerPool.length);
    }

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

    const tOcr = Date.now();

    const ocrWatchdog = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('OCR watchdog timed out after ' + (OCR_WATCHDOG_TIMEOUT_MS / 1000) + 's')), OCR_WATCHDOG_TIMEOUT_MS)
    );

    let ocrResult, imageQuality, fraudPreQuery;
    try {
      const results = await Promise.race([
        Promise.all([
          ocrWithRetry(rawBuf, orderId),
          analyzeImageQuality(rawBuf).catch(() => ({
            passed: true, overallGrade: 'unknown', issues: [], warnings: [],
            blurScore: 0, cropRatio: 1.0, lowResolution: false, darkScore: 0,
            glareScore: 0, compressionScore: 0, dimensions: { width: 0, height: 0 },
          })),
          fetchPaymentsCached().then(() => true).catch(() => false),
        ]),
        ocrWatchdog,
      ]);
      ocrResult = results[0];
      imageQuality = results[1];
      fraudPreQuery = results[2];
    } catch (watchdogErr) {
      log('OCR watchdog triggered: ' + watchdogErr.message);
      result.reasons.push('OCR processing timed out — please try again with a clearer screenshot');
      result.verificationScore = 0;
      result.verificationDuration = Date.now() - T.start;
      T.ocr = Date.now() - tOcr;
      printTimingsTable();
      return result;
    }

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

    result.imageQuality = imageQuality;
    result.checks.push({ name: 'image_quality', passed: imageQuality.passed, grade: imageQuality.overallGrade, issues: imageQuality.issues, blurScore: imageQuality.blurScore, cropRatio: imageQuality.cropRatio });
    if (!imageQuality.passed) log('Image quality issues: ' + imageQuality.issues.join(', '));
    if (imageQuality.blurScore > 70) log('Blur detected (score=' + imageQuality.blurScore + ')');
    if (imageQuality.cropRatio < 0.5) log('Crop ratio low: ' + imageQuality.cropRatio);
    if (imageQuality.darkScore > 80) log('Dark image (score=' + imageQuality.darkScore + ')');

    emitProgress(orderId, 'parsing', 50);

    const ocrLevel = avgConfidence >= MIN_OCR_CONFIDENCE ? 'good' : 'low';
    log('OCR level: ' + ocrLevel + ' (' + avgConfidence + '% >= ' + MIN_OCR_CONFIDENCE + '% required)');

    log('Detecting bank SMS format...');
    const bankSms = detectBankSmsText(ocrText);
    result.bankSmsDetected = bankSms.isBankSms;
    result.bankSmsScore = bankSms.score;
    result.checks.push({ name: 'bank_sms_detected', passed: bankSms.isBankSms, score: bankSms.score, keywords: bankSms.matchedKeywords, patterns: bankSms.matchedPatterns });

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

    const amountMatch = exactAmountMatch(ocrData.extractedAmount, expectedAmount);
    result.matchedAmount = amountMatch;
    result.checks.push({ name: 'amount_match', passed: amountMatch, extracted: ocrData.extractedAmount, expected: expectedAmount });
    if (!amountMatch) log('Amount mismatch: found=' + ocrData.extractedAmount + ', expected=' + expectedAmount);

    const validUtr = validateUtr(ocrData.extractedUtr);
    result.matchedUtr = !!validUtr;
    result.checks.push({ name: 'utr_validation', passed: !!validUtr, extracted: ocrData.extractedUtr });
    if (!validUtr) log('Invalid UTR: ' + ocrData.extractedUtr);

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

    const tDb = Date.now();
    let utrDuplicate = { isDuplicate: false };
    if (validUtr) {
      utrDuplicate = await checkDuplicateUtr(validUtr, orderId);
    }
    log('Duplicate UTR check: ' + (utrDuplicate.isDuplicate ? 'DUPLICATE FOUND' : 'clean'));
    result.duplicateUtrDetected = utrDuplicate.isDuplicate;
    result.checks.push({ name: 'utr_duplicate', passed: !utrDuplicate.isDuplicate, isDuplicate: utrDuplicate.isDuplicate });
    if (utrDuplicate.isDuplicate) log('Duplicate UTR: ' + validUtr);

    let screenshotHashDup = { isDuplicate: false };
    screenshotHashDup = await checkScreenshotHashDuplicate(imageHash, orderId);
    log('Screenshot hash duplicate: ' + (screenshotHashDup.isDuplicate ? 'DUPLICATE FOUND' : 'clean'));
    result.checks.push({ name: 'screenshot_hash_unique', passed: !screenshotHashDup.isDuplicate });

    let ocrTextHashDup = { isDuplicate: false };
    ocrTextHashDup = await checkOcrTextHashDuplicate(textHash, orderId);
    log('OCR text hash duplicate: ' + (ocrTextHashDup.isDuplicate ? 'DUPLICATE FOUND' : 'clean'));
    result.checks.push({ name: 'ocr_text_hash_unique', passed: !ocrTextHashDup.isDuplicate });

    T.db = Date.now() - tDb;
    stageTiming('Database');

    const dateStr = ocrData.extractedDate;
    const dateIsToday = isToday(dateStr);
    const dateIsFuture = isFutureDate(dateStr);
    const dateValid = dateIsToday && !dateIsFuture;
    result.matchedDate = dateValid;
    result.checks.push({ name: 'date_validation', passed: dateValid, extracted: dateStr, isToday: dateIsToday, isFuture: dateIsFuture });
    if (!dateIsToday) log('Date not today: ' + dateStr);
    if (dateIsFuture) log('Date is in the future: ' + dateStr);

    const timeStr = ocrData.extractedTime;
    const timeWithinWindow = isWithinSessionWindow(timeStr, orderCreatedAt, MAX_SESSION_AGE_MINUTES);
    const timeIsFuture = isFutureTime(timeStr);
    const timeValid = timeWithinWindow && !timeIsFuture;
    result.checks.push({ name: 'time_validation', passed: timeValid, extracted: timeStr, withinWindow: timeWithinWindow, isFuture: timeIsFuture, maxMinutes: MAX_SESSION_AGE_MINUTES });
    if (!timeWithinWindow) log('Time outside session window: ' + timeStr + ' (created=' + orderCreatedAt + ', max=' + MAX_SESSION_AGE_MINUTES + 'min)');
    if (timeIsFuture) log('Time is in the future: ' + timeStr);

    const receiverValid = receiverExactMatch(ocrData.extractedReceiverName) || receiverExactMatch(ocrData.extractedReceiverAccount) || receiverExactMatch(ocrData.extractedSenderVpa) || receiverAccountMatch(ocrData.extractedReceiverAccount);
    result.matchedReceiver = receiverValid;
    result.checks.push({ name: 'receiver_validation', passed: receiverValid, extractedName: ocrData.extractedReceiverName, extractedAccount: ocrData.extractedReceiverAccount, expected: EXPECTED_RECEIVER_UPI });
    if (!receiverValid) {
      const receiverInSms = ocrData.extractedReceiverName || ocrData.extractedReceiverAccount || ocrData.extractedSenderVpa || '(not found)';
      log('Receiver mismatch: "' + receiverInSms + '" !== "' + EXPECTED_RECEIVER_UPI + '"');
      result.reasons.push('Receiver mismatch: expected ' + EXPECTED_RECEIVER_UPI + ', found "' + receiverInSms + '"');
    }

    // User-entered UPI ID vs OCR-extracted UPI/receiver match
    let userUpiMatch = false;
    let userUpiReason = '';
    if (!userEnteredUpi || !userEnteredUpi.trim()) {
      userUpiReason = 'No UPI ID entered by user';
      log('User-entered UPI: MISSING');
    } else {
      const cleanedUserUpi = userEnteredUpi.trim().toLowerCase().replace(/\s+/g, '');
      const candidates = [
        ocrData.extractedReceiverName,
        ocrData.extractedSenderVpa,
        ocrData.extractedReceiverAccount,
      ].filter(Boolean).map(v => v.toLowerCase().replace(/\s+/g, ''));
      userUpiMatch = candidates.some(c => c === cleanedUserUpi || c.includes(cleanedUserUpi) || cleanedUserUpi.includes(c));
      if (userUpiMatch) {
        log('User-entered UPI MATCHES SMS: ' + cleanedUserUpi);
      } else {
        userUpiReason = 'Entered UPI ID does not match the SMS. Entered: ' + cleanedUserUpi + ', SMS contains: ' + (candidates.join(', ') || 'none');
        log('User-entered UPI MISMATCH: entered=' + cleanedUserUpi + ', sms=' + candidates.join(', '));
        result.reasons.push(userUpiReason);
      }
    }
    result.userUpiMatched = userUpiMatch;
    result.checks.push({ name: 'user_upi_match', passed: userUpiMatch, entered: userEnteredUpi || '', extracted: [ocrData.extractedReceiverName, ocrData.extractedSenderVpa, ocrData.extractedReceiverAccount].filter(Boolean).join(', ') });

    const paymentStatusStr = ocrData.extractedPaymentStatus;
    const statusAccepted = paymentStatusAccepted(paymentStatusStr);
    const statusRejected = paymentStatusRejected(paymentStatusStr);
    const statusValid = statusAccepted && !statusRejected;
    result.matchedStatus = statusValid;
    result.checks.push({ name: 'payment_status', passed: statusValid, extracted: paymentStatusStr, accepted: statusAccepted, rejected: statusRejected });
    if (!statusValid) {
      log('Payment status invalid: ' + paymentStatusStr);
      result.reasons.push('Payment status must be one of: ' + ACCEPTED_PAYMENT_STATUSES.join(', ') + '. Found: ' + (paymentStatusStr || 'unknown'));
    }

    emitProgress(orderId, 'fraud', 80);

    const tFraud = Date.now();
    const fraud = await checkFraud(imageHash, validUtr, ocrText, userId, orderId);
    T.fraud = Date.now() - tFraud;
    stageTiming('Fraud Detection');
    result.fraudScore = fraud.fraudScore;
    result.fraudFlags = fraud.fraudFlags;
    const fraudClean = fraud.fraudScore === 0 && fraud.fraudFlags.length === 0;
    result.checks.push({ name: 'fraud_detection', passed: fraudClean, fraudScore: fraud.fraudScore, flags: fraud.fraudFlags });
    if (!fraudClean) {
      log('Fraud detected: ' + fraud.fraudFlags.join(', ') + ' (score=' + fraud.fraudScore + ')');
    }

    emitProgress(orderId, 'scoring', 90);

    const tDecision = Date.now();

    const checksPass = {
      ocrConfidence: avgConfidence >= MIN_OCR_CONFIDENCE,
      amountMatch,
      utrValid: !!validUtr,
      userUtrMatch,
      userUpiMatch,
      utrUnique: !utrDuplicate.isDuplicate,
      receiverMatch: receiverValid,
      dateToday: dateValid,
      timeWindow: timeValid,
      paymentStatus: statusValid,
      bankSmsValid: bankSms.isBankSms,
      imageQualityPass: imageQuality.passed,
      screenshotUnique: !screenshotHashDup.isDuplicate,
      ocrTextUnique: !ocrTextHashDup.isDuplicate,
      fraudClean,
    };

    const allPass = Object.values(checksPass).every(v => v === true);

    let verificationScore = 0;
    const scoreItems = [
      { label: 'OCR confidence', pass: checksPass.ocrConfidence, weight: 10 },
      { label: 'Amount match', pass: checksPass.amountMatch, weight: 15 },
      { label: 'UTR valid', pass: checksPass.utrValid, weight: 10 },
      { label: 'User UTR match', pass: checksPass.userUtrMatch, weight: 15 },
      { label: 'User UPI match', pass: checksPass.userUpiMatch, weight: 10 },
      { label: 'UTR unique', pass: checksPass.utrUnique, weight: 10 },
      { label: 'Receiver match', pass: checksPass.receiverMatch, weight: 10 },
      { label: 'Date today', pass: checksPass.dateToday, weight: 10 },
      { label: 'Time window', pass: checksPass.timeWindow, weight: 5 },
      { label: 'Payment status', pass: checksPass.paymentStatus, weight: 5 },
      { label: 'Bank SMS valid', pass: checksPass.bankSmsValid, weight: 5 },
      { label: 'Image quality', pass: checksPass.imageQualityPass, weight: 2 },
      { label: 'Screenshot unique', pass: checksPass.screenshotUnique, weight: 1 },
      { label: 'OCR text unique', pass: checksPass.ocrTextUnique, weight: 1 },
      { label: 'Fraud clean', pass: checksPass.fraudClean, weight: 1 },
    ];

    let earned = 0, totalWeight = 0;
    log('=== CHECK RESULTS ===');
    for (const item of scoreItems) {
      totalWeight += item.weight;
      if (item.pass) earned += item.weight;
      log('  ' + item.label + ': ' + (item.pass ? 'PASS' : 'FAIL') + ' (' + item.weight + (item.pass ? '/' + item.weight : '/0') + ')');
    }
    verificationScore = totalWeight > 0 ? Math.round((earned / totalWeight) * 100) : 0;
    result.verificationScore = verificationScore;
    log('Score: ' + verificationScore + '% (' + earned + '/' + totalWeight + ')');

    if (allPass) {
      result.status = APPROVED_STATUS;
      result.autoVerified = true;
      result.manualReviewRequired = false;
      result.reasons = ['All ' + Object.keys(checksPass).length + ' validation checks passed'];
      log('DECISION: APPROVED — all ' + Object.keys(checksPass).length + ' checks passed');
    } else {
      result.status = REJECTED_STATUS;
      result.autoVerified = false;
      result.manualReviewRequired = false;
      const failures = [];
      for (const [key, passed] of Object.entries(checksPass)) {
        if (!passed) failures.push(key);
      }
      log('DECISION: REJECTED — ' + failures.length + ' check(s) failed: ' + failures.join(', '));
      if (result.reasons.length === 0) {
        result.reasons = failures.map(f => {
          const map = {
            ocrConfidence: 'OCR confidence ' + avgConfidence + '% is below required ' + MIN_OCR_CONFIDENCE + '%',
            amountMatch: 'Amount mismatch: extracted ' + ocrData.extractedAmount + ', expected ' + expectedAmount,
            utrValid: 'Invalid UTR extracted from SMS',
            userUtrMatch: 'Entered UTR does not match SMS UTR',
            userUpiMatch: 'Entered UPI ID does not match the UPI ID in your SMS screenshot',
            utrUnique: 'Duplicate UTR detected in system',
            receiverMatch: 'Receiver UPI does not match expected ' + EXPECTED_RECEIVER_UPI,
            dateToday: 'Payment date ' + dateStr + ' is not today or is in the future',
            timeWindow: 'Payment time ' + timeStr + ' exceeds ' + MAX_SESSION_AGE_MINUTES + ' minute window from session creation',
            paymentStatus: 'Payment status must be SUCCESS/SUCCESSFUL/CREDITED/PAID, found: ' + (paymentStatusStr || 'unknown'),
            bankSmsValid: 'Screenshot does not match bank SMS format (score=' + bankSms.score + ')',
            imageQualityPass: 'Image quality check failed: ' + (imageQuality.issues || []).join(', '),
            screenshotUnique: 'Duplicate screenshot detected in system',
            ocrTextUnique: 'Duplicate OCR text detected in system',
            fraudClean: 'Fraud detected: ' + fraud.fraudFlags.join(', '),
          };
          return map[f] || 'Validation failed: ' + f;
        });
      }
    }

    T.decision = Date.now() - tDecision;
    printTimingsTable();
    stageTiming('Response Sent');

    const stageThreshold = 3000;
    const timingEntries = { imageLoad: T.imageLoad, preprocess: T.preprocess, ocr: T.ocr, parser: T.parser, fraud: T.fraud, db: T.db, decision: T.decision };
    for (const [stage, ms] of Object.entries(timingEntries)) {
      if (ms > stageThreshold) {
        log('[BOTTLENECK] Stage "' + stage + '" took ' + ms + 'ms (exceeds ' + stageThreshold + 'ms threshold)');
      }
    }

    result.status = allPass ? APPROVED_STATUS : REJECTED_STATUS;
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
    metrics.trackOCR(allPass);

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
    log('  OCR:    strategy=' + ocrResult.strategy + ', text=' + ocrText.length + ' chars, conf=' + avgConfidence + '%, required=' + MIN_OCR_CONFIDENCE + '%');
    log('  Parse:  amount=' + ocrData.extractedAmount + ', utr=' + ocrData.extractedUtr + ', bank=' + ocrData.extractedBankName + ', date=' + ocrData.extractedDate + ', time=' + ocrData.extractedTime + ', status=' + ocrData.extractedPaymentStatus);
    log('  User:   enteredUtr=' + (userEnteredUtr || 'none') + ' matched=' + userUtrMatch);
    log('  User:   enteredUpi=' + (userEnteredUpi || 'none') + ' matched=' + userUpiMatch);
    log('  Checks: ' + JSON.stringify(checksPass));
    log('  Score:  ' + verificationScore + '% (' + earned + '/' + totalWeight + ')');
    log('  Result: ' + result.status + ' | allPass=' + allPass + ' | duration=' + result.verificationDuration + 'ms');
    log('  Reasons: ' + JSON.stringify(result.reasons));
    log('=== END ===');

  } catch (e) {
    log('Fatal error: ' + e.message);
    log('Stack: ' + e.stack);
    result.status = REJECTED_STATUS;
    result.reasons = ['Verification error: ' + e.message];
    result.manualReviewRequired = false;
    result.verificationDuration = Date.now() - T.start;
  }

  return result;
}

// Eager init worker pool at module load time (shaves 5-15s off cold start)
if (Tesseract) {
  initWorkerPool().then(() => {
    log('Eager worker pool init complete: ' + workerPool.length + ' workers ready');
  }).catch(e => {
    log('Eager worker pool init failed: ' + e.message);
  });
}

module.exports = {
  runBankSmsVerification, VERIFY_TIMEOUT_MS, shutdownWorker, initWorkerPool, ALLOWED_AMOUNTS, ADMIN_UPI_ID,
  exactAmountMatch, validateUtr, detectBankSmsText, computeImageHash, computeTextHash,
  isToday, isFutureDate, isWithinSessionWindow, isFutureTime,
  receiverExactMatch, receiverAccountMatch, paymentStatusAccepted, paymentStatusRejected,
  checkDuplicateUtr, checkScreenshotHashDuplicate, checkOcrTextHashDuplicate,
  checkFraud, MIN_OCR_CONFIDENCE, MIN_BANK_SMS_SCORE, MAX_SESSION_AGE_MINUTES,
  ACCEPTED_PAYMENT_STATUSES, REJECTED_PAYMENT_STATUSES, EXPECTED_RECEIVER_UPI,
  APPROVED_STATUS, REJECTED_STATUS, UTR_MIN_LENGTH, UTR_MAX_LENGTH,
};
