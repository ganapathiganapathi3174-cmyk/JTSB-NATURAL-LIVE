const C = require('./config');
const log = require('./logger').VALIDATE;

function getISTDate() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() + (330 + offset) * 60000);
}

function getToday() {
  return getISTDate().toISOString().slice(0, 10);
}

function getRelativeDate(daysOffset) {
  const d = getISTDate();
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString().slice(0, 10);
}

function getCurrentTimeMinutes() {
  const ist = getISTDate();
  return ist.getHours() * 60 + ist.getMinutes();
}

function getCurrentISTMinutesSinceEpoch() {
  return Math.floor(getISTDate().getTime() / 60000);
}

function diceSimilarity(a, b) {
  if (a === b) return 1.0;
  if (!a || !b) return 0.0;
  const bigramsA = new Set();
  const bigramsB = new Set();
  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.substring(i, i + 2));
  for (let i = 0; i < b.length - 1; i++) bigramsB.add(b.substring(i, i + 2));
  if (bigramsA.size === 0 && bigramsB.size === 0) return a === b ? 1.0 : 0.0;
  let intersection = 0;
  for (const bg of bigramsA) { if (bigramsB.has(bg)) intersection++; }
  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

function normalizeName(name) {
  return name.replace(/\s+/g, ' ').replace(/[^\w\s]/g, '').trim().toUpperCase();
}

function parsePaymentMinutes(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const parts = timeStr.split(':');
  if (parts.length < 2) return null;
  const h = parseInt(parts[0]), m = parseInt(parts[1]);
  if (isNaN(h) || isNaN(m)) return null;
  const d = new Date(dateStr + 'T' + String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':00+05:30');
  return Math.floor(d.getTime() / 60000);
}

function isPaymentWithinWindow(dateStr, timeStr) {
  const paymentMinutes = parsePaymentMinutes(dateStr, timeStr);
  if (paymentMinutes === null) return false;
  const nowMinutes = getCurrentISTMinutesSinceEpoch();
  const diff = Math.abs(nowMinutes - paymentMinutes);
  return diff <= C.TIME_WINDOW_MINUTES;
}

function validateAmount(normalized, expectedAmount) {
  if (normalized.normalized === null) return { field: 'amount', passed: false, expectedValue: expectedAmount, extractedValue: normalized.original, severity: 'hard', reason: 'Amount not detected' };
  if (normalized.normalized !== expectedAmount) return { field: 'amount', passed: false, expectedValue: expectedAmount, extractedValue: normalized.normalized, severity: 'hard', reason: 'Amount mismatch: expected ' + expectedAmount + ', found ' + normalized.normalized };
  return { field: 'amount', passed: true, expectedValue: expectedAmount, extractedValue: normalized.normalized, severity: 'none', reason: 'Amount matches exactly (' + expectedAmount + ')' };
}

function validateReceiverName(normalized) {
  if (normalized.normalized === null) return { field: 'receiver_name', passed: false, expectedValue: C.EXPECTED_RECEIVER_NAME, extractedValue: normalized.original, severity: 'hard', reason: 'Receiver name not detected' };
  const extracted = normalizeName(String(normalized.normalized));
  const expected = normalizeName(C.EXPECTED_RECEIVER_NAME);
  const sim = diceSimilarity(extracted, expected);
  if (sim >= 0.95) return { field: 'receiver_name', passed: true, expectedValue: C.EXPECTED_RECEIVER_NAME, extractedValue: normalized.normalized, severity: 'none', reason: 'Receiver name matches (similarity=' + sim.toFixed(3) + ')' };
  if (sim >= 0.80) return { field: 'receiver_name', passed: false, expectedValue: C.EXPECTED_RECEIVER_NAME, extractedValue: normalized.normalized, severity: 'soft', reason: 'Receiver name partial match (similarity=' + sim.toFixed(3) + '), manual review' };
  return { field: 'receiver_name', passed: false, expectedValue: C.EXPECTED_RECEIVER_NAME, extractedValue: normalized.normalized, severity: 'hard', reason: 'Receiver name mismatch (similarity=' + sim.toFixed(3) + ')' };
}

