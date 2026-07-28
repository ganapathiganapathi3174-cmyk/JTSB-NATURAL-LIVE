const C = require('./config.js');
const uploadValidator = require('./uploadValidator.js');
const imageProcessor = require('./imageProcessor.js');
const ocrService = require('./ocrService.js');
const fieldExtractor = require('./fieldExtractor.js');
const fieldNormalizer = require('./fieldNormalizer.js');
const businessValidator = require('./businessValidator.js');
const duplicateDetector = require('./duplicateDetector.js');
const fraudDetector = require('./fraudDetector.js');
const decisionEngine = require('./decisionEngine.js');
const auditLogger = require('./auditLogger.js');
const crypto = require('crypto');

async function run(order, screenshotUrl, userId, userUtr, userUpi, screenshotBuf) {
  const t0 = Date.now();
  const logId = (order && order.id) || (order && order.orderId) || 'unknown';
  const stages = [];

  try {
    const imageBuffer = screenshotBuf || await fetchBuffer(screenshotUrl);
    if (!imageBuffer || imageBuffer.length === 0) throw new Error('No image data');

    stages.push({ name: 'upload_validation', t: Date.now() - t0 });
    const uploadCheck = await uploadValidator.validate(imageBuffer);
    if (!uploadCheck.valid) {
      const out = mkOut('rejected', 0, null, null, uploadCheck.issues, stages, t0, null, null, null);
      await auditLogger.record(out);
      return out;
    }

    stages.push({ name: 'image_processing', t: Date.now() - t0 });
    const processed = await imageProcessor.process(imageBuffer);

    stages.push({ name: 'ocr', t: Date.now() - t0 });
    const ocrResult = await ocrService.runMultiEngineOcr(processed.buffer, screenshotUrl);
    if (ocrResult.raw.trim().length < C.MIN_TEXT_LENGTH) {
      const out = mkOut('manual_review', 0, ocrResult, null, ['OCR returned insufficient text'], stages, t0, processed, null, null);
      await auditLogger.record(out);
      return out;
    }

    stages.push({ name: 'field_extraction', t: Date.now() - t0 });
    const extracted = fieldExtractor.extract(ocrResult);

    stages.push({ name: 'field_normalization', t: Date.now() - t0 });
    const normalized = fieldNormalizer.normalize(extracted);

    const expected = userUtr ? { amount: order && order.amount, utr: userUtr } : { amount: order && order.amount };

    stages.push({ name: 'business_validation', t: Date.now() - t0 });
    const businessResult = businessValidator.validate(normalized, expected);

    stages.push({ name: 'duplicate_detection', t: Date.now() - t0 });
    let dupResult = { duplicateUtr: false, duplicateImage: false, existingPayment: null };
    try { dupResult = await duplicateDetector.check(normalized.utr, imageBuffer, userId); } catch (e) { }

    stages.push({ name: 'fraud_detection', t: Date.now() - t0 });
    const fraudResult = fraudDetector.detect(imageBuffer, normalized, userId, 0);

    stages.push({ name: 'decision', t: Date.now() - t0 });
    const decision = decisionEngine.decide(businessResult, dupResult, fraudResult, ocrResult.confidence);

    const out = mkOut(decision.status, decision.confidence, ocrResult, extracted, decision.reasons, stages, t0, processed, normalized, businessResult, dupResult, fraudResult);

    stages.push({ name: 'audit', t: Date.now() - t0 });
    try {
      await auditLogger.record({
        ...out,
        paymentId: logId,
        userId,
        ocrConfidence: ocrResult.confidence,
        normalized,
        fraudScore: fraudResult.score,
        imageHash: crypto.createHash('sha256').update(imageBuffer).digest('hex').substring(0, 16),
      });
    } catch (e) { }

    return out;
  } catch (err) {
    const out = mkOut('manual_review', 0, null, null, ['Engine error: ' + err.message], stages, t0, null, null, null);
    try { await auditLogger.record({ ...out, paymentId: logId, userId }); } catch (e) { }
    return out;
  }
}

function mkOut(status, confidence, ocrResult, extracted, reasons, stages, t0, processed, normalized, businessResult, dupResult, fraudResult) {
  return {
    status,
    confidence,
    ocrData: ocrResult ? {
      raw: ocrResult.raw ? ocrResult.raw.substring(0, 1000) : '',
      confidence: ocrResult.confidence,
      engines: ocrResult.engines || [],
      fields: ocrResult.fields || {},
    } : null,
    extractedFields: extracted ? {
      amount: extracted.amount ? extracted.amount.value : null,
      utr: extracted.utr ? extracted.utr.value : null,
      upi: extracted.upi ? extracted.upi.value : null,
      name: extracted.name ? extracted.name.value : null,
      date: extracted.date ? extracted.date.value : null,
      time: extracted.time ? extracted.time.value : null,
      status: extracted.status ? extracted.status.value : null,
    } : null,
    reasons: reasons || [],
    stages: stages.map(s => ({ name: s.name, ms: Date.now() - t0 - (stages.length > 1 ? stages[Math.max(0, stages.indexOf(s) - 1)]?.t || 0 : 0) })),
    checks: {
      format: processed ? { width: processed.dimensions?.width, height: processed.dimensions?.height } : null,
      ocr: ocrResult ? { confidence: ocrResult.confidence, engines: ocrResult.engines?.length } : null,
      business: businessResult ? { hardFails: businessResult.hardFails, softFails: businessResult.softFails } : null,
      duplicate: dupResult || null,
      fraud: fraudResult ? { score: fraudResult.score, flags: fraudResult.flags } : null,
    },
    normalizedFields: normalized || null,
    totalMs: Date.now() - t0,
  };
}

async function fetchBuffer(url) {
  if (!url) throw new Error('No URL provided');
  const http = require(url.startsWith('https') ? 'https' : 'http');
  return new Promise((resolve, reject) => {
    http.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) { reject(new Error('HTTP ' + res.statusCode)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('Timeout')); });
  });
}

module.exports = { run };
