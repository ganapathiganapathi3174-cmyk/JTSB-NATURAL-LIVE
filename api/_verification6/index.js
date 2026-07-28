const C = require('./config.js');
const upload = require('./imageUpload.js');
const validate = require('./imageValidation.js');
const ocr = require('./ocrExtraction.js');
const detect = require('./fieldDetection.js');
const rules = require('./businessValidation.js');
const dedup = require('./duplicateDetection.js');
const decide = require('./decision.js');
const audit = require('./audit.js');

async function run(order, screenshotUrl, userId, userUtr, userUpi, screenshotBuf) {
  const t0 = Date.now();
  const logId = (order && order.id) || (order && order.orderId) || 'unknown';
  const ctx = { paymentId: logId, userId };
  try {
    const image = await upload.upload(order, screenshotUrl, screenshotBuf);
    const imageCheck = await validate.validate(image);
    if (!imageCheck.valid) {
      const out = { status: 'rejected', confidence: 0, ocrData: null, reasons: imageCheck.issues, checks: imageCheck };
      await audit.record({ ...ctx, ...out, rawText: null, extracted: null });
      return out;
    }
    const ocrResult = await ocr.ocr(image);
    if (!ocrResult.raw || ocrResult.raw.trim().length < 5) {
      const out = { status: 'manual_review', confidence: 0, ocrData: null, reasons: ['OCR returned no text'], checks: {} };
      await audit.record({ ...ctx, ...out, rawText: ocrResult.raw, extracted: null });
      return out;
    }
    const fields = detect.extract(ocrResult.raw);
    const expected = userUtr ? { amount: order && order.amount, utr: userUtr } : { amount: order && order.amount };
    const validation = rules.validate(fields, expected);
    let dupResult = { duplicateUtr: false, duplicateImage: false, existingPayment: null };
    try { dupResult = await dedup.check(fields.utr, image.buffer, userId); } catch (e) { }
    const decision = decide.decide(validation, dupResult);
    const out = {
      status: decision.status,
      confidence: decision.confidence,
      ocrData: { raw: ocrResult.raw.substring(0, 500), confidence: ocrResult.confidence, fields },
      reasons: decision.reasons,
      checks: { image: imageCheck, ocrConfidence: ocrResult.confidence, validation, duplicate: dupResult },
      extractedFields: fields,
    };
    try { await audit.record({ ...ctx, ...out, rawText: ocrResult.raw, extracted: fields }); } catch (e) { }
    return out;
  } catch (err) {
    const out = { status: 'manual_review', confidence: 0, ocrData: null, reasons: ['Engine error: ' + err.message], checks: {} };
    try { await audit.record({ ...ctx, ...out, rawText: null, extracted: null }); } catch (e) { }
    return out;
  }
}

module.exports = { run };
