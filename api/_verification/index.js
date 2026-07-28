const C = require('./config');
const log = require('./logger').ENGINE;

const imageValidator = require('./imageValidator');
const imageEnhancer = require('./imageEnhancer');
const ocrEngine = require('./ocrEngine');
const fieldExtractor = require('./fieldExtractor');
const fieldNormalizer = require('./fieldNormalizer');
const businessValidator = require('./businessValidator');
const duplicateDetector = require('./duplicateDetector');
const fraudDetector = require('./fraudDetector');
const decisionEngine = require('./decisionEngine');
const auditLogger = require('./auditLogger');

function trace(orderId, label, data) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log('[TRACE] [' + ts + '] [' + orderId + '] ' + label + (data ? ' ' + (typeof data === 'string' ? data : JSON.stringify(data)) : ''));
}

function withTimeout(promise, ms, label) {
  let id;
  const p = Promise.race([
    promise,
    new Promise((_, reject) => { id = setTimeout(() => reject(new Error('TIMEOUT:' + label)), ms); }),
  ]);
  p.finally(() => clearTimeout(id));
  return p;
}

function fetchImage(url) {
  if (!url) return null;
  if (url.startsWith('data:')) {
    const m = url.match(/^data:[^;]+;base64,(.+)$/);
    if (m) return Buffer.from(m[1], 'base64');
    return null;
  }
  const mod = url.startsWith('https:') ? require('https') : require('http');
  return new Promise((resolve, reject) => {
    const req = mod.get(url, { timeout: C.FETCH_TIMEOUT_MS }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) { reject(new Error('HTTP ' + res.statusCode)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', function () { this.destroy(); reject(new Error('FETCH_TIMEOUT')); });
  });
}

function buildResult(status, score, reasons, t0, extra) {
  const base = extra || {};
  base.status = status;
  base.verificationScore = typeof score === 'number' ? score : 0;
  base.verificationDuration = Date.now() - t0;
  base.autoVerified = status === C.APPROVED_STATUS;
  base.manualReviewRequired = status === C.MANUAL_REVIEW_STATUS;
  base.reasons = base.reasons && base.reasons.length ? base.reasons : (reasons || []);
  return base;
}

async function run(order, screenshotUrl, userId, userUtr, screenshotBuf) {
  const t0 = Date.now();
  const orderId = (order && order.id) || 'unknown';
  const expectedAmount = Number(order && order.amount) || 0;

  trace(orderId, '═══════════════════════════════════════════════════', '');
  trace(orderId, 'V5 ENGINE START', { orderId, amount: expectedAmount, type: order.type, userUtr: userUtr || null });

  if (!expectedAmount || !C.ALLOWED_AMOUNTS.includes(expectedAmount)) {
    trace(orderId, 'REJECTED', 'Invalid amount: ' + expectedAmount);
    return buildResult('rejected', 0, ['Invalid payment amount'], t0, {
      paymentType: order.type, selectedPackage: expectedAmount,
    });
  }

  const state = {
    status: 'rejected',
    verificationScore: 0,
    autoVerified: false,
    manualReviewRequired: false,
    reasons: [],
    ocrData: null,
    matchedAmount: false,
    matchedUtr: false,
    matchedDate: false,
    matchedStatus: false,
    fraudScore: 0,
    fraudFlags: [],
    screenshotHash: '',
    userEnteredUtr: userUtr || null,
    userUtrMatched: false,
    timings: {},
    paymentType: order.type || 'unknown',
    selectedPackage: expectedAmount,
    matchedReceiver: false,
    matchedName: false,
    validationResults: [],
    auditLog: null,
  };

  // ── STEP 1: FETCH ──
  trace(orderId, 'STEP 1: IMAGE FETCH', '');
  let rawBuf;
  try {
    if (screenshotBuf && Buffer.isBuffer(screenshotBuf)) {
      rawBuf = screenshotBuf;
      trace(orderId, 'IMAGE PROVIDED', 'buffer=' + rawBuf.length + ' bytes');
    } else if (screenshotUrl) {
      trace(orderId, 'FETCHING', screenshotUrl.substring(0, 80));
      rawBuf = await withTimeout(fetchImage(screenshotUrl), C.FETCH_TIMEOUT_MS + 1000, 'imageFetch');
      trace(orderId, 'FETCHED', rawBuf.length + ' bytes');
    } else {
      return buildResult('rejected', 0, ['No screenshot provided'], t0, state);
    }
  } catch (e) {
    trace(orderId, 'FETCH FAILED', e.message);
    return buildResult('rejected', 0, ['Failed to load screenshot'], t0, state);
  }

  // ── STEP 2: VALIDATE IMAGE ──
  trace(orderId, 'STEP 2: IMAGE VALIDATION', '');
  let imageInfo;
  try {
    imageInfo = await withTimeout(imageValidator.run(rawBuf), 5000, 'imageValidate');
    state.screenshotHash = imageInfo.imageHash;
    state.timings.imageValidation = imageInfo.duration;
    trace(orderId, 'VALIDATED', 'passed=' + imageInfo.passed + ' format=' + imageInfo.format + ' ' + imageInfo.width + 'x' + imageInfo.height + ' issues=' + imageInfo.issues.join(','));
    if (!imageInfo.passed) {
      return buildResult('manual_review', 50, ['Image validation failed: ' + imageInfo.issues.join('; ')], t0, state);
    }
  } catch (e) {
    trace(orderId, 'VALIDATE TIMEOUT', e.message);
    imageInfo = { passed: true, format: 'unknown', width: 0, height: 0, imageHash: '', tamperScore: 0, issues: [], duration: 0 };
  }

  // ── STEP 3: ENHANCE IMAGE ──
  trace(orderId, 'STEP 3: IMAGE ENHANCEMENT', '');
  let strategies, qualityResult;
  try {
    const enhanceResult = await withTimeout(imageEnhancer.run(rawBuf), 5000, 'imageEnhance');
    strategies = enhanceResult.strategies;
    qualityResult = enhanceResult.quality;
    state.timings.enhancement = enhanceResult.duration;
    trace(orderId, 'ENHANCED', 'strategies=' + strategies.length + ' blur=' + qualityResult.blurScore);
    if (!qualityResult.passed) {
      return buildResult('manual_review', 50, ['Image quality insufficient: ' + qualityResult.issues.join('; ')], t0, state);
    }
  } catch (e) {
    trace(orderId, 'ENHANCE TIMEOUT', e.message);
    strategies = [{ name: 'original', buf: rawBuf }];
    qualityResult = { blurScore: 0, passed: true, issues: [] };
  }

  // ── STEP 4: OCR ──
  trace(orderId, 'STEP 4: OCR', '');
  let ocrResult;
  try {
    ocrResult = await withTimeout(ocrEngine.run(strategies, C.OCR_ENGINE_TIMEOUT_MS), C.OCR_ENGINE_TIMEOUT_MS + 2000, 'ocr');
    if (!ocrResult.engineAvailable) {
      return buildResult('manual_review', 50, ['OCR engine not available'], t0, state);
    }
    if (!ocrResult.bestResult || !ocrResult.bestResult.text || ocrResult.bestResult.text.trim().length < C.MIN_OCR_TEXT_LENGTH) {
      return buildResult('manual_review', 40, ['Insufficient text extracted from screenshot'], t0, state);
    }
    state.timings.ocr = ocrResult.duration;
    trace(orderId, 'OCR DONE', 'chars=' + ocrResult.bestResult.text.length + ' conf=' + ocrResult.bestResult.confidence.toFixed(1) + '%');
  } catch (e) {
    trace(orderId, 'OCR FAILED', e.message);
    return buildResult('manual_review', 30, ['OCR processing failed: ' + e.message], t0, state);
  }

  // ── STEP 5: FIELD EXTRACTION ──
  trace(orderId, 'STEP 5: FIELD EXTRACTION', '');
  let extracted;
  try {
    extracted = fieldExtractor.run(ocrResult.bestResult.text, ocrResult.bestResult.words);
    state.ocrData = {
      rawText: extracted.rawText.substring(0, 500),
      amount: extracted.amount ? extracted.amount.value : null,
      utr: extracted.utr ? extracted.utr.value : null,
      receiverUpi: extracted.receiverUpi ? extracted.receiverUpi.value : null,
      receiverName: extracted.receiverName ? extracted.receiverName.value : null,
      transactionId: extracted.transactionId ? extracted.transactionId.value : null,
      date: extracted.date ? extracted.date.value : null,
      time: extracted.time ? extracted.time.value : null,
      paymentStatus: extracted.paymentStatus ? extracted.paymentStatus.value : null,
      app: extracted.appIdentity || null,
      confidence: ocrResult.bestResult.confidence,
    };
    state.timings.extraction = Date.now() - t0;
    trace(orderId, 'EXTRACTED', { amount: extracted.amount?.value, utr: extracted.utr?.value, upi: extracted.receiverUpi?.value, name: extracted.receiverName?.value, date: extracted.date?.value, time: extracted.time?.value, status: extracted.paymentStatus?.value, app: extracted.appIdentity });
  } catch (e) {
    trace(orderId, 'EXTRACT FAILED', e.message);
    return buildResult('manual_review', 40, ['Field extraction failed'], t0, state);
  }

  // ── STEP 6: FIELD NORMALIZATION ──
  trace(orderId, 'STEP 6: FIELD NORMALIZATION', '');
  const normalized = fieldNormalizer.normalizeAll(extracted);
  state.timings.normalization = Date.now() - t0;

  // ── STEP 7: BUSINESS VALIDATION ──
  trace(orderId, 'STEP 7: BUSINESS VALIDATION', '');
  let validationResult;
  try {
    const mockOrder = { id: orderId, amount: expectedAmount, type: order.type, created_at: order.created_at || new Date().toISOString() };
    validationResult = businessValidator.run(normalized, mockOrder, userUtr);
    state.matchedAmount = validationResult.validationMap.amount?.passed || false;
    state.matchedReceiver = validationResult.validationMap.receiver_upi?.passed || false;
    state.matchedName = validationResult.validationMap.receiver_name?.passed || false;
    state.matchedUtr = validationResult.validationMap.utr?.passed || false;
    state.matchedDate = validationResult.validationMap.date?.passed || false;
    state.matchedStatus = validationResult.validationMap.payment_status?.passed || false;
    state.userUtrMatched = validationResult.validationMap.user_utr?.passed || false;
    state.validationResults = Object.values(validationResult.validationMap);
    state.timings.validation = Date.now() - t0;
    trace(orderId, 'VALIDATED', 'hard=' + validationResult.hardFailures + ' soft=' + validationResult.softFailures + ' allMandatory=' + validationResult.allMandatoryPass);
  } catch (e) {
    trace(orderId, 'VALIDATE FAILED', e.message);
    return buildResult('rejected', 0, ['Validation error: ' + e.message], t0, state);
  }

  // ── STEP 8: DUPLICATE DETECTION ──
  trace(orderId, 'STEP 8: DUPLICATE DETECTION', '');
  let duplicateResult;
  try {
    const textHash = duplicateDetector.computeTextHash(ocrResult.bestResult.text);
    const utrVal = (extracted.utr && extracted.utr.value) || '';
    const txnVal = (extracted.transactionId && extracted.transactionId.value) || '';
    const screenHash = state.screenshotHash;
    duplicateResult = await withTimeout(duplicateDetector.run(utrVal, txnVal, screenHash, textHash), C.DEDUP_TIMEOUT_MS, 'dedup');
    state.timings.dedup = duplicateResult.duration;
    trace(orderId, 'DEDUP', 'duplicate=' + duplicateResult.isDuplicate);
  } catch (e) {
    trace(orderId, 'DEDUP FAILED', e.message);
    duplicateResult = { isDuplicate: false, checks: [], duration: 0 };
  }

  // ── STEP 9: FRAUD DETECTION ──
  trace(orderId, 'STEP 9: FRAUD DETECTION', '');
  let fraudResult;
  try {
    fraudResult = fraudDetector.run({
      ocrText: ocrResult.bestResult.text,
      imageInfo,
      ocrConfidence: ocrResult.bestResult.confidence,
      strategies,
    });
    state.fraudScore = fraudResult.fraudScore;
    state.fraudFlags = fraudResult.issues;
    state.timings.fraud = fraudResult.duration;
    trace(orderId, 'FRAUD', 'score=' + fraudResult.fraudScore + ' risk=' + fraudResult.riskLevel);
  } catch (e) {
    fraudResult = { fraudScore: 0, riskLevel: 'low', issues: [], duration: 0 };
  }

  // ── STEP 10: DECISION ──
  trace(orderId, 'STEP 10: DECISION', '');
  let decision;
  try {
    decision = decisionEngine.run(validationResult, fraudResult, duplicateResult, ocrResult.bestResult.confidence);
    state.status = decision.status;
    state.verificationScore = decision.finalScore;
    state.reasons = decision.reasons;
    state.autoVerified = decision.status === C.APPROVED_STATUS;
    state.manualReviewRequired = decision.status === C.MANUAL_REVIEW_STATUS;
    state.timings.decision = decision.duration;
    trace(orderId, 'DECISION', 'status=' + decision.status + ' score=' + decision.finalScore);
  } catch (e) {
    trace(orderId, 'DECISION FAILED', e.message);
    return buildResult('rejected', 0, ['Decision engine error'], t0, state);
  }

  // ── STEP 11: AUDIT LOG ──
  trace(orderId, 'STEP 11: AUDIT LOG', '');
  try {
    const hardCount = validationResult.hardFailures || 0;
    const softCount = validationResult.softFailures || 0;
    const pipelineData = {
      imageValidated: imageInfo.passed,
      imageFormat: imageInfo.format,
      imageDimensions: (imageInfo.width || 0) + 'x' + (imageInfo.height || 0),
      blurScore: (qualityResult && qualityResult.blurScore) || 0,
      ocrConfidence: ocrResult.bestResult.confidence,
      ocrCharsExtracted: ocrResult.bestResult.text.length,
      fieldsExtracted: extracted ? Object.values(extracted).filter(v => v && v.value !== null).length : 0,
      fieldsPassed: Object.values(validationResult.validationMap).filter(c => c.passed).length,
      fieldsFailed: Object.values(validationResult.validationMap).filter(c => !c.passed).length,
      duplicateFound: duplicateResult.isDuplicate,
      fraudFlags: state.fraudFlags,
      validationMap: validationResult.validationMap,
      businessValidationResult: hardCount > 0 ? hardCount + ' HARD failures' : (softCount > 0 ? softCount + ' SOFT failures' : 'ALL PASS'),
    };
    state.auditLog = auditLogger.createEntry(order, state, pipelineData);
    state.timings.audit = Date.now() - t0;
  } catch (_) {}

  state.verificationDuration = Date.now() - t0;
  state.timings.total = state.verificationDuration;

  trace(orderId, '═══════════════ DONE ═══════════════', 'status=' + state.status + ' score=' + state.verificationScore + ' (' + state.verificationDuration + 'ms)');
  return state;
}

const TOTAL_PIPELINE_BUDGET_MS = 30000;

module.exports = { run, TOTAL_PIPELINE_BUDGET_MS };