const C = require('./config.js');
const { normalizeUTR, normalizeUPI, isTodayOrNear } = require('./fieldNormalizer.js');

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
      result.reasons.push('UTR mismatch: extracted=' + utr + ' expected=' + expectedUtr);
      result.hardFail = true;
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
      result.reasons.push('UPI mismatch: extracted=' + upi + ' expected=' + expectedUpi);
      result.hardFail = true;
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
      result.reasons.push('Payment status indicates failure');
      result.hardFail = true;
    } else if (status !== 'SUCCESS') {
      result.reasons.push('Payment status: ' + status);
      result.softFail = true;
    }
  } else {
    result.checks.status = 'unreadable';
  }

  const date = extracted.date || null;
  if (date) {
    const near = isTodayOrNear(date, 1);
    result.checks.date = near ? 'today_or_near' : 'distant';
    if (!near) {
      result.reasons.push('Date mismatch: extracted=' + date + ' not near today');
      result.softFail = true;
    }
  } else {
    result.checks.date = 'unreadable';
  }

  result.passed = !result.hardFail;
  return result;
}

module.exports = { validateRules };
