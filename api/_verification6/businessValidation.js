const C = require('./config.js');

function validate(fields, expected) {
  const ctx = { amount: false, utr: false, upi: false, name: false, date: false, time: false, status: false, hardFails: [], softFails: [], warns: [] };
  const expectedAmount = expected && expected.amount ? expected.amount : null;
  const expectedUtr = expected && expected.utr ? expected.utr.toUpperCase() : null;
  if (fields.amount !== null && expectedAmount !== null) {
    ctx.amount = Math.abs(fields.amount - expectedAmount) < 0.01;
    if (!ctx.amount) ctx.softFails.push('Amount mismatch');
  }
  if (fields.utr && expectedUtr) {
    ctx.utr = fields.utr.toUpperCase() === expectedUtr;
    if (!ctx.utr) ctx.hardFails.push('UTR mismatch');
  }
  if (fields.upi) {
    ctx.upi = fields.upi === C.RECEIVER_UPI;
    if (!ctx.upi) ctx.hardFails.push('UPI ID mismatch');
  }
  if (fields.name) {
    const expectedName = C.RECEIVER_NAME;
    ctx.name = fields.name.toUpperCase().includes(expectedName) || expectedName.includes(fields.name.toUpperCase());
    if (!ctx.name) ctx.softFails.push('Receiver name mismatch');
  }
  if (fields.date) {
    ctx.date = true;
  }
  if (fields.time) {
    ctx.time = true;
  }
  if (fields.status) {
    ctx.status = fields.status === 'SUCCESS';
    if (!ctx.status) ctx.hardFails.push('Payment status is not SUCCESS');
  }
  return ctx;
}

module.exports = { validate };
