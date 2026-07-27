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

  if (extractedVal === null) return { passed: false, reason: 'Amount not found in OCR', score: 0, severity: 'missing' };

  if (C.TEST_MODE && extractedVal === C.TEST_PAYMENT_AMOUNT) {
    return { passed: true, reason: 'Test mode: extracted ₹' + extractedVal + ' matches test amount ₹' + C.TEST_PAYMENT_AMOUNT, score: 100, severity: 'none' };
  }

  if (expected && extractedVal === expected) {
    return { passed: true, reason: 'Amount matches exactly (₹' + extractedVal + ')', score: 100, severity: 'none' };
  }

  if (C.ALLOWED_AMOUNTS.includes(extractedVal)) {
    if (expected && extractedVal !== expected) {
      return { passed: false, reason: 'Amount mismatch: expected ₹' + expected + ', found ₹' + extractedVal + ' (valid package amount)', score: 30, severity: 'soft' };
    }
    return { passed: true, reason: 'Amount ₹' + extractedVal + ' is a valid package amount', score: 80, severity: 'none' };
  }

  return { passed: false, reason: 'Amount mismatch: expected ₹' + expected + ', found ₹' + extractedVal, score: 0, severity: 'hard' };
}

function validateReceiverUpi(extracted) {
  if (!extracted || !extracted.value) return { passed: false, reason: 'Receiver UPI not found in OCR', score: 0, severity: 'missing' };

  const found = normalizeUpi(extracted.value);
  const expected = normalizeUpi(C.EXPECTED_RECEIVER_UPI);

  if (found === expected) return { passed: true, reason: 'Receiver UPI matches exactly', score: 100, severity: 'none' };

  const foundUser = found.split('@')[0];
  const expectedUser = expected.split('@')[0];
  const foundDomain = (found.split('@')[1] || '');
  const expectedDomain = (expected.split('@')[1] || '');

  if (foundUser === expectedUser) {
    return { passed: true, reason: 'Receiver UPI username matches (domain: ' + foundDomain + ' vs ' + expectedDomain + ')', score: 85, severity: 'none' };
  }

  if (foundUser.includes(expectedUser) || expectedUser.includes(foundUser)) {
    return { passed: true, reason: 'Receiver UPI partially matches', score: 70, severity: 'none' };
  }

  if (foundDomain === expectedDomain && foundUser.length > 3 && expectedUser.length > 3) {
    return { passed: false, reason: 'Receiver UPI username differs (same domain): ' + found + ' vs ' + expected, score: 20, severity: 'soft' };
  }

  return { passed: false, reason: 'Receiver UPI mismatch: found ' + found + ', expected ' + expected, score: 0, severity: 'hard' };
}

function validateDate(extracted, orderCreatedAt) {
  if (!extracted || !extracted.value) return { passed: false, reason: 'Date not found in OCR', score: 0, severity: 'missing' };

  const today = getISTDate();
  const extractedDate = extracted.value;

  if (extractedDate === today) return { passed: true, reason: 'Date is today (' + today + ')', score: 100, severity: 'none' };

  const nowIST = new Date(Date.now() + 5.5 * 3600000);
  const yesterdayIST = new Date(nowIST.getTime() - 86400000).toISOString().slice(0, 10);
  if (extractedDate === yesterdayIST) return { passed: true, reason: 'Date is yesterday (' + yesterdayIST + ')', score: 80, severity: 'none' };

  const tomorrowIST = new Date(nowIST.getTime() + 86400000).toISOString().slice(0, 10);
  if (extractedDate === tomorrowIST) return { passed: true, reason: 'Date is tomorrow (timezone edge: ' + tomorrowIST + ')', score: 60, severity: 'none' };

  if (orderCreatedAt) {
    const orderDate = dateToIST(orderCreatedAt);
    if (orderDate && extractedDate === orderDate) {
      return { passed: true, reason: 'Date matches order creation date (' + orderDate + ')', score: 90, severity: 'none' };
    }
  }

  const twoDaysAgoIST = new Date(nowIST.getTime() - 2 * 86400000).toISOString().slice(0, 10);
  if (extractedDate === twoDaysAgoIST) {
    return { passed: true, reason: 'Date is 2 days ago (' + extractedDate + ') — within tolerance', score: 50, severity: 'none' };
  }

  return { passed: false, reason: 'Date mismatch: found ' + extractedDate + ', expected today (' + today + ')', score: 0, severity: 'soft' };
}

