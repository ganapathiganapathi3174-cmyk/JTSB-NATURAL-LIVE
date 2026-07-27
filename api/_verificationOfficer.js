const crypto = require('crypto');
const verificationEngine = require('./_verification/index.js');
const { runQuery } = require('./_supabase.js');
const { COL_UPI_PAYMENTS, ADMIN_UPI_ID, ALLOWED_AMOUNTS, TEST_MODE, TEST_PAYMENT_AMOUNT } = require('./_shared.js');

const REJECTED_STATUSES = ['REJECTED', 'FAILED', 'MANUAL_REVIEW'];

let fraudCache = null;
let fraudCacheTime = 0;
const FRAUD_CACHE_TTL = 100;

function log(msg) {
  console.log('[' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '] [OFFICER] ' + msg);
}

function now() { return new Date().toISOString(); }

async function fetchPaymentsCache() {
  if (fraudCache && (Date.now() - fraudCacheTime) < FRAUD_CACHE_TTL) return fraudCache;
  const payments = await runQuery(COL_UPI_PAYMENTS, [], { limit: 2000 });
  fraudCache = payments;
  fraudCacheTime = Date.now();
  return payments;
}

async function checkUtrUnique(utr, excludeOrderId) {
  if (!utr) return { pass: false, reason: 'No UTR provided' };
  try {
    const cleanUtr = utr.toUpperCase().trim();
    const payments = await fetchPaymentsCache();
    const dup = payments.find(p =>
      p.utr && p.utr.toUpperCase().trim() === cleanUtr &&
      !REJECTED_STATUSES.includes(p.status) &&
      p.id !== excludeOrderId
    );
    if (dup) return { pass: false, reason: 'UTR already used in payment ' + dup.id };
    return { pass: true };
  } catch (e) {
    log('UTR check error: ' + e.message);
    return { pass: false, reason: 'UTR check failed: ' + e.message };
  }
}

async function checkScreenshotDuplicate(imageHash, excludeOrderId) {
  if (!imageHash) return { pass: true };
  try {
    const payments = await fetchPaymentsCache();
    const dup = payments.find(p =>
      p.screenshot_hash === imageHash &&
      !REJECTED_STATUSES.includes(p.status) &&
      p.id !== excludeOrderId
    );
    if (dup) return { pass: false, reason: 'Duplicate screenshot (same as payment ' + dup.id + ')' };
    return { pass: true };
  } catch (e) {
    return { pass: true };
  }
}

async function runOfficerVerification(order, screenshotUrl, userId, userEnteredUtr, userEnteredUpi) {
  const t0 = Date.now();
  log('Starting verification for order ' + (order.id || 'unknown') + ', amount=' + order.amount);

  const orderObj = {
    id: order.id,
    amount: TEST_MODE ? TEST_PAYMENT_AMOUNT : order.amount,
    type: order.type || 'registration',
    created_at: order.created_at || now(),
    expected_upi_id: ADMIN_UPI_ID,
  };

  const v = await verificationEngine.run(orderObj, screenshotUrl, userId, userEnteredUtr);

  log('Pipeline returned: status=' + v.status + ' score=' + v.verificationScore + ' (' + (Date.now() - t0) + 'ms)');

  const ocrData = v.ocrData || {};
  const extractedUtr = ocrData.extractedUtr || '';
  const extractedReceiverUpi = ocrData.extractedReceiverUpi || ocrData.extractedSenderVpa || '';
  const extractedAmount = ocrData.extractedAmount || '';
  const extractedDate = ocrData.extractedDate || '';
  const extractedTime = ocrData.extractedTime || '';
  const extractedStatus = ocrData.extractedPaymentStatus || '';

  const utrUnique = extractedUtr ? await checkUtrUnique(extractedUtr, order.id) : { pass: false, reason: 'No UTR' };
  const imageHash = v.screenshotHash || '';
  const screenshotDup = imageHash ? await checkScreenshotDuplicate(imageHash, order.id) : { pass: true };

  const reasons = [...(v.reasons || [])];

  if (!utrUnique.pass) {
    reasons.push(utrUnique.reason);
    v.status = 'rejected';
  }
  if (!screenshotDup.pass) {
    reasons.push(screenshotDup.reason);
    v.status = 'rejected';
  }

  const result = {
    status: v.status,
    verificationScore: v.verificationScore || 0,
    verificationDuration: Date.now() - t0,
    ocrData: {
      rawText: ocrData.rawText || '',
      extractedAmount,
      extractedUtr,
      extractedReceiverUpi,
      extractedSenderVpa: ocrData.extractedSenderVpa || '',
      extractedReceiverName: ocrData.extractedReceiverName || '',
      extractedDate,
      extractedTime,
      extractedPaymentStatus: extractedStatus,
      extractedBankName: ocrData.extractedBankName || '',
      confidence: ocrData.confidence || 0,
    },
    reasons,
    checks: (v.checks || []).map(c => ({ name: c.name, passed: c.passed })),
    matchedAmount: v.matchedAmount || false,
    matchedReceiver: v.matchedReceiver || false,
    matchedUtr: v.matchedUtr || false,
    matchedDate: v.matchedDate || false,
    matchedStatus: v.matchedStatus || false,
    fraudScore: v.fraudScore || 0,
    fraudFlags: v.fraudFlags || [],
    imageQuality: v.imageQuality || { passed: true },
    duplicateUtrDetected: !utrUnique.pass,
    screenshotHash: imageHash,
    bankSmsDetected: false,
    userUtrMatched: v.userUtrMatched || false,
    userUpiMatched: false,
  };

  log('Verification complete: status=' + result.status + ' score=' + result.verificationScore + ' (' + result.verificationDuration + 'ms)');
  return result;
}

module.exports = { runOfficerVerification };
