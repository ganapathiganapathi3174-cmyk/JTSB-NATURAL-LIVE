const crypto = require('crypto');
const { analyzeWithAI, mapAIResultToVerificationFormat } = require('./_ai_bridge.js');
const { runQuery } = require('./_supabase.js');
const { COL_UPI_PAYMENTS, ADMIN_UPI_ID, ALLOWED_AMOUNTS } = require('./_shared.js');

const REJECTED_STATUSES = ['REJECTED', 'FAILED', 'MANUAL_REVIEW'];
const ACCEPTED_PAYMENT_STATUSES = ['SUCCESS', 'SUCCESSFUL', 'CREDITED', 'PAID', 'DEBIT_SUCCESS'];
const ACCEPTED_APPS = ['google_pay', 'phonepe', 'paytm', 'bhim', 'amazon_pay', 'cred'];

const FRAUD_CACHE_TTL = 100;
let fraudCache = null;
let fraudCacheTime = 0;

function log(msg) {
  console.log('[' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '] [OFFICER] ' + msg);
}

function now() { return new Date().toISOString(); }

function computeTextHash(text) {
  if (!text) return '';
  return crypto.createHash('sha256').update(text).digest('hex').substring(0, 16);
}

function isToday(dateStr) {
  if (!dateStr) return false;
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const dateNormalized = dateStr.replace(/[\/\-]/g, '-').trim();
  const parts = dateNormalized.split('-');
  if (parts.length === 3) {
    let y = parts[2], m = parts[1], d = parts[0];
    if (y.length === 2) y = '20' + y;
    if (m.length === 1) m = '0' + m;
    if (d.length === 1) d = '0' + d;
    if (y + '-' + m + '-' + d === todayStr) return true;
    const yesterday = new Date(Date.now() - 86400000);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    if (y + '-' + m + '-' + d === yesterdayStr) return true;
  }
  return false;
}

function isWithinOneHour(timeStr) {
  if (!timeStr) return false;
  const nowDate = new Date();
  const parts = timeStr.match(/(\d{1,2})[:\s](\d{2})(?:\s*(AM|PM))?/i);
  if (!parts) return false;
  let h = parseInt(parts[1], 10);
  const m = parseInt(parts[2], 10);
  const ampm = parts[3] ? parts[3].toUpperCase() : null;
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  const extractedMs = h * 3600000 + m * 60000;
  const nowMs = nowDate.getHours() * 3600000 + nowDate.getMinutes() * 60000;
  const diff = Math.abs(nowMs - extractedMs);
  if (diff <= 3600000) return true;
  if (diff > 64800000) {
    const adjustedDiff = Math.abs(nowMs - (extractedMs + 86400000));
    if (adjustedDiff <= 3600000) return true;
  }
  return false;
}

async function fetchPaymentsCache() {
  if (fraudCache && (Date.now() - fraudCacheTime) < FRAUD_CACHE_TTL) return fraudCache;
  const payments = await runQuery(COL_UPI_PAYMENTS, [], { limit: 2000 });
  fraudCache = payments;
  fraudCacheTime = Date.now();
  return payments;
}

function normalizeUpiId(upi) {
  if (!upi) return '';
  return upi.toLowerCase().replace(/\s/g, '');
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
    log('Screenshot duplicate check error: ' + e.message);
    return { pass: false, reason: 'Screenshot check failed' };
  }
}

