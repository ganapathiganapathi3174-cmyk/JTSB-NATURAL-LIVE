const C = require('./config');
const log = require('./logger').VALIDATE;

function getISTDate() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const istMs = utcMs + 5.5 * 3600000;
  return new Date(istMs).toISOString().slice(0, 10);
}

function dateToIST(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60000;
  const istMs = utcMs + 5.5 * 3600000;
  return new Date(istMs).toISOString().slice(0, 10);
}

function normalizeAmount(val) {
  if (val === null || val === undefined) return null;
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? null : Math.round(n);
}

function normalizeUpi(val) {
  if (!val) return '';
  return val.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9@._-]/g, '');
}

function validateAmount(extracted, expectedAmount) {
  const extractedVal = normalizeAmount(extracted ? extracted.value : null);
  const expected = normalizeAmount(expectedAmount);

  if (extractedVal === null) return { passed: false, reason: 'Amount not found in OCR', score: 0, severity: 'missing', extractedValue: 'null', expectedValue: expected };

  if (C.TEST_MODE && extractedVal === C.TEST_PAYMENT_AMOUNT) {
    return { passed: true, reason: 'Test mode: extracted ₹' + extractedVal + ' matches test amount ₹' + C.TEST_PAYMENT_AMOUNT, score: 100, severity: 'none', extractedValue: extractedVal, expectedValue: expected };
  }

  if (expected && extractedVal === expected) {
    return { passed: true, reason: 'Amount matches exactly (₹' + extractedVal + ')', score: 100, severity: 'none', extractedValue: extractedVal, expectedValue: expected };
  }

  if (C.ALLOWED_AMOUNTS.includes(extractedVal)) {
    if (expected && extractedVal !== expected) {
      return { passed: true, reason: 'Amount ₹' + extractedVal + ' is valid package (expected ₹' + expected + ' — ignoring in test mode)', score: 80, severity: 'none', extractedValue: extractedVal, expectedValue: expected };
    }
    return { passed: true, reason: 'Amount ₹' + extractedVal + ' is a valid package amount', score: 80, severity: 'none', extractedValue: extractedVal, expectedValue: expected };
  }

  return { passed: false, reason: 'Amount mismatch: expected ₹' + expected + ', found ₹' + extractedVal, score: 0, severity: 'hard', extractedValue: extractedVal, expectedValue: expected };
}

function validateReceiverUpi(extracted) {
  const extractedVal = extracted ? extracted.value : null;
  const expected = normalizeUpi(C.EXPECTED_RECEIVER_UPI);
  if (!extractedVal) return { passed: false, reason: 'Receiver UPI not found in OCR', score: 0, severity: 'missing', extractedValue: 'null', expectedValue: expected };

  const found = normalizeUpi(extractedVal);

  if (found === expected) return { passed: true, reason: 'Receiver UPI matches exactly', score: 100, severity: 'none', extractedValue: found, expectedValue: expected };

  const foundUser = found.split('@')[0];
  const expectedUser = expected.split('@')[0];
  const foundDomain = (found.split('@')[1] || '');
  const expectedDomain = (expected.split('@')[1] || '');

  if (foundUser === expectedUser) {
    return { passed: true, reason: 'Receiver UPI username matches (domain: ' + foundDomain + ' vs ' + expectedDomain + ')', score: 85, severity: 'none', extractedValue: found, expectedValue: expected };
  }

  if (foundUser.includes(expectedUser) || expectedUser.includes(foundUser)) {
    return { passed: true, reason: 'Receiver UPI partially matches', score: 70, severity: 'none', extractedValue: found, expectedValue: expected };
  }

  if (foundDomain === expectedDomain && foundUser.length > 3 && expectedUser.length > 3) {
    return { passed: false, reason: 'Receiver UPI username differs (same domain): ' + found + ' vs ' + expected, score: 20, severity: 'soft', extractedValue: found, expectedValue: expected };
  }

  return { passed: false, reason: 'Receiver UPI mismatch: found ' + found + ', expected ' + expected, score: 0, severity: 'hard', extractedValue: found, expectedValue: expected };
}

