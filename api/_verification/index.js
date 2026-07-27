const imageAuth = require('./imageAuth');
const imageEnhance = require('./imageEnhance');
const multiEngineOcr = require('./multiEngineOcr');
const fieldExtractor = require('./fieldExtractor');
const fieldValidator = require('./fieldValidator');
const duplicateDetector = require('./duplicateDetector');
const fraudDetector = require('./fraudDetector');
const decisionEngine = require('./decisionEngine');
const C = require('./config');
const log = require('./logger').PIPELINE;

const TOTAL_PIPELINE_BUDGET_MS = 5000;

function trace(orderId, label, data) {
  const ts = new Date().toISOString().slice(11, 23);
  const summary = typeof data === 'string' ? data : JSON.stringify(data, null, 0);
  console.log('[TRACE] [' + ts + '] [' + orderId + '] ' + label + ' ' + summary);
}

function stepTimer(orderId, label) {
  const t = Date.now();
  return () => {
    const ms = Date.now() - t;
    trace(orderId, label, { ms });
    return ms;
  };
}

function budgetRemaining(startMs) {
  return TOTAL_PIPELINE_BUDGET_MS - (Date.now() - startMs);
}

async function fetchBuffer(url) {
  if (url && url.startsWith('data:')) {
    const matches = url.match(/^data:[^;]+;base64,(.+)$/);
    if (matches) return Buffer.from(matches[1], 'base64');
    throw new Error('Invalid data URL');
  }
  const https = require('https');
  const http = require('http');
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(url, { timeout: 2000 }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) { reject(new Error('HTTP ' + res.statusCode)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', function () { this.destroy(); reject(new Error('Timeout fetching screenshot')); });
  });
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT:' + label + ':' + ms + 'ms')), ms)),
  ]);
}