async function runOfficerVerification(screenshotUrl, expected) {
  const checks = [];
  const fields = {};
  let confidence = 0;
  let decision = 'MANUAL_REVIEW';
  let reasons = [];

  log('Starting officer verification for ' + (expected.orderId || 'unknown') + ' amount=' + expected.amount + ' receiver=' + expected.receiverUpi);

  // Step 1: Call Python AI engine for visual analysis
  let aiResult = null;
  let aiOutput = null;
  try {
    log('[AI_STARTED] for ' + (expected.orderId || 'unknown'));
    aiOutput = await analyzeWithAI(screenshotUrl, {
      amount: String(expected.amount || ''),
      receiver_upi: expected.receiverUpi || ADMIN_UPI_ID,
      date: expected.date || now().slice(0, 10),
    });
    aiResult = mapAIResultToVerificationFormat(aiOutput);
    log('AI engine returned decision=' + (aiOutput.decision || 'unknown') + ' confidence=' + (aiOutput.confidence || 0));
  } catch (e) {
    log('AI engine failed: ' + e.message);
    reasons.push('AI engine unavailable: ' + e.message);
    return {
      decision: 'MANUAL_REVIEW',
      confidence: 0,
      reason: 'AI engine unavailable — manual review required',
      fields: { error: e.message },
      failed_checks: ['ai_engine'],
    };
  }

  // Step 2: Extract fields from AI result
  const ocrData = aiResult?.ocrData || {};
  const extractedAmount = ocrData.extractedAmount || '';
  const extractedUtr = ocrData.extractedUtr || '';
  const extractedReceiver = ocrData.extractedReceiverName || '';
  const extractedSenderVpa = ocrData.extractedSenderVpa || '';
  const extractedDate = ocrData.extractedDate || '';
  const extractedTime = ocrData.extractedTime || '';
  const extractedStatus = ocrData.extractedPaymentStatus || '';
  const extractedBank = ocrData.extractedBankName || '';
  const appIdentified = aiOutput?.app_identified || 'Unknown';
  const aiChecks = aiResult?.checks || [];
  const fraudScore = aiResult?.fraudScore || 0;
  const fraudFlags = aiResult?.fraudFlags || [];
  const imageQuality = aiResult?.imageQuality || {};
  const ocrConfidence = aiResult?.verificationScore || aiOutput?.ocr_confidence || aiOutput?.confidence || 0;

  fields.app_identified = appIdentified;
  fields.extractedAmount = extractedAmount;
  fields.extractedUtr = extractedUtr;
  fields.extractedReceiverVpa = extractedReceiver;
  fields.extractedSenderVpa = extractedSenderVpa;
  fields.extractedDate = extractedDate;
  fields.extractedTime = extractedTime;
  fields.extractedStatus = extractedStatus;
  fields.extractedBankName = extractedBank;
  fields.ocrConfidence = ocrConfidence;
  fields.fraudScore = fraudScore;
  fields.fraudFlags = fraudFlags;

  // Step 3: Run each mandatory validation
  log('[RULE_ENGINE_STARTED] Running validation checks...');
  const failedChecks = [];

  // Check 1: App identified
  if (!appIdentified || appIdentified === 'Unknown') {
    failedChecks.push('app_not_identified');
    reasons.push('Could not identify payment application');
  } else if (!ACCEPTED_APPS.includes(appIdentified.toLowerCase().replace(/\s+/g, '_'))) {
    failedChecks.push('app_not_recognized');
    reasons.push('Payment app ' + appIdentified + ' is not in accepted list');
  }

  // Check 2: OCR confidence
  if (ocrConfidence < 80) {
    failedChecks.push('low_ocr_confidence');
    reasons.push('OCR confidence ' + ocrConfidence.toFixed(1) + '% is below 80% threshold');
  }

  // Check 3: Amount match (EXACT)
  const expectedAmount = parseFloat(String(expected.amount).replace(/[^0-9.]/g, ''));
  const extractedAmountNum = parseFloat(String(extractedAmount).replace(/[^0-9.]/g, ''));
  if (!expectedAmount || !extractedAmountNum || Math.abs(expectedAmount - extractedAmountNum) > 0.01) {
    failedChecks.push('amount_mismatch');
    reasons.push('Amount mismatch: expected ₹' + expectedAmount + ', extracted ₹' + extractedAmountNum);
  }

  // Check 4: Receiver UPI match (EXACT)
  const normalizedExpectedUpi = normalizeUpiId(expected.receiverUpi || ADMIN_UPI_ID);
  const normalizedExtractedReceiver = normalizeUpiId(extractedReceiver);
  if (!normalizedExtractedReceiver || normalizedExtractedReceiver !== normalizedExpectedUpi) {
    failedChecks.push('receiver_mismatch');
    reasons.push('Receiver UPI mismatch: expected ' + normalizedExpectedUpi + ', extracted ' + (normalizedExtractedReceiver || 'none'));
  }

  // Check 5: Payment status
  if (!extractedStatus || !ACCEPTED_PAYMENT_STATUSES.includes(extractedStatus.toUpperCase().trim())) {
    failedChecks.push('status_not_success');
    reasons.push('Payment status "' + extractedStatus + '" is not SUCCESS');
  }

  // Check 6: Date must be today
  if (!isToday(extractedDate)) {
    failedChecks.push('date_not_current');
    reasons.push('Payment date ' + extractedDate + ' is not today');
  }

  // Check 7: Time within 1 hour
  if (!isWithinOneHour(extractedTime)) {
    failedChecks.push('time_outside_window');
    reasons.push('Payment time ' + extractedTime + ' is outside the 1-hour window');
  }

  // Check 8: UTR uniqueness
  const utrUnique = extractedUtr ? await checkUtrUnique(extractedUtr, expected.orderId) : { pass: false, reason: 'No UTR extracted' };
  if (!utrUnique.pass) {
    failedChecks.push('utr_duplicate');
    reasons.push(utrUnique.reason || 'UTR duplicate');
  }

  // Check 9: Screenshot authenticity
  const visualValidation = aiResult?.visualValidation || {};
  if (visualValidation.isTampered || visualValidation.isFake) {
    failedChecks.push('screenshot_tampered');
    reasons.push('Screenshot shows signs of tampering');
  }
  if (imageQuality.passed === false) {
    failedChecks.push('poor_image_quality');
    reasons.push('Image quality check failed: ' + (imageQuality.issues || []).join(', '));
  }

  // Check 10: Duplicate screenshot
  const imageHash = aiResult?.ocrResult?.imageHash || '';
  const screenshotDup = imageHash ? await checkScreenshotDuplicate(imageHash, expected.orderId) : { pass: true };
  if (!screenshotDup.pass) {
    failedChecks.push('duplicate_screenshot');
    reasons.push(screenshotDup.reason || 'Duplicate screenshot detected');
  }

  // Check 11: Fraud
  if (fraudScore > 0) {
    failedChecks.push('fraud_detected');
    reasons.push('Fraud score ' + fraudScore + ' with flags: ' + (fraudFlags || []).join(', '));
  }

  // Step 4: Decision
  if (failedChecks.length === 0) {
    decision = 'APPROVED';
    confidence = Math.min(99.9, 80 + ocrConfidence * 0.15 + (aiOutput?.confidence || 0) * 0.05);
    reasons = ['All mandatory checks passed'];
    log('DECISION: APPROVED (confidence=' + confidence.toFixed(1) + '%)');
  } else {
    const mandatoryFailures = ['amount_mismatch', 'receiver_mismatch', 'status_not_success', 'screenshot_tampered', 'utr_duplicate', 'fraud_detected'];
    const hasMandatoryFail = failedChecks.some(c => mandatoryFailures.includes(c));
    if (hasMandatoryFail) {
      decision = 'REJECTED';
      confidence = Math.max(0, 60 - failedChecks.length * 10);
      log('DECISION: REJECTED — ' + failedChecks.length + ' checks failed');
    } else {
      decision = 'MANUAL_REVIEW';
      confidence = Math.max(0, 70 - failedChecks.length * 5);
      log('DECISION: MANUAL_REVIEW — ' + failedChecks.length + ' checks need review');
    }
  }

  const result = {
    decision,
    confidence: Math.round(confidence * 10) / 10,
    reason: reasons.join('; '),
    fields,
    failed_checks: failedChecks,
    timestamp: now(),
  };

  log('Officer verification complete: ' + decision + ' (' + failedChecks.length + ' failed checks)');
  return result;
}

