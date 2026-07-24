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

async function fetchBuffer(url) {
  const https = require('https');
  const http = require('http');
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(url, { timeout: 20000 }, (res) => {
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

  if (!screenshotUrl) {
    pipeline.reasons.push('No screenshot provided');
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  const expectedAmount = Number(order.amount) || 0;
  if (!expectedAmount || !C.ALLOWED_AMOUNTS.includes(expectedAmount)) {
    pipeline.reasons.push('Invalid amount: ' + expectedAmount + '. Allowed: ' + C.ALLOWED_AMOUNTS.join(', '));
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  log.info(orderId, 'Starting 13-stage verification pipeline');
  log.info(orderId, 'Amount=' + expectedAmount + ', Type=' + (order.type || 'unknown'));

  // Stage 1: Fetch & Authenticity
  let rawBuf;
  try {
    const t = Date.now();
    rawBuf = await fetchBuffer(screenshotUrl);
    pipeline.stageTimings.imageLoad = Date.now() - t;
    log.info(orderId, 'Image fetched: ' + rawBuf.length + ' bytes (' + pipeline.stageTimings.imageLoad + 'ms)');
  } catch (e) {
    pipeline.reasons.push('Could not fetch screenshot: ' + e.message);
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
    log.info(orderId, 'Authenticity: tamper=' + authResult.tamperScore + ' pass=' + authResult.passed);
    if (!authResult.passed) {
      pipeline.reasons.push(...authResult.issues);
      pipeline.verificationDuration = Date.now() - t0;
      return pipeline;
    }
  } catch (e) {
    log.error(orderId, 'Stage 1 failed: ' + e.message);
    pipeline.reasons.push('Image authenticity check failed');
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  // Stage 2: Image Enhancement
  let strategies;
  try {
    const t = Date.now();
    strategies = await imageEnhance.run(rawBuf);
    pipeline.stageTimings.enhancement = Date.now() - t;
    pipeline.imageQuality = strategies.quality;
    pipeline.checks.push({ name: 'image_quality', passed: strategies.quality.passed, blurScore: strategies.quality.blurScore, darkScore: strategies.quality.darkScore });
    log.info(orderId, 'Enhancement: ' + strategies.strategies.length + ' strategies, quality=' + strategies.quality.passed);
    if (!strategies.quality.passed) {
      pipeline.reasons.push(...strategies.quality.issues);
      pipeline.verificationDuration = Date.now() - t0;
      return pipeline;
    }
  } catch (e) {
    log.error(orderId, 'Stage 2 failed: ' + e.message);
    pipeline.reasons.push('Image enhancement failed');
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  // Stage 3: Multi-Engine OCR
  let ocrResult;
  try {
    const t = Date.now();
    ocrResult = await multiEngineOcr.run(strategies.strategies);
    pipeline.stageTimings.ocr = Date.now() - t;
    pipeline.checks.push({ name: 'ocr', passed: ocrResult.bestResult !== null, chars: ocrResult.bestResult ? ocrResult.bestResult.text.length : 0, confidence: ocrResult.bestResult ? ocrResult.bestResult.confidence : 0 });
    if (!ocrResult.bestResult || ocrResult.bestResult.text.trim().length < C.MIN_OCR_TEXT_LENGTH) {
      pipeline.reasons.push('OCR could not extract sufficient text from screenshot');
      pipeline.verificationDuration = Date.now() - t0;
      return pipeline;
    }
    log.info(orderId, 'OCR: ' + ocrResult.bestResult.text.length + ' chars, conf=' + Math.round(ocrResult.bestResult.confidence) + '%');
  } catch (e) {
    log.error(orderId, 'Stage 3 failed: ' + e.message);
    pipeline.reasons.push('OCR processing failed');
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  // Stage 4: Field Extraction
  let extracted;
  try {
    const t = Date.now();
    extracted = fieldExtractor.run(ocrResult.bestResult.text, ocrResult.bestResult.words);
    pipeline.stageTimings.extraction = Date.now() - t;
    pipeline.ocrData = {
      rawText: extracted.rawText,
      extractedAmount: extracted.amount.value,
      extractedUtr: extracted.utr.value,
      extractedSenderVpa: extracted.receiverUpi.value,
      extractedReceiverName: extracted.receiverName.value,
      extractedBankName: extracted.bankName.value,
      extractedDate: extracted.date.value,
      extractedTime: extracted.time.value,
      extractedPaymentStatus: extracted.paymentStatus.value,
      confidence: ocrResult.bestResult.confidence,
      wordCount: extracted.wordCount,
      fieldCount: [extracted.amount, extracted.utr, extracted.receiverUpi, extracted.date, extracted.time, extracted.paymentStatus, extracted.receiverName, extracted.bankName].filter(f => f.value !== null).length,
    };
    log.info(orderId, 'Extraction: ' + pipeline.ocrData.fieldCount + '/8 fields');
  } catch (e) {
    log.error(orderId, 'Stage 4 failed: ' + e.message);
    pipeline.reasons.push('Field extraction failed');
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  // Stage 5-10: Validation
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
    log.info(orderId, 'Validation: ' + validationResult.mandatoryPassed + '/' + validationResult.mandatoryTotal + ' mandatory');
  } catch (e) {
    log.error(orderId, 'Stage 5-10 failed: ' + e.message);
    pipeline.reasons.push('Validation failed');
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  // Stage 11: Duplicate Detection
  let duplicateResult;
  try {
    const t = Date.now();
    const textHash = require('./duplicateDetector').computeTextHash(ocrResult.bestResult.text);
    pipeline.textHash = textHash;
    duplicateResult = await duplicateDetector.run(pipeline.screenshotHash, textHash, extracted.utr.value, rawBuf);
    pipeline.stageTimings.dedup = Date.now() - t;
    pipeline.checks.push({ name: 'duplicates', passed: !duplicateResult.isDuplicate });
    log.info(orderId, 'Duplicates: ' + duplicateResult.isDuplicate);
  } catch (e) {
    log.error(orderId, 'Stage 11 failed: ' + e.message);
    pipeline.reasons.push('Duplicate check failed');
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  // Stage 12: Fraud Detection
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
    log.info(orderId, 'Fraud: score=' + fraudResult.fraudScore + ' risk=' + fraudResult.riskLevel);
  } catch (e) {
    log.error(orderId, 'Stage 12 failed: ' + e.message);
    pipeline.reasons.push('Fraud detection failed');
    pipeline.verificationDuration = Date.now() - t0;
    return pipeline;
  }

  // Stage 13: Decision
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
    log.info(orderId, 'Decision: ' + decision.status + ' (score=' + decision.finalScore + '%)');
  } catch (e) {
    log.error(orderId, 'Stage 13 failed: ' + e.message);
    pipeline.reasons.push('Decision engine failed');
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

  log.info(orderId, 'Pipeline complete: ' + pipeline.status + ' (score=' + pipeline.verificationScore + '%, ' + pipeline.verificationDuration + 'ms)');
  log.info(orderId, 'Timings: auth=' + pipeline.timings.authenticity + ' enhance=' + pipeline.timings.enhancement + ' ocr=' + pipeline.timings.ocr + ' extract=' + pipeline.timings.extraction + ' validate=' + pipeline.timings.validation + ' dedup=' + pipeline.timings.dedup + ' fraud=' + pipeline.timings.fraud + ' decide=' + pipeline.timings.decision);
  return pipeline;
}

module.exports = { run: runPipeline };
