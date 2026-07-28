const C = require('./config.js');
const { isTodayOrYesterday } = require('./fieldNormalizer.js');

function validate(normalized, expected) {
  const ctx = {
    amount: false, utr: false, upi: false, name: false, date: false, time: false, status: false,
    hardFails: [], softFails: [], warns: [],
    details: {},
  };

  const expAmt = expected && expected.amount ? expected.amount : null;
  const expUtr = expected && expected.utr ? expected.utr.toUpperCase().trim() : null;

  if (normalized.amount !== null && expAmt !== null) {
    ctx.amount = Math.abs(normalized.amount - expAmt) < C.AMOUNT_TOLERANCE;
    ctx.details.amount = { extracted: normalized.amount, expected: expAmt, match: ctx.amount };
    if (!ctx.amount) ctx.warns.push('Amount mismatch: extracted=' + normalized.amount + ' expected=' + expAmt);
  } else if (normalized.amount === null) {
    ctx.warns.push('Amount not extractable from screenshot');
  }

  if (normalized.utr && expUtr) {
    ctx.utr = normalized.utr.toUpperCase() === expUtr;
    ctx.details.utr = { extracted: normalized.utr, expected: expUtr, match: ctx.utr };
    if (!ctx.utr) ctx.hardFails.push('UTR mismatch');
  } else if (normalized.utr === null) {
    ctx.warns.push('UTR not extractable from screenshot');
  }

  if (normalized.upi) {
    ctx.upi = normalized.upi === C.RECEIVER_UPI;
    ctx.details.upi = { extracted: normalized.upi, expected: C.RECEIVER_UPI, match: ctx.upi };
    if (!ctx.upi) ctx.hardFails.push('UPI ID mismatch: extracted=' + normalized.upi + ' expected=' + C.RECEIVER_UPI);
  } else {
    ctx.warns.push('UPI ID not extractable from screenshot');
  }

  if (normalized.name) {
    const expectedName = C.RECEIVER_NAME.toUpperCase();
    const extractedName = normalized.name.toUpperCase();
    ctx.name = extractedName.includes(expectedName) || expectedName.includes(extractedName);
    ctx.details.name = { extracted: normalized.name, expected: C.RECEIVER_NAME, match: ctx.name };
    if (!ctx.name) ctx.softFails.push('Receiver name mismatch');
  } else {
    ctx.softFails.push('Receiver name not found in screenshot');
  }

  if (normalized.date) {
    ctx.date = isTodayOrYesterday(normalized.date);
    ctx.details.date = { extracted: normalized.date.iso, match: ctx.date };
    if (!ctx.date) ctx.softFails.push('Payment date outside acceptable window');
  } else {
    ctx.softFails.push('Date not extractable from screenshot');
  }

  if (normalized.time) {
    ctx.time = true;
    ctx.details.time = { extracted: normalized.time.iso, match: true };
  }

  if (normalized.status) {
    ctx.status = normalized.status === 'SUCCESS';
    ctx.details.status = { extracted: normalized.status, match: ctx.status };
    if (!ctx.status) ctx.hardFails.push('Payment status is not SUCCESS: ' + normalized.status);
  }

  return ctx;
}

module.exports = { validate };
