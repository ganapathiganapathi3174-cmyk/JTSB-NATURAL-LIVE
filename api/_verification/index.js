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

function trace(orderId, label, data) {
  const ts = new Date().toISOString().slice(11, 23);
  const summary = typeof data === 'string' ? data : JSON.stringify(data, null, 0);
  console.log('[TRACE] [' + ts + '] [' + orderId + '] ' + label + ' ' + summary);
}

async function fetchBuffer(url) {
  const https = require('https');
  const http = require('http');
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) { reject(new Error('HTTP ' + res.statusCode)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', function () { this.destroy(); reject(new Error('Timeout fetching screenshot')); });
  });
}

async function runPipeline(order, screenshotUrl, userId, userUtr) {
  const t0 = Date.now();
  const orderId = order.id || 'unknown';

  trace(orderId, '═══════════════════════════════════════════════════', '');
  trace(orderId, 'UPLOAD RECEIVED', '');

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
    testPaymentAmount: C.TEST_PAYMENT_AMOUNT,
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
    trace(orderId, 'DECISION: REJECTED', 'Invalid expected amount ' + expectedAmount + ' not in allowed list [' + C.ALLOWED_AMOUNTS.join(',') + ']');
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  trace(orderId, 'EXPECTED VALUES', {
    expectedAmount: expectedAmount,
    expectedUpi: C.EXPECTED_RECEIVER_UPI,
    expectedReceiverName: C.EXPECTED_RECEIVER_NAME,
    allowedAmounts: C.ALLOWED_AMOUNTS,
  });

  trace(orderId, '↓ IMAGE PREPROCESSING', '');

  let rawBuf;
  try {
    const t = Date.now();
    rawBuf = await fetchBuffer(screenshotUrl);
    pipeline.stageTimings.imageLoad = Date.now() - t;
    trace(orderId, 'IMAGE FETCHED', { bytes: rawBuf.length, timeMs: pipeline.stageTimings.imageLoad });
  } catch (e) {
    pipeline.reasons.push('REJECT: Could not fetch screenshot: ' + e.message);
    trace(orderId, 'DECISION: REJECTED', 'Image fetch failed: ' + e.message);
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  let authResult;
  try {
    const t = Date.now();
    authResult = await imageAuth.run(rawBuf);
    pipeline.stageTimings.authenticity = Date.now() - t;
    pipeline.screenshotHash = authResult.imageHash;
    pipeline.checks.push({ name: 'authenticity', passed: authResult.passed, tamperScore: authResult.tamperScore });
    trace(orderId, 'AUTHENTICITY', {
      passed: authResult.passed,
      tamperScore: authResult.tamperScore,
      isCameraPhoto: authResult.isCameraPhoto,
      isEdited: authResult.isEdited,
      isCropped: authResult.isCropped,
      isOverlay: authResult.isOverlay,
      dimensions: authResult.dimensions,
      hash: (authResult.imageHash || '').substring(0, 16) + '...',
      issues: authResult.issues,
      timeMs: pipeline.stageTimings.authenticity,
    });
    if (!authResult.passed) {
      pipeline.reasons.push('REJECT: Authenticity failed — ' + authResult.issues.join('; '));
      trace(orderId, 'DECISION: REJECTED', 'Authenticity check failed: ' + JSON.stringify(authResult.issues));
      pipeline.verificationDuration = Date.now() - t0;
      return pipeline;
    }
  } catch (e) {
    pipeline.reasons.push('REJECT: Authenticity check exception: ' + e.message);
    trace(orderId, 'DECISION: REJECTED', 'Authenticity exception: ' + e.message);
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  let strategies;
  try {
    const t = Date.now();
    strategies = await imageEnhance.run(rawBuf);
    pipeline.stageTimings.enhancement = Date.now() - t;
    pipeline.imageQuality = strategies.quality;
    pipeline.checks.push({ name: 'image_quality', passed: strategies.quality.passed, blurScore: strategies.quality.blurScore, darkScore: strategies.quality.darkScore });
    trace(orderId, 'IMAGE QUALITY', {
      passed: strategies.quality.passed,
      blurScore: strategies.quality.blurScore,
      darkScore: strategies.quality.darkScore,
      avgBrightness: strategies.quality.avgBrightness,
      lowRes: strategies.quality.lowRes,
      dimensions: strategies.quality.w + 'x' + strategies.quality.h,
      strategies: strategies.strategies.map(s => s.name),
      timeMs: pipeline.stageTimings.enhancement,
      issues: strategies.quality.issues,
    });
    if (!strategies.quality.passed) {
      pipeline.reasons.push('REJECT: Image quality failed — ' + strategies.quality.issues.join('; '));
      trace(orderId, 'DECISION: REJECTED', 'Quality check failed: ' + JSON.stringify(strategies.quality.issues));
      pipeline.verificationDuration = Date.now() - t0;
      return pipeline;
    }
  } catch (e) {
    pipeline.reasons.push('REJECT: Image enhancement exception: ' + e.message);
    trace(orderId, 'DECISION: REJECTED', 'Enhancement exception: ' + e.message);
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  trace(orderId, '↓ OCR OUTPUT', '');

  let ocrResult;
  try {
    const t = Date.now();
    ocrResult = await multiEngineOcr.run(strategies.strategies);
    pipeline.stageTimings.ocr = Date.now() - t;
    if (ocrResult.bestResult) {
      trace(orderId, 'OCR RESULT', {
        strategy: ocrResult.bestStrategy,
        totalChars: ocrResult.bestResult.text.length,
        confidence: ocrResult.bestResult.confidence,
        wordCount: ocrResult.bestResult.wordCount,
        textPreview: ocrResult.bestResult.text.substring(0, 300),
        strategiesRun: ocrResult.results.length,
        timeMs: pipeline.stageTimings.ocr,
      });
    } else {
      trace(orderId, 'OCR RESULT', { bestResult: null, strategiesRun: ocrResult.results.length, timeMs: pipeline.stageTimings.ocr, engineAvailable: ocrResult.engineAvailable });
    }
    pipeline.checks.push({ name: 'ocr', passed: ocrResult.bestResult !== null, chars: ocrResult.bestResult ? ocrResult.bestResult.text.length : 0, confidence: ocrResult.bestResult ? ocrResult.bestResult.confidence : 0 });
    if (!ocrResult.bestResult || ocrResult.bestResult.text.trim().length < C.MIN_OCR_TEXT_LENGTH) {
      const reason = !ocrResult.engineAvailable
        ? 'REJECT: Tesseract.js engine not available'
        : 'REJECT: OCR extracted insufficient text (' + (ocrResult.bestResult ? ocrResult.bestResult.text.trim().length : 0) + ' chars, need ' + C.MIN_OCR_TEXT_LENGTH + ')';
      pipeline.reasons.push(reason);
      trace(orderId, 'DECISION: REJECTED', reason);
      pipeline.verificationDuration = Date.now() - t0;
      return pipeline;
    }
  } catch (e) {
    pipeline.reasons.push('REJECT: OCR exception: ' + e.message);
    trace(orderId, 'DECISION: REJECTED', 'OCR exception: ' + e.message);
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  trace(orderId, '↓ NORMALIZED VALUES', '');

  let extracted;
  try {
    const t = Date.now();
    extracted = fieldExtractor.run(ocrResult.bestResult.text, ocrResult.bestResult.words);
    pipeline.stageTimings.extraction = Date.now() - t;
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
      amount: { value: extracted.amount.value, source: extracted.amount.source, confidence: extracted.amount.confidence },
      utr: { value: extracted.utr.value, source: extracted.utr.source, confidence: extracted.utr.confidence },
      receiverUpi: { value: extracted.receiverUpi.value, source: extracted.receiverUpi.source, confidence: extracted.receiverUpi.confidence },
      senderUpi: { value: extracted.senderUpi ? extracted.senderUpi.value : null, source: extracted.senderUpi ? extracted.senderUpi.source : 'none', confidence: extracted.senderUpi ? extracted.senderUpi.confidence : 'none' },
      date: { value: extracted.date.value, source: extracted.date.source, confidence: extracted.date.confidence },
      time: { value: extracted.time.value, source: extracted.time.source, confidence: extracted.time.confidence },
      paymentStatus: { value: extracted.paymentStatus.value, source: extracted.paymentStatus.source, confidence: extracted.paymentStatus.confidence },
      receiverName: { value: extracted.receiverName.value, source: extracted.receiverName.source, confidence: extracted.receiverName.confidence },
      bankName: { value: extracted.bankName.value, source: extracted.bankName.source, confidence: extracted.bankName.confidence },
      appIdentity: extracted.appIdentity,
      parserConfidence: extracted.parserConfidence,
      totalFieldsFound: pipeline.ocrData.fieldCount + '/9',
    });
  } catch (e) {
    pipeline.reasons.push('REJECT: Field extraction exception: ' + e.message);
    trace(orderId, 'DECISION: REJECTED', 'Extraction exception: ' + e.message);
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  trace(orderId, '↓ VALIDATION RESULTS', '');

  let validationResult;
  try {
    const t = Date.now();
    validationResult = fieldValidator.run(extracted, order, userUtr);
    pipeline.stageTimings.validation = Date.now() - t;
    pipeline.checks.push(...validationResult.checks);
    for (const check of validationResult.checks) {
      if (check.name === 'amount') pipeline.matchedAmount = check.passed;
      if (check.name === 'receiver_upi') pipeline.matchedReceiver = check.passed;
      if (check.name === 'date') pipeline.matchedDate = check.passed;
      if (check.name === 'payment_status') pipeline.matchedStatus = check.passed;
      if (check.name === 'utr_format') pipeline.matchedUtr = check.passed;
      if (check.name === 'user_utr') pipeline.userUtrMatched = check.passed;
    }
    for (const check of validationResult.checks) {
      const extractedVal = check.extractedValue || check.reason || 'N/A';
      const expectedVal = check.expectedValue || 'N/A';
      trace(orderId, '  VALIDATE ' + check.name.toUpperCase(), {
        PASS: check.passed ? 'PASS ✓' : 'FAIL ✗',
        expected: expectedVal,
        extracted: extractedVal,
        score: check.score,
        severity: check.severity,
        reason: check.reason,
        isUserCheck: check.isUserCheck || false,
      });
    }
    trace(orderId, 'VALIDATION SUMMARY', {
      mandatoryPassed: validationResult.mandatoryPassed + '/' + validationResult.mandatoryTotal,
      hardFailures: validationResult.hardFailures,
      softFailures: validationResult.softFailures,
      missingFields: validationResult.missingFields,
      allMandatoryPass: validationResult.allMandatoryPass,
    });
  } catch (e) {
    pipeline.reasons.push('REJECT: Validation exception: ' + e.message);
    trace(orderId, 'DECISION: REJECTED', 'Validation exception: ' + e.message);
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  trace(orderId, '↓ DUPLICATE DETECTION', '');

  let duplicateResult;
  try {
    const t = Date.now();
    const textHash = require('./duplicateDetector').computeTextHash(ocrResult.bestResult.text);
    pipeline.textHash = textHash;
    duplicateResult = await duplicateDetector.run(pipeline.screenshotHash, textHash, extracted.utr.value, rawBuf);
    pipeline.stageTimings.dedup = Date.now() - t;
    pipeline.checks.push({ name: 'duplicates', passed: !duplicateResult.isDuplicate });
    trace(orderId, 'DUPLICATE RESULT', {
      isDuplicate: duplicateResult.isDuplicate,
      utrDuplicate: duplicateResult.utrCheck ? duplicateResult.utrCheck.isDuplicate : false,
      screenshotDuplicate: duplicateResult.screenshotCheck ? duplicateResult.screenshotCheck.isDuplicate : false,
      textDuplicate: duplicateResult.textCheck ? duplicateResult.textCheck.isDuplicate : false,
      timeMs: pipeline.stageTimings.dedup,
    });
  } catch (e) {
    pipeline.reasons.push('REJECT: Duplicate check exception: ' + e.message);
    trace(orderId, 'DECISION: REJECTED', 'Duplicate exception: ' + e.message);
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  trace(orderId, '↓ FRAUD DETECTION', '');

  let fraudResult;
  try {
    const t = Date.now();
    fraudResult = fraudDetector.run({
      ocrText: ocrResult.bestResult.text,
      extracted,
      authResult,
      qualityResult: strategies.quality,
      ocrConfidence: ocrResult.bestResult.confidence,
    });
    pipeline.stageTimings.fraud = Date.now() - t;
    pipeline.fraudScore = fraudResult.fraudScore;
    pipeline.fraudFlags = fraudResult.issues;
    pipeline.checks.push({ name: 'fraud', passed: fraudResult.fraudScore < C.FRAUD_THRESHOLDS.high, score: fraudResult.fraudScore });
    trace(orderId, 'FRAUD RESULT', {
      fraudScore: fraudResult.fraudScore,
      riskLevel: fraudResult.riskLevel,
      flags: fraudResult.issues,
      breakdown: fraudResult.breakdown,
      timeMs: pipeline.stageTimings.fraud,
    });
  } catch (e) {
    pipeline.reasons.push('REJECT: Fraud detection exception: ' + e.message);
    trace(orderId, 'DECISION: REJECTED', 'Fraud exception: ' + e.message);
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  trace(orderId, '↓ SCORE CALCULATION', '');

  let decision;
  try {
    const t = Date.now();
    decision = decisionEngine.run(validationResult, fraudResult, duplicateResult, ocrResult.bestResult.confidence, authResult);
    pipeline.stageTimings.decision = Date.now() - t;
    pipeline.status = decision.status;
    pipeline.verificationScore = decision.finalScore;
    pipeline.reasons = decision.reasons;
    pipeline.autoVerified = decision.status === C.APPROVED_STATUS;
    pipeline.manualReviewRequired = decision.status === C.MANUAL_REVIEW_STATUS;
    trace(orderId, 'SCORE BREAKDOWN', {
      finalScore: decision.finalScore + '%',
      status: decision.status,
      reasons: decision.reasons,
    });
    trace(orderId, '↓ FINAL DECISION', decision.status + ' (score=' + decision.finalScore + '%)');
  } catch (e) {
    pipeline.reasons.push('REJECT: Decision engine exception: ' + e.message);
    trace(orderId, 'DECISION: REJECTED', 'Decision exception: ' + e.message);
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

  trace(orderId, 'PIPELINE TIMINGS (ms)', pipeline.timings);
  trace(orderId, '═══════════════════════════════════════════════════', '');
  return pipeline;
}

module.exports = { run: runPipeline };