async function runOfficerVerificationForWorker(order, screenshotUrl, userId, userEnteredUtr, userEnteredUpi) {
  const expected = {
    amount: order.amount || 0,
    receiverUpi: ADMIN_UPI_ID,
    date: new Date().toISOString().slice(0, 10),
    orderId: order.id,
    userEnteredUtr,
    userEnteredUpi,
    userId,
  };
  const officerResult = await runOfficerVerification(screenshotUrl, expected);

  const isApproved = officerResult.decision === 'APPROVED';
  const finalStatus = isApproved ? 'verified' : (officerResult.decision === 'REJECTED' ? 'rejected' : 'manual_review');

  const v = {
    status: finalStatus,
    verificationScore: officerResult.confidence,
    verificationDuration: 0,
    ocrData: {
      rawText: '',
      extractedAmount: officerResult.fields.extractedAmount || '',
      extractedUtr: officerResult.fields.extractedUtr || '',
      extractedReceiverName: officerResult.fields.extractedReceiverVpa || '',
      extractedSenderVpa: officerResult.fields.extractedSenderVpa || '',
      extractedDate: officerResult.fields.extractedDate || '',
      extractedTime: officerResult.fields.extractedTime || '',
      extractedPaymentStatus: officerResult.fields.extractedStatus || '',
      extractedBankName: officerResult.fields.extractedBankName || '',
      confidence: officerResult.fields.ocrConfidence || 0,
      appIdentified: officerResult.fields.app_identified || 'Unknown',
    },
    reasons: [officerResult.reason],
    checks: officerResult.failed_checks.map(c => ({ name: c, passed: false })),
    matchedAmount: !officerResult.failed_checks.includes('amount_mismatch'),
    matchedReceiver: !officerResult.failed_checks.includes('receiver_mismatch'),
    matchedUtr: !officerResult.failed_checks.includes('utr_duplicate'),
    matchedDate: !officerResult.failed_checks.includes('date_not_current'),
    matchedStatus: !officerResult.failed_checks.includes('status_not_success'),
    fraudScore: officerResult.fields.fraudScore || 0,
    fraudFlags: officerResult.fields.fraudFlags || [],
    imageQuality: { passed: !officerResult.failed_checks.includes('poor_image_quality') },
    duplicateUtrDetected: officerResult.failed_checks.includes('utr_duplicate'),
    screenshotHash: '',
    bankSmsDetected: false,
    userUtrMatched: false,
    userUpiMatched: false,
  };

  log('Adapter output: status=' + v.status + ' score=' + v.verificationScore + ' checks=' + JSON.stringify(officerResult.failed_checks));
  return v;
}

module.exports = { runOfficerVerification, runOfficerVerificationForWorker };