function validateReceiverUpi(normalized) {
  if (normalized.normalized === null) return { field: 'receiver_upi', passed: false, expectedValue: C.EXPECTED_RECEIVER_UPI, extractedValue: normalized.original, severity: 'hard', reason: 'Receiver UPI not detected' };
  if (normalized.normalized !== C.EXPECTED_RECEIVER_UPI) return { field: 'receiver_upi', passed: false, expectedValue: C.EXPECTED_RECEIVER_UPI, extractedValue: normalized.normalized, severity: 'hard', reason: 'Receiver UPI mismatch' };
  return { field: 'receiver_upi', passed: true, expectedValue: C.EXPECTED_RECEIVER_UPI, extractedValue: normalized.normalized, severity: 'none', reason: 'Receiver UPI matches exactly' };
}

function validatePaymentStatus(normalized) {
  if (normalized.normalized === null) return { field: 'payment_status', passed: false, expectedValue: 'SUCCESS', extractedValue: normalized.original, severity: 'hard', reason: 'Payment status not detected' };
  if (normalized.normalized !== 'SUCCESS') return { field: 'payment_status', passed: false, expectedValue: 'SUCCESS', extractedValue: normalized.normalized, severity: 'hard', reason: 'Payment status is ' + normalized.normalized + ', expected SUCCESS' };
  return { field: 'payment_status', passed: true, expectedValue: 'SUCCESS', extractedValue: normalized.normalized, severity: 'none', reason: 'Payment status accepted: SUCCESS' };
}

function validateDate(normalized, normalizedTime) {
  const today = getToday();
  if (normalized.normalized === null) return { field: 'date', passed: false, expectedValue: today, extractedValue: normalized.original, severity: 'hard', reason: 'Date not detected' };
  if (normalized.normalized === today) return { field: 'date', passed: true, expectedValue: today, extractedValue: normalized.normalized, severity: 'none', reason: 'Date is today (' + today + ')' };

  const timeStr = normalizedTime && normalizedTime.normalized;
  if (isPaymentWithinWindow(normalized.normalized, timeStr)) {
    const timeInfo = timeStr ? ' at ' + timeStr : '';
    return { field: 'date', passed: true, expectedValue: today, extractedValue: normalized.normalized, severity: 'none', reason: 'Date ' + normalized.normalized + timeInfo + ' is within verification window (cross-midnight)' };
  }

  return { field: 'date', passed: false, expectedValue: today, extractedValue: normalized.normalized, severity: 'hard', reason: 'Date is ' + normalized.normalized + ', expected today ' + today };
}

function validateTime(normalized) {
  if (normalized.normalized === null) return { field: 'time', passed: false, expectedValue: 'within ' + C.TIME_WINDOW_MINUTES + 'min', extractedValue: normalized.original, severity: 'soft', reason: 'Time not detected' };
  const parts = normalized.normalized.split(':');
  const h = parseInt(parts[0]), m = parseInt(parts[1]);
  const extractedMinutes = h * 60 + m;
  const currentMinutes = getCurrentTimeMinutes();
  const diff = Math.abs(extractedMinutes - currentMinutes);
  if (diff <= C.TIME_WINDOW_MINUTES) return { field: 'time', passed: true, expectedValue: 'within ' + C.TIME_WINDOW_MINUTES + 'min', extractedValue: normalized.normalized, severity: 'none', reason: 'Time within ' + diff + 'min of server time' };
  return { field: 'time', passed: false, expectedValue: 'within ' + C.TIME_WINDOW_MINUTES + 'min', extractedValue: normalized.normalized, severity: 'soft', reason: 'Time outside window: ' + diff + 'min difference (max ' + C.TIME_WINDOW_MINUTES + 'min)' };
}

