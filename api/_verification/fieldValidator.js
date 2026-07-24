const C = require('./config');
const log = require('./logger').VALIDATE;

function getNowIST() {
  const now = new Date();
  const utcStr = now.toISOString();
  const istMs = now.getTime() + 5.5 * 3600000;
  const istDate = new Date(istMs);
  return {
    getTime: () => now.getTime(),
    toISOString: () => now.toISOString(),
    getISTDateStr: () => istDate.toISOString().slice(0, 10),
    getISTTimeStr: () => istDate.toISOString().slice(11, 19),
  };
}

function toISTDate(date) {
  const istMs = date.getTime() + 5.5 * 3600000;
  return new Date(istMs).toISOString().slice(0, 10);
}

function validateAmount(extracted, expectedAmount) {
  if (!extracted || extracted.value === null) return { passed: false, reason: 'Amount not found in OCR', score: 0 };
  const e = Number(extracted.value);
  const ex = Number(expectedAmount);
  if (e === ex) return { passed: true, reason: 'Amount matches exactly (₹' + e + ')', score: 100 };
  if (C.TEST_MODE && C.TEST_PAYMENT_AMOUNT === e) return { passed: true, reason: 'Test mode: extracted ₹' + e + ' matches test amount', score: 100 };
  return { passed: false, reason: 'Amount mismatch: expected ₹' + ex + ', found ₹' + e, score: 0 };
}

function validateReceiverUpi(extracted) {
  if (!extracted || !extracted.value) return { passed: false, reason: 'Receiver UPI not found in OCR', score: 0 };
  const found = extracted.value.toLowerCase().trim();
  const expected = C.EXPECTED_RECEIVER_UPI.toLowerCase();
  if (found === expected) return { passed: true, reason: 'Receiver UPI matches exactly', score: 100 };
  const foundUser = found.split('@')[0];
  const expectedUser = expected.split('@')[0];
  if (foundUser === expectedUser) return { passed: true, reason: 'Receiver UPI username matches (domain differs: ' + found.split('@')[1] + ' vs ' + expected.split('@')[1] + ')', score: 80 };
  if (foundUser.includes(expectedUser) || expectedUser.includes(foundUser)) return { passed: true, reason: 'Receiver UPI partially matches', score: 60 };
  return { passed: false, reason: 'Receiver UPI mismatch: found ' + found + ', expected ' + expected, score: 0 };
}

function validateDate(extracted, orderCreatedAt) {
  if (!extracted || !extracted.value) return { passed: false, reason: 'Date not found in OCR', score: 0 };
  const nowIST = getNowIST();
  const today = nowIST.getISTDateStr();
  const extractedDate = extracted.value;
  if (extractedDate === today) return { passed: true, reason: 'Date is today (' + today + ')', score: 100 };
  const yesterdayIST = new Date(nowIST.getTime() - 86400000).toISOString().slice(0, 10);
  if (extractedDate === yesterdayIST) return { passed: true, reason: 'Date is yesterday (' + yesterdayIST + ')', score: 80 };
  const tomorrowIST = new Date(nowIST.getTime() + 86400000).toISOString().slice(0, 10);
  if (extractedDate === tomorrowIST) return { passed: true, reason: 'Date is tomorrow (timezone edge: ' + tomorrowIST + ')', score: 60 };
  if (orderCreatedAt) {
    const orderDate = toISTDate(new Date(orderCreatedAt));
    if (extractedDate === orderDate) return { passed: true, reason: 'Date matches order creation date (' + orderDate + ')', score: 90 };
  }
  return { passed: false, reason: 'Date mismatch: found ' + extractedDate + ', expected today (' + today + ')', score: 0 };
}

