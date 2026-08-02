const C = require('./config.js');
const { normalizeUTR, normalizeUPI, isDateTodayIST, isTimeWithinWindow } = require('./fieldNormalizer.js');

function validateRules(extracted, expected) {
  const result = {
    passed: true, checks: {}, reasons: [],
    hardFail: false, softFail: false,
  };

  const amount = typeof extracted.amount === 'number' ? extracted.amount : null;
  const expectedAmount = typeof expected?.amount === 'number' ? expected.amount : null;
  if (amount !== null && expectedAmount !== null) {
    const diff = Math.abs(amount - expectedAmount);
    const exact = diff === 0;
    const close = diff <= 1 || diff <= expectedAmount * 0.05;
    result.checks.amount = exact ? 'matched' : (close ? 'close_match' : 'mismatch');
    if (!exact) {
      result.reasons.push('Amount mismatch: extracted=' + amount + ' expected=' + expectedAmount);
      if (!close) result.softFail = true;
    }
  } else if (amount === null) {
    result.checks.amount = 'unreadable';
    result.reasons.push('Amount not readable');
    result.softFail = true;
  } else {
    result.checks.amount = 'no_expected';
  }

  const utr = extracted.utr ? normalizeUTR(extracted.utr) : null;
  const expectedUtr = expected?.utr ? normalizeUTR(expected.utr) : null;
  if (utr && expectedUtr) {
    const exact = utr === expectedUtr;
    const partial = utr.includes(expectedUtr) || expectedUtr.includes(utr);
    result.checks.utr = exact ? 'matched' : (partial ? 'partial_match' : 'mismatch');
    if (!exact && !partial) {
      // OCR of UTRs is error-prone; a single mismatch is a SOFT signal.
      result.reasons.push('UTR mismatch: extracted=' + utr + ' expected=' + expectedUtr);
      result.softFail = true;
    } else if (!exact) {
      result.reasons.push('UTR partial match');
    }
  } else if (!utr) {
    result.checks.utr = 'unreadable';
    result.reasons.push('UTR not readable');
    result.softFail = true;
  } else {
    result.checks.utr = 'no_expected';
  }

  const upi = extracted.upi_id ? normalizeUPI(extracted.upi_id) : null;
  const expectedUpi = normalizeUPI(C.RECEIVER_UPI);
  if (upi && expectedUpi) {
    const exact = upi === expectedUpi;
    const partial = upi.includes(expectedUpi) || expectedUpi.includes(upi);
    result.checks.upi_id = exact ? 'matched' : (partial ? 'partial_match' : 'mismatch');
    if (!exact && !partial) {
      // Single UPI mismatch is a SOFT signal (handled by the risk/decision engine).
      result.reasons.push('UPI mismatch: extracted=' + upi + ' expected=' + expectedUpi);
      result.softFail = true;
    }
  } else if (!upi) {
    result.checks.upi_id = 'unreadable';
    result.reasons.push('UPI ID not readable');
    result.softFail = true;
  }

  const status = extracted.status ? extracted.status.toUpperCase() : null;
  if (status) {
    result.checks.status = status === 'SUCCESS' ? 'success' : (status === 'FAILED' ? 'failed' : 'pending');
    if (status === 'FAILED') {
      // A confirmed FAILED status is the single strongest independent reject signal.
      result.reasons.push('Payment status indicates failure');
      result.hardFail = true;
    } else if (status !== 'SUCCESS') {
      result.reasons.push('Payment status: ' + status);
      result.softFail = true;
    }
  } else {
    result.checks.status = 'unreadable';
  }

  // ── Date: must be TODAY in Asia/Kolkata (never UTC) ──────────────
  const date = extracted.date || null;
  if (date) {
    const todayIst = isDateTodayIST(date);
    result.checks.date = todayIst ? 'today_ist' : 'distant';
    if (!todayIst) {
      result.reasons.push('Date mismatch: extracted=' + date + ' is not today (IST)');
      result.softFail = true;
    }
  } else {
    result.checks.date = 'unreadable';
  }

  // ── Time: screenshot payment time must be within ±TIME_WINDOW_MIN
  //    minutes of the server's current time in Asia/Kolkata. Screenshots
  //    showing an old payment (e.g. submitted hours later) fall to
  //    manual review — they are never auto-approved.
  const time = extracted.time || null;
  if (time) {
    const inWindow = isTimeWithinWindow(time, C.TIME_WINDOW_MIN);
    result.checks.time = inWindow ? 'within_window' : 'out_of_window';
    if (!inWindow) {
      result.reasons.push('Time mismatch: extracted=' + time + ' is outside ±' + C.TIME_WINDOW_MIN + 'min window (IST)');
      result.softFail = true;
    }
  } else {
    result.checks.time = 'unreadable';
    result.reasons.push('Payment time not readable');
    result.softFail = true;
  }

  result.passed = !result.hardFail;
  return result;
}

module.exports = { validateRules };
