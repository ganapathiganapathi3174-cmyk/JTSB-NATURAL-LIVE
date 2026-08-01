const crypto = require('crypto');
const C = require('./config.js');
const fieldExtractor = require('./fieldExtractor.js');
const fieldNormalizer = require('./fieldNormalizer.js');
const rulesValidator = require('./rulesValidator.js');
const duplicateChecker = require('./duplicateChecker.js');
const fraudDetector = require('./fraudDetector.js');
const decider = require('./decider.js');
const auditLogger = require('./auditLogger.js');

let _imageValidator = null;
let _imageProcessor = null;
let _ocrEngine = null;
let _aiVision = null;
let _phash = null;

function getImageValidator() {
  if (!_imageValidator) _imageValidator = require('./imageValidator.js');
  return _imageValidator;
}

function getImageProcessor() {
  if (!_imageProcessor) _imageProcessor = require('./imageProcessor.js');
  return _imageProcessor;
}

function getOcrEngine() {
  if (!_ocrEngine) _ocrEngine = require('./ocrEngine.js');
  return _ocrEngine;
}

function getAiVision() {
  if (!_aiVision) _aiVision = require('./aiVision.js');
  return _aiVision;
}

function getPhash() {
  if (!_phash) _phash = require('./phash.js');
  return _phash;
}

function modFor(url) {
  return url.startsWith('https') ? require('https') : require('http');
}