function validateTime(extracted, orderCreatedAt) {
  if (!extracted || !extracted.value) return { passed: false, reason: 'Time not found in OCR', score: 0 };
  const timeStr = extracted.value;
  const m = timeStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!m) return { passed: false, reason: 'Invalid time format: ' + timeStr, score: 0 };
  let hours = parseInt(m[1]);
  const minutes = parseInt(m[2]);
  if (m[4]) {
    const ampm = m[4].toUpperCase();
    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return { passed: false, reason: 'Invalid time: ' + timeStr, score: 0 };
  if (!orderCreatedAt) return { passed: true, reason: 'Time found: ' + timeStr + ' (no order time to compare)', score: 80 };
  const nowMs = Date.now();
  const orderTime = new Date(orderCreatedAt);
  const diffMs = Math.abs(nowMs - orderTime.getTime());
  const diffMinutes = diffMs / 60000;
  if (diffMinutes <= C.MAX_SESSION_AGE_MINUTES) return { passed: true, reason: 'Time within ' + C.MAX_SESSION_AGE_MINUTES + 'min window (' + Math.round(diffMinutes) + 'min)', score: 100 };
  if (diffMinutes <= C.MAX_SESSION_AGE_MINUTES * 2) return { passed: true, reason: 'Time slightly outside window (' + Math.round(diffMinutes) + 'min)', score: 60 };
  return { passed: false, reason: 'Time too old: ' + Math.round(diffMinutes) + 'min from session (max ' + C.MAX_SESSION_AGE_MINUTES + 'min)', score: 0 };
}

function validateUtr(extracted) {
  if (!extracted || !extracted.value) return { passed: false, reason: 'UTR not found in OCR', score: 0 };
  const utr = extracted.value;
  if (utr.length < C.UTR_MIN_LENGTH) return { passed: false, reason: 'UTR too short: ' + utr.length + ' chars (min ' + C.UTR_MIN_LENGTH + ')', score: 0 };
  if (utr.length > C.UTR_MAX_LENGTH) return { passed: false, reason: 'UTR too long: ' + utr.length + ' chars (max ' + C.UTR_MAX_LENGTH + ')', score: 0 };
  if (!/^[A-Z0-9]+$/i.test(utr)) return { passed: false, reason: 'UTR contains invalid characters', score: 0 };
  return { passed: true, reason: 'UTR format valid (' + utr.length + ' chars)', score: 100 };
}

function validateUserUtr(extractedUtr, userUtr) {
  if (!userUtr || !userUtr.trim()) return { passed: false, reason: 'No UTR entered by user', score: 0, isUserCheck: true };
  if (!extractedUtr || !extractedUtr.value) return { passed: false, reason: 'Cannot verify user UTR: OCR UTR not available', score: 0, isUserCheck: true };
  const cleanedUser = userUtr.trim().toUpperCase().replace(/\s+/g, '');
  const cleanedOcr = extractedUtr.value.toUpperCase().replace(/\s+/g, '');
  if (cleanedUser === cleanedOcr) return { passed: true, reason: 'User UTR matches OCR UTR', score: 100, isUserCheck: true };
  if (cleanedUser.includes(cleanedOcr) || cleanedOcr.includes(cleanedUser)) return { passed: true, reason: 'User UTR partially matches OCR UTR', score: 70, isUserCheck: true };
  return { passed: false, reason: 'User UTR (' + cleanedUser + ') does not match OCR UTR (' + cleanedOcr + ')', score: 0, isUserCheck: true };
}

function validatePaymentStatus(extracted) {
  if (!extracted || !extracted.value) return { passed: false, reason: 'Payment status not found', score: 0 };
  const s = extracted.value.toUpperCase();
  if (C.ACCEPTED_PAYMENT_STATUSES.has(s)) return { passed: true, reason: 'Payment status accepted: ' + s, score: 100 };
  if (C.REJECTED_PAYMENT_STATUSES.has(s)) return { passed: false, reason: 'Payment status rejected: ' + s, score: 0 };
  return { passed: false, reason: 'Unknown payment status: ' + s, score: 30 };
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
  const mandatoryPassed = checks.filter(c => !c.isUserCheck && c.passed).length;
  const mandatoryTotal = checks.filter(c => !c.isUserCheck).length;
  const allMandatoryPass = mandatoryPassed === mandatoryTotal;
  log.info('', 'Validation: ' + mandatoryPassed + '/' + mandatoryTotal + ' mandatory pass (' + (Date.now() - t0) + 'ms)');
  return { checks, allMandatoryPass, mandatoryPassed, mandatoryTotal, duration: Date.now() - t0 };
}

module.exports = { run, validateAmount, validateReceiverUpi, validateDate, validateTime, validateUtr, validateUserUtr, validatePaymentStatus };