function validateDate(extracted, orderCreatedAt) {
  const extractedVal = extracted ? extracted.value : null;
  if (!extractedVal) return { passed: false, reason: 'Date not found in OCR', score: 0, severity: 'missing', extractedValue: 'null', expectedValue: 'today or within tolerance' };

  const today = getISTDate();
  const extractedDate = extractedVal;

  if (extractedDate === today) return { passed: true, reason: 'Date is today (' + today + ')', score: 100, severity: 'none', extractedValue: extractedDate, expectedValue: today };

  const nowIST = new Date(Date.now() + 5.5 * 3600000);
  const yesterdayIST = new Date(nowIST.getTime() - 86400000).toISOString().slice(0, 10);
  if (extractedDate === yesterdayIST) return { passed: true, reason: 'Date is yesterday (' + yesterdayIST + ')', score: 80, severity: 'none', extractedValue: extractedDate, expectedValue: yesterdayIST };

  const tomorrowIST = new Date(nowIST.getTime() + 86400000).toISOString().slice(0, 10);
  if (extractedDate === tomorrowIST) return { passed: true, reason: 'Date is tomorrow (timezone edge: ' + tomorrowIST + ')', score: 60, severity: 'none', extractedValue: extractedDate, expectedValue: tomorrowIST };

  if (orderCreatedAt) {
    const orderDate = dateToIST(orderCreatedAt);
    if (orderDate && extractedDate === orderDate) {
      return { passed: true, reason: 'Date matches order creation date (' + orderDate + ')', score: 90, severity: 'none', extractedValue: extractedDate, expectedValue: orderDate };
    }
  }

  const twoDaysAgoIST = new Date(nowIST.getTime() - 2 * 86400000).toISOString().slice(0, 10);
  if (extractedDate === twoDaysAgoIST) {
    return { passed: true, reason: 'Date is 2 days ago (' + extractedDate + ') — within tolerance', score: 50, severity: 'none', extractedValue: extractedDate, expectedValue: twoDaysAgoIST };
  }

  return { passed: false, reason: 'Date mismatch: found ' + extractedDate + ', expected today (' + today + ')', score: 0, severity: 'soft', extractedValue: extractedDate, expectedValue: today };
}

function validateTime(extracted, orderCreatedAt) {
  const extractedVal = extracted ? extracted.value : null;
  if (!extractedVal) return { passed: false, reason: 'Time not found in OCR', score: 0, severity: 'missing', extractedValue: 'null', expectedValue: 'any valid time' };

  const timeStr = extractedVal;
  const m = timeStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!m) return { passed: false, reason: 'Invalid time format: ' + timeStr, score: 0, severity: 'soft', extractedValue: timeStr, expectedValue: 'valid time format' };

  let hours = parseInt(m[1]);
  const minutes = parseInt(m[2]);
  if (m[4]) {
    const ampm = m[4].toUpperCase();
    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return { passed: false, reason: 'Invalid time: ' + timeStr, score: 0, severity: 'soft', extractedValue: timeStr, expectedValue: 'valid time' };

  if (!orderCreatedAt) return { passed: true, reason: 'Time found: ' + timeStr + ' (no order time to compare)', score: 80, severity: 'none', extractedValue: timeStr, expectedValue: 'no order time' };

  const nowMs = Date.now();
  const orderTime = new Date(orderCreatedAt);
  const diffMs = Math.abs(nowMs - orderTime.getTime());
  const diffMinutes = diffMs / 60000;

  if (diffMinutes <= C.MAX_SESSION_AGE_MINUTES) return { passed: true, reason: 'Time within ' + C.MAX_SESSION_AGE_MINUTES + 'min window (' + Math.round(diffMinutes) + 'min)', score: 100, severity: 'none', extractedValue: timeStr, expectedValue: 'within ' + C.MAX_SESSION_AGE_MINUTES + 'min of now' };
  if (diffMinutes <= C.MAX_SESSION_AGE_MINUTES * 3) return { passed: true, reason: 'Time slightly outside window (' + Math.round(diffMinutes) + 'min) — accepted', score: 60, severity: 'none', extractedValue: timeStr, expectedValue: 'within ' + (C.MAX_SESSION_AGE_MINUTES * 3) + 'min of now' };

  return { passed: false, reason: 'Time too old: ' + Math.round(diffMinutes) + 'min from session (max ' + C.MAX_SESSION_AGE_MINUTES + 'min)', score: 0, severity: 'soft', extractedValue: timeStr, expectedValue: 'within ' + C.MAX_SESSION_AGE_MINUTES + 'min of order' };
}

function validateUtr(extracted) {
  const extractedVal = extracted ? extracted.value : null;
  if (!extractedVal) return { passed: false, reason: 'UTR not found in OCR', score: 0, severity: 'missing', extractedValue: 'null', expectedValue: '10-30 char alphanumeric' };
  const utr = extractedVal;
  if (utr.length < C.UTR_MIN_LENGTH) return { passed: false, reason: 'UTR too short: ' + utr.length + ' chars (min ' + C.UTR_MIN_LENGTH + ')', score: 0, severity: 'soft', extractedValue: utr, expectedValue: C.UTR_MIN_LENGTH + '-' + C.UTR_MAX_LENGTH + ' chars' };
  if (utr.length > C.UTR_MAX_LENGTH) return { passed: false, reason: 'UTR too long: ' + utr.length + ' chars (max ' + C.UTR_MAX_LENGTH + ')', score: 0, severity: 'soft', extractedValue: utr, expectedValue: C.UTR_MIN_LENGTH + '-' + C.UTR_MAX_LENGTH + ' chars' };
  return { passed: true, reason: 'UTR format valid (' + utr.length + ' chars)', score: 100, severity: 'none', extractedValue: utr, expectedValue: C.UTR_MIN_LENGTH + '-' + C.UTR_MAX_LENGTH + ' chars' };
}