function log(msg) {
  console.log(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] [NV] ${msg}`);
}

async function run(order, screenshotUrl, userId, userUtr, userUpi, screenshotBuf) {
  const t0 = Date.now();
  const paymentId = order?.id || order?.orderId || 'unknown';
  log(`START payment=${paymentId} type=${order?.type || '?'} amount=${order?.amount || '?'}`);

  const stages = {};
  const result = {
    status: C.DECISION.MANUAL_REVIEW,
    confidence: 0, ocrConfidence: 0, ocrEngines: 0,
    ocrData: null, extractedFields: null, normalizedFields: null,
    matchResults: {}, reasons: [], fraudScore: 0, fraudFlags: [],
    riskScore: 0, riskLevel: 'low', integrity: null,
    utrHash: null, screenshotHash: null,
    checks: {}, duplicateCheck: null, decisionFactors: {},
    stages: stages,
    durationMs: 0,
  };

  try {
    let buf = screenshotBuf;
    if (!buf && typeof screenshotUrl === 'string' && screenshotUrl.startsWith('data:image')) {
      const m = screenshotUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
      if (m) {
        try { buf = Buffer.from(m[1], 'base64'); log('DATA-URL decoded: ' + buf.length + ' bytes'); }
        catch (e) { log('DATA-URL DECODE FAILED: ' + e.message); }
      }
    }
    if (!buf && screenshotUrl) {
      try {
        const mod = screenshotUrl.startsWith('https') ? require('https') : require('http');
        buf = await new Promise((resolve, reject) => {
          const req = mod.get(screenshotUrl, { timeout: 30000 }, (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) { reject(new Error('HTTP ' + res.statusCode)); return; }
            const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve(Buffer.concat(c)));
          });
          req.on('error', reject); req.on('timeout', function () { this.destroy(); reject(new Error('Timeout')); });
        });
      } catch (e) {
        log('FETCH FAILED: ' + e.message);
        result.status = C.DECISION.MANUAL_REVIEW;
        result.reasons = ['Failed to fetch screenshot: ' + e.message];
        result.durationMs = Date.now() - t0;
        return result;
      }
    }

    stages.upload = { ms: Date.now() - t0 };

    const imgValidation = getImageValidator().validateImage(buf);
    stages.validation = { valid: imgValidation.valid, mime: imgValidation.mime, size: buf?.length || 0, ms: Date.now() - t0 - stages.upload.ms };

    let imgProcessed = { buffer: buf, width: 0, height: 0, processed: false };
    let integrity = { blurred: false, dark: false, score: 0, error: null };
    try {
      imgProcessed = await getImageProcessor().processImage(buf, { contrast: true, normalize: true });
      integrity = await getImageProcessor().detectBlur(buf, imgProcessed.width, imgProcessed.height);
    } catch (e) {
      log('IMAGE PROCESS FAILED: ' + e.message);
    }
    stages.process = { processed: imgProcessed.processed, width: imgProcessed.width, height: imgProcessed.height, integrity, ms: Date.now() - t0 };

    const ocrStart = Date.now();
    const ocrResult = await getOcrEngine().runAllEngines(screenshotUrl, imgProcessed.buffer || buf);
    stages.ocr = { engines: ocrResult.engineCount, avgConfidence: ocrResult.avgConfidence, ms: Date.now() - ocrStart };

    result.ocrEngines = ocrResult.engineCount;
    result.ocrConfidence = ocrResult.avgConfidence;

    log(`OCR: ${ocrResult.engineCount} engines, confidence=${ocrResult.avgConfidence}%`);
    log(`OCR RAW: ${(ocrResult.rawText || '').substring(0, 200)}`);

    const visionStart = Date.now();
    const visionResult = await getAiVision().runAIVision(screenshotUrl);
    stages.vision = { success: visionResult.success, engines: Object.keys(visionResult.engines).filter(k => visionResult.engines[k].success).length, ms: Date.now() - visionStart };

    if (visionResult.success) {
      log(`VISION: ${visionResult.engines.gemini?.success ? 'Gemini ' : ''}${visionResult.engines.gpt4?.success ? 'GPT-4' : ''} success`);
    }

    const extractedFromOcr = fieldExtractor.extractAllFields(ocrResult.combinedText || '');
    const extractedFromVision = visionResult.bestFields || {};
    const extracted = {
      amount: extractedFromOcr.amount || extractedFromVision.amount || null,
      utr: extractedFromOcr.utr || extractedFromVision.utr || null,
      upi_id: extractedFromOcr.upi_id || extractedFromVision.upi_id || null,
      receiver_name: extractedFromOcr.receiver_name || extractedFromVision.receiver_name || null,
      date: extractedFromOcr.date || extractedFromVision.date || null,
      time: extractedFromOcr.time || extractedFromVision.time || null,
      status: extractedFromOcr.status || extractedFromVision.status || null,
      bank_or_app: extractedFromOcr.bank_or_app || extractedFromVision.bank_or_app || null,
    };
    const normalized = fieldNormalizer.normalizeFields(extracted);
    result.extractedFields = extracted;
    result.normalizedFields = normalized;

    log(`FIELDS: amount=${extracted.amount} utr=${extracted.utr} upi=${extracted.upi_id} date=${extracted.date} status=${extracted.status}`);

    const expected = {
      amount: Number(order?.amount) || null,
      utr: userUtr || order?.utr || null,
      upi: userUpi || null,
    };

    const rules = rulesValidator.validateRules(normalized, expected);
    stages.rules = { passed: rules.passed, hardFail: rules.hardFail, softFail: rules.softFail, ms: Date.now() - t0 };
    result.matchResults = rules.checks;
    log(`RULES: passed=${rules.passed} hardFail=${rules.hardFail} softFail=${rules.softFail} checks=${JSON.stringify(rules.checks)}`);

    const duplicate = await duplicateChecker.checkDuplicate(normalized.utr, buf);
    stages.duplicate = { duplicate: duplicate.duplicate, type: duplicate.type, ms: Date.now() - t0 };
    result.duplicateCheck = duplicate.type;
    if (duplicate.duplicate) log(`DUPLICATE: ${duplicate.type}`);

    const fraud = fraudDetector.detectFraud(normalized, {
      width: imgProcessed.width,
      height: imgProcessed.height,
      blurScore: integrity?.score || 0,
      dark: integrity?.dark || false,
    }, { expectedAmount: expected.amount });
    stages.fraud = { score: fraud.score, flags: fraud.flags, ms: Date.now() - t0 };
    result.fraudScore = fraud.score;
    result.fraudFlags = fraud.flags;
    result.integrity = integrity || null;

    const decision = decider.decide(rules, duplicate, fraud, normalized, { expected, ocrConfidence: ocrResult.avgConfidence || 0 });
    stages.decision = { status: decision.status, confidence: decision.confidence, ms: Date.now() - t0 };

    result.status = decision.status;
    result.confidence = decision.confidence;
    result.reasons = decision.reasons;
    result.decisionFactors = decision.decisionFactors;
    result.checks = rules.checks;

    // ── RISK ENGINE ──
    // Composite risk score (0-100). Combines fraud signals, missing evidence,
    // and integrity failures. Higher = riskier.
    let riskScore = fraud.score || 0;
    if (rules.hardFail) riskScore += 30;
    if (rules.softFail) riskScore += 10;
    if (integrity?.blurred) riskScore += 15;
    if (integrity?.dark) riskScore += 12;
    if (duplicate?.duplicate) riskScore = 100;
    riskScore = Math.min(100, riskScore);
    result.riskScore = riskScore;
    result.riskLevel = riskScore >= 60 ? 'high' : (riskScore >= 30 ? 'medium' : 'low');

    // ── FINGERPRINTS ──
    // Persistent hashes written to upi_payments.utr_hash / screenshot_hash so the
    // duplicate checker works across requests and process restarts.
    result.utrHash = normalized?.utr ? crypto.createHash('sha256').update(normalized.utr.toUpperCase()).digest('hex') : null;
    result.screenshotHash = buf && Buffer.isBuffer(buf) ? crypto.createHash('sha256').update(buf).digest('hex') : null;
    result.screenshotPhash = null;
    if (buf && Buffer.isBuffer(buf)) {
      try { result.screenshotPhash = await getPhash().computePhash(buf); } catch (_) {}
    }

    const ocrData = {
      raw: (ocrResult.rawText || '').substring(0, 5000),
      confidence: ocrResult.avgConfidence,
      engines: ocrResult.engineCount,
      fields: normalized,
      vision: visionResult.success ? visionResult.bestFields : null,
    };
    result.ocrData = ocrData;

    log(`DECISION: ${decision.status} confidence=${decision.confidence}% reasons=${decision.reasons.join('; ')}`);

    const auditStart = Date.now();
    await auditLogger.recordAudit(paymentId, result);
    stages.audit = { ms: Date.now() - auditStart };

  } catch (e) {
    log(`ERROR: ${e.message} ${e.stack}`);
    result.status = C.DECISION.MANUAL_REVIEW;
    result.reasons = ['Verification error: ' + e.message];
    result.confidence = 0;
  }

  result.durationMs = Date.now() - t0;
  log(`END payment=${paymentId} status=${result.status} confidence=${result.confidence}% duration=${result.durationMs}ms`);
  return result;
}

module.exports = { run };
