const crypto = require('crypto');
const C = require('./config');
const imageValidator = require('./imageValidator');
const ocr = require('./ocr');
const fieldExtractor = require('./fieldExtractor');
const rulesValidator = require('./rulesValidator');
const duplicateChecker = require('./duplicateChecker');
const decider = require('./decider');
const audit = require('./audit');

function trace(id, msg) {
  console.log('[NUCLEAR] [' + new Date().toISOString().slice(11, 23) + '] [' + (id || '?') + '] ' + msg);
}

function hash(buf) {
  return buf ? crypto.createHash('sha256').update(buf).digest('hex') : '';
}

function fetch(url) {
  if (url.startsWith('data:')) {
    const m = url.match(/^data:[^;]+;base64,(.+)$/);
    return m ? Buffer.from(m[1], 'base64') : null;
  }
  const mod = url.startsWith('https:') ? require('https') : require('http');
  return new Promise((resolve, reject) => {
    const req = mod.get(url, { timeout: C.FETCH_TIMEOUT_MS }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) { reject(new Error('HTTP ' + res.statusCode)); return; }
      const c = [];
      res.on('data', d => c.push(d));
      res.on('end', () => resolve(Buffer.concat(c)));
    });
    req.on('error', reject);
    req.on('timeout', function () { this.destroy(); reject(new Error('timeout')); });
  });
}

async function run(order, screenshotUrl, userId, userUtr, screenshotBuf) {
  try {
  const t0 = Date.now();
  const id = (order && order.id) || '?';
  const amt = Number(order && order.amount) || 0;

  trace(id, 'START amt=' + amt + ' type=' + (order && order.type));

  // Validate amount is allowed
  if (!amt || !C.ALLOWED_AMOUNTS.includes(amt)) {
    return build(C.REJECTED, 0, ['Invalid amount'], { order, t0, id });
  }

  // Step 1: Get image
  let buf;
  try {
    if (screenshotBuf && Buffer.isBuffer(screenshotBuf)) {
      buf = screenshotBuf;
    } else if (screenshotUrl) {
      buf = await fetch(screenshotUrl);
    } else {
      return build(C.REJECTED, 0, ['No screenshot'], { order, t0, id });
    }
  } catch (e) {
    return build(C.REJECTED, 0, ['Fetch failed: ' + e.message], { order, t0, id });
  }

  // Step 2: Validate image
  const ivalid = imageValidator.validate(buf);
  if (!ivalid.ok) {
    return build(C.REJECTED, 0, ['Bad image: ' + ivalid.log.join('; ')], { order, t0, id });
  }

  // Step 3: OCR
  let ocrResult;
  try {
    ocrResult = await ocr.read(buf, C.OCR_TIMEOUT_MS);
  } catch (e) {
    return build(C.MANUAL_REVIEW, 30, ['OCR failed: ' + e.message], { order, t0, id });
  }
  if (!ocrResult || !ocrResult.text || ocrResult.text.length < 10) {
    return build(C.MANUAL_REVIEW, 25, ['Text too short'], { order, t0, id });
  }

  // Step 4: Extract fields
  const fields = fieldExtractor.extract(ocrResult.text);
  trace(id, 'FIELDS amt=' + (fields.amount ? fields.amount.value : '?') + ' utr=' + (fields.utr ? fields.utr.value : '?') + ' upi=' + (fields.receiverUpi ? fields.receiverUpi.value : '?') + ' date=' + (fields.date ? fields.date.value : '?') + ' time=' + (fields.time ? fields.time.value : '?') + ' status=' + (fields.paymentStatus ? fields.paymentStatus.value : '?'));

  // Step 5: Validate rules
  const rules = rulesValidator.run(fields, amt);
  trace(id, 'RULES pass=' + rules.pass + ' hard=' + rules.hard.length + ' soft=' + rules.soft.length);

  // Step 6: Check duplicates
  let dup = { duplicate: false };
  try {
    const utrVal = fields.utr && fields.utr.value;
    dup = await duplicateChecker.run(utrVal, null, hash(buf));
  } catch (_) {}
  trace(id, 'DUP=' + dup.duplicate);

  // Step 7: Decide
  const decision = decider.decide(rules, dup);
  const status = decision.status;
  const score = status === C.APPROVED ? 90 : (status === C.MANUAL_REVIEW ? 50 : 0);
  trace(id, 'DECISION=' + status + ' reason=' + decision.reason);

  // Step 8: Audit log
  const auditLog = audit.record(order, status, fields, rules, decision.reason);

  const elapsed = Date.now() - t0;
  trace(id, 'DONE status=' + status + ' ' + elapsed + 'ms');
  return {
    status,
    verificationScore: score,
    verificationDuration: elapsed,
    autoVerified: status === C.APPROVED,
    manualReviewRequired: status === C.MANUAL_REVIEW,
    reasons: [decision.reason],
    ocrData: {
      rawText: ocrResult.text.substring(0, 300),
      amount: fields.amount && fields.amount.value,
      utr: fields.utr && fields.utr.value,
      receiverUpi: fields.receiverUpi && fields.receiverUpi.value,
      receiverName: fields.receiverName && fields.receiverName.value,
      date: fields.date && fields.date.value,
      time: fields.time && fields.time.value,
      paymentStatus: fields.paymentStatus && fields.paymentStatus.value,
    },
    matchedAmount: rules.results[0] && rules.results[0].pass,
    matchedUtr: rules.results[6] && rules.results[6].pass,
    matchedDate: rules.results[4] && rules.results[4].pass,
    matchedStatus: rules.results[3] && rules.results[3].pass,
    fraudScore: 0,
    fraudFlags: [],
    screenshotHash: hash(buf),
    userEnteredUtr: userUtr || null,
    userUtrMatched: true,
    timings: { total: elapsed },
    paymentType: order && order.type,
    selectedPackage: amt,
    matchedReceiver: rules.results[2] && rules.results[2].pass,
    matchedName: rules.results[1] && rules.results[1].pass,
    validationResults: rules.results,
    screenshotHash: hash(buf),
    auditLog,
  };
  } catch (e) {
    const eid = (order && order.id) || '?';
    trace(eid, 'CRASH: ' + (e.stack || e.message));
    return build(C.REJECTED, 0, ['Engine crash: ' + e.message], { order: { id: eid, type: (order && order.type) || '?', amount: Number(order && order.amount) || 0 }, t0: Date.now(), id: eid });
  }
}

function build(status, score, reasons, ctx) {
  return {
    status,
    verificationScore: score,
    verificationDuration: Date.now() - ctx.t0,
    autoVerified: status === C.APPROVED,
    manualReviewRequired: status === C.MANUAL_REVIEW,
    reasons,
    ocrData: null,
    matchedAmount: false,
    matchedUtr: false,
    matchedDate: false,
    matchedStatus: false,
    fraudScore: 0,
    fraudFlags: [],
    screenshotHash: '',
    userEnteredUtr: null,
    userUtrMatched: false,
    timings: { total: Date.now() - ctx.t0 },
    paymentType: ctx.order && ctx.order.type,
    selectedPackage: ctx.order && ctx.order.amount,
    matchedReceiver: false,
    matchedName: false,
    validationResults: [],
    auditLog: null,
  };
}

const TOTAL_PIPELINE_BUDGET_MS = C.BUDGET_MS;

module.exports = { run, TOTAL_PIPELINE_BUDGET_MS };