function validateUtr(normalized) {
  if (normalized.normalized === null) return { field: 'utr', passed: false, expectedValue: 'valid 10-45 char alphanumeric', extractedValue: normalized.original, severity: 'hard', reason: 'UTR not detected' };
  if (normalized.normalized.length < C.UTR_MIN_LENGTH) return { field: 'utr', passed: false, expectedValue: 'min ' + C.UTR_MIN_LENGTH + ' chars', extractedValue: normalized.normalized, severity: 'hard', reason: 'UTR too short: ' + normalized.normalized.length + ' chars' };
  if (!/^[A-Z0-9]+$/.test(normalized.normalized)) return { field: 'utr', passed: false, expectedValue: 'alphanumeric', extractedValue: normalized.normalized, severity: 'hard', reason: 'UTR contains invalid characters' };
  return { field: 'utr', passed: true, expectedValue: 'valid format', extractedValue: normalized.normalized, severity: 'none', reason: 'UTR format valid (' + normalized.normalized.length + ' chars)' };
}

function validateUserUtrMatch(normalized, userUtr) {
  if (!userUtr) return { field: 'user_utr', passed: true, expectedValue: null, extractedValue: normalized.normalized, severity: 'none', reason: 'No user UTR provided for comparison' };
  if (normalized.normalized === null) return { field: 'user_utr', passed: false, expectedValue: userUtr, extractedValue: normalized.original, severity: 'hard', reason: 'UTR not detected in screenshot' };
  const userNorm = String(userUtr).replace(/[\s\-]/g, '').toUpperCase();
  if (normalized.normalized === userNorm) return { field: 'user_utr', passed: true, expectedValue: userUtr, extractedValue: normalized.normalized, severity: 'none', reason: 'UTR matches user input' };
  if (normalized.normalized.includes(userNorm) || userNorm.includes(normalized.normalized)) return { field: 'user_utr', passed: true, expectedValue: userUtr, extractedValue: normalized.normalized, severity: 'none', reason: 'UTR partially matches user input (substring match)' };
  return { field: 'user_utr', passed: false, expectedValue: userUtr, extractedValue: normalized.normalized, severity: 'hard', reason: 'UTR mismatch: OCR found ' + normalized.normalized + ', user entered ' + userNorm };
}

function run(normalized, order, userUtr) {
  const t0 = Date.now();
  const expectedAmount = Number(order.amount) || 0;

  const checks = [
    validateAmount(normalized.amount, expectedAmount),
    validateReceiverName(normalized.receiverName),
    validateReceiverUpi(normalized.receiverUpi),
    validatePaymentStatus(normalized.paymentStatus),
    validateDate(normalized.date, normalized.time),
    validateTime(normalized.time),
    validateUtr(normalized.utr),
    validateUserUtrMatch(normalized.utr, userUtr),
  ];

  const validationMap = {};
  let hardFailures = 0;
  let softFailures = 0;
  let allMandatoryPass = true;

  for (const check of checks) {
    validationMap[check.field] = { passed: check.passed, expectedValue: check.expectedValue, extractedValue: check.extractedValue, reason: check.reason };
    if (!check.passed) {
      if (check.severity === 'hard') { hardFailures++; allMandatoryPass = false; }
      else softFailures++;
    }
  }

  log.info('Validation: ' + Object.values(checks).filter(c => c.passed).length + '/' + checks.length + ' pass, hard=' + hardFailures + ' soft=' + softFailures + ' (' + (Date.now() - t0) + 'ms)');
  return { validationMap, hardFailures, softFailures, allMandatoryPass };
}

module.exports = { run, validateAmount, validateReceiverName, validateReceiverUpi, validatePaymentStatus, validateDate, validateTime, validateUtr, validateUserUtrMatch, getToday, getCurrentTimeMinutes, diceSimilarity };