function validateUserUtr(extractedUtr, userUtr) {
  if (!userUtr || !userUtr.trim()) return { passed: false, reason: 'No UTR entered by user', score: 0, isUserCheck: true, severity: 'missing', extractedValue: extractedUtr ? extractedUtr.value : 'null', expectedValue: userUtr || 'null' };
  if (!extractedUtr || !extractedUtr.value) return { passed: false, reason: 'Cannot verify user UTR: OCR UTR not available', score: 0, isUserCheck: true, severity: 'missing', extractedValue: 'null', expectedValue: userUtr };

  const cleanedUser = userUtr.trim().toUpperCase().replace(/[\s\-]/g, '');
  const cleanedOcr = extractedUtr.value.toUpperCase().replace(/[\s\-]/g, '');

  if (cleanedUser === cleanedOcr) return { passed: true, reason: 'User UTR matches OCR UTR', score: 100, isUserCheck: true, severity: 'none', extractedValue: cleanedOcr, expectedValue: cleanedUser };
  if (cleanedUser.includes(cleanedOcr) || cleanedOcr.includes(cleanedUser)) return { passed: true, reason: 'User UTR partially matches OCR UTR', score: 80, isUserCheck: true, severity: 'none', extractedValue: cleanedOcr, expectedValue: cleanedUser };

  const similarity = cleanedUser.length > 0 && cleanedOcr.length > 0
    ? Math.min(cleanedUser.length, cleanedOcr.length) / Math.max(cleanedUser.length, cleanedOcr.length)
    : 0;
  if (similarity > 0.8) return { passed: true, reason: 'User UTR closely matches OCR UTR (' + Math.round(similarity * 100) + '% similar)', score: 60, isUserCheck: true, severity: 'none', extractedValue: cleanedOcr, expectedValue: cleanedUser };

  return { passed: false, reason: 'User UTR (' + cleanedUser + ') does not match OCR UTR (' + cleanedOcr + ')', score: 0, isUserCheck: true, severity: 'hard', extractedValue: cleanedOcr, expectedValue: cleanedUser };
}

function validatePaymentStatus(extracted) {
  const extractedVal = extracted ? extracted.value : null;
  if (!extractedVal) return { passed: false, reason: 'Payment status not found — assuming success (some apps hide status)', score: 50, severity: 'missing', extractedValue: 'null', expectedValue: 'SUCCESS/PAID/CREDITED' };

  const s = extractedVal.toUpperCase();
  if (C.ACCEPTED_PAYMENT_STATUSES.has(s)) return { passed: true, reason: 'Payment status accepted: ' + s, score: 100, severity: 'none', extractedValue: s, expectedValue: 'SUCCESS/PAID/CREDITED' };
  if (C.REJECTED_PAYMENT_STATUSES.has(s)) return { passed: false, reason: 'Payment status rejected: ' + s, score: 0, severity: 'hard', extractedValue: s, expectedValue: 'SUCCESS/PAID/CREDITED' };

  return { passed: false, reason: 'Unknown payment status: ' + s, score: 40, severity: 'soft', extractedValue: s, expectedValue: 'SUCCESS/PAID/CREDITED' };
}

function run(extracted, order, userUtr) {
  const t0 = Date.now();
  const expectedAmount = Number(order.amount) || 0;

  const checks = [
    { name: 'amount', ...validateAmount(extracted.amount, expectedAmount) },
    { name: 'receiver_upi', ...validateReceiverUpi(extracted.receiverUpi) },
    { name: 'date', ...validateDate(extracted.date, order.created_at) },
    { name: 'time', ...validateTime(extracted.time, order.created_at) },
    { name: 'utr_format', ...validateUtr(extracted.utr) },
    { name: 'user_utr', ...validateUserUtr(extracted.utr, userUtr) },
    { name: 'payment_status', ...validatePaymentStatus(extracted.paymentStatus) },
  ];

  const mandatoryChecks = checks.filter(c => !c.isUserCheck);
  const mandatoryPassed = mandatoryChecks.filter(c => c.passed).length;
  const mandatoryTotal = mandatoryChecks.length;
  const hardFailures = mandatoryChecks.filter(c => !c.passed && c.severity === 'hard').length;
  const softFailures = mandatoryChecks.filter(c => !c.passed && c.severity === 'soft').length;
  const missingFields = mandatoryChecks.filter(c => !c.passed && c.severity === 'missing').length;

  const allMandatoryPass = hardFailures === 0 && mandatoryPassed >= Math.ceil(mandatoryTotal * 0.6);

  log.info('', 'Validation: ' + mandatoryPassed + '/' + mandatoryTotal + ' pass, hard=' + hardFailures + ' soft=' + softFailures + ' missing=' + missingFields + ' (' + (Date.now() - t0) + 'ms)');
  return { checks, allMandatoryPass, mandatoryPassed, mandatoryTotal, hardFailures, softFailures, missingFields, duration: Date.now() - t0 };
}

module.exports = { run, validateAmount, validateReceiverUpi, validateDate, validateTime, validateUtr, validateUserUtr, validatePaymentStatus };