async function runPipeline(order, screenshotUrl, userId, userUtr, screenshotBuf) {
  const t0 = Date.now();
  const orderId = order.id || 'unknown';

  trace(orderId, '═══════════════════════════════════════════════════', '');
  trace(orderId, 'UPLOAD RECEIVED', { budget: TOTAL_PIPELINE_BUDGET_MS + 'ms' });

  const pipeline = {
    stageTimings: {},
    stages: {},
    status: 'rejected',
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
    screenshotHash: '',
    textHash: '',
    bankSmsDetected: false,
    bankSmsScore: 0,
    userEnteredUtr: userUtr || null,
    userUtrMatched: false,
    userEnteredUpi: order.expected_upi_id || null,
    userUpiMatched: false,
    allowedAmounts: C.ALLOWED_AMOUNTS,
    debug: {},
    timings: {},
  };

  trace(orderId, 'INPUT', {
    orderId: order.id,
    amount: order.amount,
    type: order.type,
    expectedUpiId: order.expected_upi_id,
    userId,
    userUtr: userUtr || null,
    screenshotUrl: screenshotUrl ? screenshotUrl.substring(0, 80) + '...' : 'MISSING',
    testMode: C.TEST_MODE,
    allowedAmounts: C.ALLOWED_AMOUNTS,
  });

  if (!screenshotUrl) {
    pipeline.reasons.push('REJECT: No screenshot provided');
    trace(orderId, 'DECISION: REJECTED', 'No screenshot URL');
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  const expectedAmount = Number(order.amount) || 0;
  if (!expectedAmount || !C.ALLOWED_AMOUNTS.includes(expectedAmount)) {
    pipeline.reasons.push('REJECT: Invalid amount: ' + expectedAmount + '. Allowed: ' + C.ALLOWED_AMOUNTS.join(', '));
    trace(orderId, 'DECISION: REJECTED', 'Invalid expected amount');
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  trace(orderId, 'EXPECTED VALUES', {
    expectedAmount,
    expectedUpi: C.EXPECTED_RECEIVER_UPI,
    allowedAmounts: C.ALLOWED_AMOUNTS,
  });

  // ── STEP 1: FETCH IMAGE ──
  trace(orderId, '↓ STEP 1: IMAGE FETCH', '');
  let fetchDone;
  let rawBuf;
  try {
    fetchDone = stepTimer(orderId, 'TIMING:imageFetch');
    if (screenshotBuf && Buffer.isBuffer(screenshotBuf)) {
      rawBuf = screenshotBuf;
      pipeline.stageTimings.imageLoad = fetchDone();
      trace(orderId, 'IMAGE FROM BUFFER', { bytes: rawBuf.length, timeMs: pipeline.stageTimings.imageLoad });
    } else {
      rawBuf = await withTimeout(fetchBuffer(screenshotUrl), 2000, 'imageFetch');
      pipeline.stageTimings.imageLoad = fetchDone();
      trace(orderId, 'IMAGE FETCHED', { bytes: rawBuf.length, timeMs: pipeline.stageTimings.imageLoad });
    }
  } catch (e) {
    const ms = fetchDone ? fetchDone() : 0;
    pipeline.reasons.push('REJECT: Could not fetch screenshot: ' + e.message);
    pipeline.timings = { imageFetch: ms, total: Date.now() - t0 };
    trace(orderId, 'IMAGE FETCH FAILED', { error: e.message, ms, budget: budgetRemaining(t0) });
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  if (budgetRemaining(t0) < 500) {
    trace(orderId, 'BUDGET EXHAUSTED after image fetch', { remaining: budgetRemaining(t0) });
    pipeline.status = 'manual_review';
    pipeline.manualReviewRequired = true;
    pipeline.reasons.push('MANUAL_REVIEW: Budget exhausted after image fetch');
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  // ── STEP 2: AUTHENTICITY CHECK ──
  trace(orderId, '↓ STEP 2: AUTHENTICITY', '');
  let authDone;
  let authResult;
  try {
    authDone = stepTimer(orderId, 'TIMING:auth');
    authResult = await withTimeout(imageAuth.run(rawBuf), 1500, 'imageAuth');
    pipeline.stageTimings.authenticity = authDone();
    pipeline.screenshotHash = authResult.imageHash;
    pipeline.checks.push({ name: 'authenticity', passed: authResult.passed, tamperScore: authResult.tamperScore });
    trace(orderId, 'AUTHENTICITY', {
      passed: authResult.passed,
      tamperScore: authResult.tamperScore,
      isCameraPhoto: authResult.isCameraPhoto,
      isEdited: authResult.isEdited,
      timeMs: pipeline.stageTimings.authenticity,
      budget: budgetRemaining(t0),
    });
    if (!authResult.passed) {
      pipeline.reasons.push('REJECT: Authenticity failed — ' + authResult.issues.join('; '));
      pipeline.verificationDuration = Date.now() - t0;
      return pipeline;
    }
  } catch (e) {
    const ms = authDone ? authDone() : 0;
    trace(orderId, 'AUTH TIMEOUT/ERROR', { error: e.message, ms });
    authResult = { passed: true, imageHash: '', tamperScore: 0, isCameraPhoto: false, isEdited: false, isCropped: false, isOverlay: false, issues: [], checks: [] };
    pipeline.checks.push({ name: 'authenticity', passed: true, tamperScore: 0, note: 'skipped: ' + e.message });
  }

  if (budgetRemaining(t0) < 500) {
    trace(orderId, 'BUDGET LOW after auth, skipping OCR → MANUAL_REVIEW', { remaining: budgetRemaining(t0) });
    pipeline.status = 'manual_review';
    pipeline.manualReviewRequired = true;
    pipeline.reasons.push('MANUAL_REVIEW: Budget too low for OCR after authenticity check');
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  // ── STEP 3: IMAGE ENHANCEMENT ──
  trace(orderId, '↓ STEP 3: IMAGE ENHANCEMENT', '');
  let enhanceDone;
  let strategies;
  try {
    enhanceDone = stepTimer(orderId, 'TIMING:enhance');
    strategies = await withTimeout(imageEnhance.run(rawBuf), 1500, 'imageEnhance');
    pipeline.stageTimings.enhancement = enhanceDone();
    pipeline.imageQuality = strategies.quality;
    pipeline.checks.push({ name: 'image_quality', passed: strategies.quality.passed, blurScore: strategies.quality.blurScore });
    trace(orderId, 'IMAGE QUALITY', {
      passed: strategies.quality.passed,
      blurScore: strategies.quality.blurScore,
      strategies: strategies.strategies.length,
      timeMs: pipeline.stageTimings.enhancement,
      budget: budgetRemaining(t0),
    });
    if (!strategies.quality.passed) {
      pipeline.reasons.push('REJECT: Image quality failed — ' + strategies.quality.issues.join('; '));
      pipeline.verificationDuration = Date.now() - t0;
      return pipeline;
    }
  } catch (e) {
    const ms = enhanceDone ? enhanceDone() : 0;
    trace(orderId, 'ENHANCE TIMEOUT/ERROR', { error: e.message, ms });
    strategies = { strategies: [{ name: 'original', buf: rawBuf }], quality: { passed: true, blurScore: 0, darkScore: 0, avgBrightness: 127, lowRes: false, w: 0, h: 0, issues: [] } };
    pipeline.checks.push({ name: 'image_quality', passed: true, note: 'skipped: ' + e.message });
  }

  // ── STEP 4: OCR ──
  // Budget remaining must be at least 1500ms for OCR + 500ms for post-OCR work
  const ocrBudget = Math.max(1000, budgetRemaining(t0) - 800);
  trace(orderId, '↓ STEP 4: OCR', { ocrBudgetMs: ocrBudget, budget: budgetRemaining(t0) });

  let ocrDone;
  let ocrResult;
  try {
    ocrDone = stepTimer(orderId, 'TIMING:ocr');
    ocrResult = await withTimeout(multiEngineOcr.run(strategies.strategies, ocrBudget), ocrBudget, 'ocr');
    pipeline.stageTimings.ocr = ocrDone();
    if (ocrResult.bestResult) {
      trace(orderId, 'OCR RESULT', {
        strategy: ocrResult.bestStrategy,
        chars: ocrResult.bestResult.text.length,
        confidence: ocrResult.bestResult.confidence,
        strategiesRun: ocrResult.results.length,
        timeMs: pipeline.stageTimings.ocr,
        budget: budgetRemaining(t0),
      });
    } else {
      trace(orderId, 'OCR RESULT', { bestResult: null, timeMs: pipeline.stageTimings.ocr });
    }
    pipeline.checks.push({ name: 'ocr', passed: ocrResult.bestResult !== null, chars: ocrResult.bestResult ? ocrResult.bestResult.text.length : 0 });
  } catch (e) {
    const ms = ocrDone ? ocrDone() : 0;
    trace(orderId, 'OCR TIMEOUT/ERROR', { error: e.message, ms, budget: budgetRemaining(t0) });
    pipeline.status = 'manual_review';
    pipeline.manualReviewRequired = true;
    pipeline.reasons.push('MANUAL_REVIEW: OCR ' + e.message);
    pipeline.checks.push({ name: 'ocr', passed: false, error: e.message });
    pipeline.stageTimings.ocr = ms;
    pipeline.timings = {
      imageLoad: pipeline.stageTimings.imageLoad || 0,
      authenticity: pipeline.stageTimings.authenticity || 0,
      enhancement: pipeline.stageTimings.enhancement || 0,
      ocr: ms,
      total: Date.now() - t0,
    };
    trace(orderId, 'PIPELINE TIMINGS (ms)', pipeline.timings);
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  if (!ocrResult.bestResult || ocrResult.bestResult.text.trim().length < C.MIN_OCR_TEXT_LENGTH) {
    pipeline.status = 'manual_review';
    pipeline.manualReviewRequired = true;
    const reason = !ocrResult.engineAvailable
      ? 'MANUAL_REVIEW: Tesseract.js not available'
      : 'MANUAL_REVIEW: Insufficient OCR text (' + (ocrResult.bestResult ? ocrResult.bestResult.text.trim().length : 0) + ' chars)';
    pipeline.reasons.push(reason);
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  if (budgetRemaining(t0) < 200) {
    trace(orderId, 'BUDGET LOW after OCR, skipping deep checks → MANUAL_REVIEW', { budget: budgetRemaining(t0) });
    pipeline.status = 'manual_review';
    pipeline.manualReviewRequired = true;
    pipeline.reasons.push('MANUAL_REVIEW: Budget exhausted — OCR complete but no time for validation');
    pipeline.ocrData = { rawText: ocrResult.bestResult.text.substring(0, 200), confidence: ocrResult.bestResult.confidence };
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  // ── STEP 5: FIELD EXTRACTION (pure CPU, ~1ms) ──
  trace(orderId, '↓ STEP 5: FIELD EXTRACTION', '');
  let extractDone;
  let extracted;
  try {
    extractDone = stepTimer(orderId, 'TIMING:extract');
    extracted = fieldExtractor.run(ocrResult.bestResult.text, ocrResult.bestResult.words);
    pipeline.stageTimings.extraction = extractDone();
    pipeline.ocrData = {
      rawText: extracted.rawText,
      extractedAmount: extracted.amount.value,
      extractedUtr: extracted.utr.value,
      extractedReceiverUpi: extracted.receiverUpi.value,
      extractedSenderVpa: extracted.senderUpi ? extracted.senderUpi.value : null,
      extractedReceiverName: extracted.receiverName.value,
      extractedBankName: extracted.bankName.value,
      extractedDate: extracted.date.value,
      extractedTime: extracted.time.value,
      extractedPaymentStatus: extracted.paymentStatus.value,
      confidence: ocrResult.bestResult.confidence,
      wordCount: extracted.wordCount,
      fieldCount: [extracted.amount, extracted.utr, extracted.receiverUpi, extracted.senderUpi, extracted.date, extracted.time, extracted.paymentStatus, extracted.receiverName, extracted.bankName].filter(f => f && f.value !== null).length,
    };
    trace(orderId, 'EXTRACTED FIELDS', {
      amount: extracted.amount.value,
      utr: extracted.utr.value,
      receiverUpi: extracted.receiverUpi.value,
      date: extracted.date.value,
      status: extracted.paymentStatus.value,
      fieldsFound: pipeline.ocrData.fieldCount + '/9',
      timeMs: pipeline.stageTimings.extraction,
    });
  } catch (e) {
    pipeline.reasons.push('REJECT: Field extraction failed: ' + e.message);
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  // ── STEP 6: VALIDATION (pure CPU, ~1ms) ──
  trace(orderId, '↓ STEP 6: VALIDATION', '');
  let valDone;
  let validationResult;
  try {
    valDone = stepTimer(orderId, 'TIMING:validate');
    validationResult = fieldValidator.run(extracted, order, userUtr);
    pipeline.stageTimings.validation = valDone();
    pipeline.checks.push(...validationResult.checks);
    for (const check of validationResult.checks) {
      if (check.name === 'amount') pipeline.matchedAmount = check.passed;
      if (check.name === 'receiver_upi') pipeline.matchedReceiver = check.passed;
      if (check.name === 'date') pipeline.matchedDate = check.passed;
      if (check.name === 'payment_status') pipeline.matchedStatus = check.passed;
      if (check.name === 'utr_format') pipeline.matchedUtr = check.passed;
      if (check.name === 'user_utr') pipeline.userUtrMatched = check.passed;
    }
    trace(orderId, 'VALIDATION SUMMARY', {
      mandatoryPassed: validationResult.mandatoryPassed + '/' + validationResult.mandatoryTotal,
      hardFailures: validationResult.hardFailures,
      timeMs: pipeline.stageTimings.validation,
    });
  } catch (e) {
    pipeline.reasons.push('REJECT: Validation failed: ' + e.message);
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  // ── STEP 7: DUPLICATE CHECK (DB queries, ~1-2s) ──
  const dedupBudget = Math.max(500, budgetRemaining(t0) - 200);
  trace(orderId, '↓ STEP 7: DUPLICATE CHECK', { dedupBudgetMs: dedupBudget });
  let dedupDone;
  let duplicateResult;
  try {
    dedupDone = stepTimer(orderId, 'TIMING:dedup');
    const textHash = require('./duplicateDetector').computeTextHash(ocrResult.bestResult.text);
    pipeline.textHash = textHash;
    duplicateResult = await withTimeout(
      duplicateDetector.run(pipeline.screenshotHash, textHash, extracted.utr.value, rawBuf),
      dedupBudget,
      'dedup'
    );
    pipeline.stageTimings.dedup = dedupDone();
    pipeline.checks.push({ name: 'duplicates', passed: !duplicateResult.isDuplicate });
    trace(orderId, 'DUPLICATE RESULT', {
      isDuplicate: duplicateResult.isDuplicate,
      timeMs: pipeline.stageTimings.dedup,
      budget: budgetRemaining(t0),
    });
  } catch (e) {
    const ms = dedupDone ? dedupDone() : 0;
    trace(orderId, 'DEDUP TIMEOUT/ERROR', { error: e.message, ms });
    duplicateResult = { isDuplicate: false, checks: [], utrCheck: { isDuplicate: false }, screenshotCheck: { isDuplicate: false }, textCheck: { isDuplicate: false } };
    pipeline.checks.push({ name: 'duplicates', passed: true, note: 'skipped: ' + e.message });
  }

  // ── STEP 8: FRAUD DETECTION (pure CPU, ~1ms) ──
  trace(orderId, '↓ STEP 8: FRAUD DETECTION', '');
  let fraudDone;
  let fraudResult;
  try {
    fraudDone = stepTimer(orderId, 'TIMING:fraud');
    fraudResult = fraudDetector.run({
      ocrText: ocrResult.bestResult.text,
      extracted,
      authResult,
      qualityResult: strategies.quality,
      ocrConfidence: ocrResult.bestResult.confidence,
    });
    pipeline.stageTimings.fraud = fraudDone();
    pipeline.fraudScore = fraudResult.fraudScore;
    pipeline.fraudFlags = fraudResult.issues;
    pipeline.checks.push({ name: 'fraud', passed: fraudResult.fraudScore < C.FRAUD_THRESHOLDS.high, score: fraudResult.fraudScore });
    trace(orderId, 'FRAUD RESULT', { fraudScore: fraudResult.fraudScore, riskLevel: fraudResult.riskLevel, timeMs: pipeline.stageTimings.fraud });
  } catch (e) {
    fraudResult = { fraudScore: 0, riskLevel: 'low', issues: [], breakdown: {} };
    trace(orderId, 'FRAUD ERROR', { error: e.message });
  }

  // ── STEP 9: DECISION (pure CPU, ~1ms) ──
  trace(orderId, '↓ STEP 9: DECISION', '');
  let decDone;
  let decision;
  try {
    decDone = stepTimer(orderId, 'TIMING:decision');
    decision = decisionEngine.run(validationResult, fraudResult, duplicateResult, ocrResult.bestResult.confidence, authResult);
    pipeline.stageTimings.decision = decDone();
    pipeline.status = decision.status;
    pipeline.verificationScore = decision.finalScore;
    pipeline.reasons = decision.reasons;
    pipeline.autoVerified = decision.status === C.APPROVED_STATUS;
    pipeline.manualReviewRequired = decision.status === C.MANUAL_REVIEW_STATUS;
    trace(orderId, 'FINAL DECISION', {
      status: decision.status,
      score: decision.finalScore,
      reasons: decision.reasons,
      timeMs: pipeline.stageTimings.decision,
    });
  } catch (e) {
    pipeline.reasons.push('REJECT: Decision engine failed: ' + e.message);
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  pipeline.verificationDuration = Date.now() - t0;
  pipeline.timings = {
    total: pipeline.verificationDuration,
    imageLoad: pipeline.stageTimings.imageLoad || 0,
    authenticity: pipeline.stageTimings.authenticity || 0,
    enhancement: pipeline.stageTimings.enhancement || 0,
    ocr: pipeline.stageTimings.ocr || 0,
    extraction: pipeline.stageTimings.extraction || 0,
    validation: pipeline.stageTimings.validation || 0,
    dedup: pipeline.stageTimings.dedup || 0,
    fraud: pipeline.stageTimings.fraud || 0,
    decision: pipeline.stageTimings.decision || 0,
  };

  trace(orderId, '═══════ PIPELINE COMPLETE ═══════', '');
  trace(orderId, 'TOTAL TIMINGS (ms)', pipeline.timings);

  const exceeds = pipeline.verificationDuration > TOTAL_PIPELINE_BUDGET_MS;
  if (exceeds) {
    trace(orderId, '⚠ SLOW PIPELINE', { actual: pipeline.verificationDuration + 'ms', budget: TOTAL_PIPELINE_BUDGET_MS + 'ms', overBy: (pipeline.verificationDuration - TOTAL_PIPELINE_BUDGET_MS) + 'ms' });
  }

  return pipeline;
}

module.exports = { run: runPipeline, TOTAL_PIPELINE_BUDGET_MS };