function validateTime(extracted, orderCreatedAt) {
  if (!extracted || !extracted.value) return { passed: false, reason: 'Time not found in OCR', score: 0, severity: 'missing' };

  const timeStr = extracted.value;
  const m = timeStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!m) return { passed: false, reason: 'Invalid time format: ' + timeStr, score: 0, severity: 'soft' };

  let hours = parseInt(m[1]);
  const minutes = parseInt(m[2]);
  if (m[4]) {
    const ampm = m[4].toUpperCase();
    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return { passed: false, reason: 'Invalid time: ' + timeStr, score: 0, severity: 'soft' };

  if (!orderCreatedAt) return { passed: true, reason: 'Time found: ' + timeStr + ' (no order time to compare)', score: 80, severity: 'none' };

  const nowMs = Date.now();
  const orderTime = new Date(orderCreatedAt);
  const diffMs = Math.abs(nowMs - orderTime.getTime());
  const diffMinutes = diffMs / 60000;

  if (diffMinutes <= C.MAX_SESSION_AGE_MINUTES) return { passed: true, reason: 'Time within ' + C.MAX_SESSION_AGE_MINUTES + 'min window (' + Math.round(diffMinutes) + 'min)', score: 100, severity: 'none' };
  if (diffMinutes <= C.MAX_SESSION_AGE_MINUTES * 3) return { passed: true, reason: 'Time slightly outside window (' + Math.round(diffMinutes) + 'min) — accepted', score: 60, severity: 'none' };

  return { passed: false, reason: 'Time too old: ' + Math.round(diffMinutes) + 'min from session (max ' + C.MAX_SESSION_AGE_MINUTES + 'min)', score: 0, severity: 'soft' };
}

function validateUtr(extracted) {
  if (!extracted || !extracted.value) return { passed: false, reason: 'UTR not found in OCR', score: 0, severity: 'missing' };
  const utr = extracted.value;
  if (utr.length < C.UTR_MIN_LENGTH) return { passed: false, reason: 'UTR too short: ' + utr.length + ' chars (min ' + C.UTR_MIN_LENGTH + ')', score: 0, severity: 'soft' };
  if (utr.length > C.UTR_MAX_LENGTH) return { passed: false, reason: 'UTR too long: ' + utr.length + ' chars (max ' + C.UTR_MAX_LENGTH + ')', score: 0, severity: 'soft' };
  return { passed: true, reason: 'UTR format valid (' + utr.length + ' chars)', score: 100, severity: 'none' };
}

function validateUserUtr(extractedUtr, userUtr) {
  if (!userUtr || !userUtr.trim()) return { passed: false, reason: 'No UTR entered by user', score: 0, isUserCheck: true, severity: 'missing' };
  if (!extractedUtr || !extractedUtr.value) return { passed: false, reason: 'Cannot verify user UTR: OCR UTR not available', score: 0, isUserCheck: true, severity: 'missing' };

  const cleanedUser = userUtr.trim().toUpperCase().replace(/[\s\-]/g, '');
  const cleanedOcr = extractedUtr.value.toUpperCase().replace(/[\s\-]/g, '');

  if (cleanedUser === cleanedOcr) return { passed: true, reason: 'User UTR matches OCR UTR', score: 100, isUserCheck: true, severity: 'none' };
  if (cleanedUser.includes(cleanedOcr) || cleanedOcr.includes(cleanedUser)) return { passed: true, reason: 'User UTR partially matches OCR UTR', score: 80, isUserCheck: true, severity: 'none' };

  const similarity = cleanedUser.length > 0 && cleanedOcr.length > 0
    ? Math.min(cleanedUser.length, cleanedOcr.length) / Math.max(cleanedUser.length, cleanedOcr.length)
    : 0;
  if (similarity > 0.8) return { passed: true, reason: 'User UTR closely matches OCR UTR (' + Math.round(similarity * 100) + '% similar)', score: 60, isUserCheck: true, severity: 'none' };

  return { passed: false, reason: 'User UTR (' + cleanedUser + ') does not match OCR UTR (' + cleanedOcr + ')', score: 0, isUserCheck: true, severity: 'hard' };
}

function validatePaymentStatus(extracted) {
  if (!extracted || !extracted.value) return { passed: false, reason: 'Payment status not found — assuming success (some apps hide status)', score: 50, severity: 'missing' };

  const s = extracted.value.toUpperCase();
  if (C.ACCEPTED_PAYMENT_STATUSES.has(s)) return { passed: true, reason: 'Payment status accepted: ' + s, score: 100, severity: 'none' };
  if (C.REJECTED_PAYMENT_STATUSES.has(s)) return { passed: false, reason: 'Payment status rejected: ' + s, score: 0, severity: 'hard' };

  return { passed: false, reason: 'Unknown payment status: ' + s, score: 40, severity: 'soft' };
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
