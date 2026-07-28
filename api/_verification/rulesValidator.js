const C = require('./config');

function today() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 330 + d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function nowMin() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 330 + d.getTimezoneOffset());
  return d.getHours() * 60 + d.getMinutes();
}

function check(value, expected, label) {
  if (!value || value.value === null || value.value === undefined) {
    return { field: label, pass: false, expected, got: null, reason: 'Not detected' };
  }
  if (String(value.value) !== String(expected)) {
    return { field: label, pass: false, expected, got: value.value, reason: 'Expected ' + expected + ', got ' + value.value };
  }
  return { field: label, pass: true, expected, got: value.value, reason: 'OK' };
}

function validateAmount(field, orderAmount) {
  if (!field || field.value === null || field.value === undefined) {
    return { field: 'amount', pass: false, expected: orderAmount, got: null, reason: 'Amount not found in screenshot' };
  }
  if (field.value !== orderAmount) {
    return { field: 'amount', pass: false, expected: orderAmount, got: field.value, reason: 'Screenshot shows ' + field.value + ', expected ' + orderAmount };
  }
  return { field: 'amount', pass: true, expected: orderAmount, got: field.value, reason: 'Amount matches' };
}

function validateName(field) {
  if (!field || field.value === null || field.value === undefined) {
    return { field: 'receiver_name', pass: false, expected: C.RECEIVER_NAME, got: null, reason: 'Name not found' };
  }
  const clean = String(field.value).toUpperCase().replace(/\s+/g, ' ').trim();
  if (clean !== C.RECEIVER_NAME) {
    return { field: 'receiver_name', pass: false, expected: C.RECEIVER_NAME, got: field.value, reason: 'Name mismatch' };
  }
  return { field: 'receiver_name', pass: true, expected: C.RECEIVER_NAME, got: field.value, reason: 'Name matches' };
}

function validateUpi(field) {
  return check(field, C.RECEIVER_UPI, 'receiver_upi');
}

function validateStatus(field) {
  if (!field || field.value === null || field.value === undefined) {
    return { field: 'payment_status', pass: false, expected: 'SUCCESS', got: null, reason: 'Status not found' };
  }
  if (field.value !== 'SUCCESS') {
    return { field: 'payment_status', pass: false, expected: 'SUCCESS', got: field.value, reason: 'Status is ' + field.value };
  }
  return { field: 'payment_status', pass: true, expected: 'SUCCESS', got: field.value, reason: 'Status OK' };
}

function validateDate(field) {
  const t = today();
  if (!field || field.value === null || field.value === undefined) {
    return { field: 'date', pass: false, expected: t, got: null, reason: 'Date not found' };
  }
  if (field.value !== t) {
    return { field: 'date', pass: false, expected: t, got: field.value, reason: 'Date is ' + field.value + ', expected ' + t };
  }
  return { field: 'date', pass: true, expected: t, got: field.value, reason: 'Date is today' };
}

function validateTime(field) {
  const w = C.TIME_WINDOW_MINUTES;
  if (!field || field.value === null || field.value === undefined) {
    return { field: 'time', pass: false, expected: 'within ' + w + 'min', got: null, reason: 'Time not found', severity: 'soft' };
  }
  const parts = field.value.split(':');
  const pm = parseInt(parts[0]) * 60 + parseInt(parts[1]);
  const nm = nowMin();
  const diff = Math.abs(pm - nm);
  if (diff > w) {
    return { field: 'time', pass: false, expected: 'within ' + w + 'min', got: field.value, reason: diff + 'min outside window', severity: 'soft' };
  }
  return { field: 'time', pass: true, expected: 'within ' + w + 'min', got: field.value, reason: 'Time OK (' + diff + 'min)' };
}

function validateUtr(field) {
  if (!field || field.value === null || field.value === undefined) {
    return { field: 'utr', pass: false, expected: 'valid ref', got: null, reason: 'UTR not found' };
  }
  if (String(field.value).length < 6) {
    return { field: 'utr', pass: false, expected: '>=6 chars', got: field.value, reason: 'UTR too short' };
  }
  return { field: 'utr', pass: true, expected: 'valid ref', got: field.value, reason: 'UTR extracted' };
}

function run(fields, orderAmount) {
  const results = [
    validateAmount(fields.amount, orderAmount),
    validateName(fields.receiverName),
    validateUpi(fields.receiverUpi),
    validateStatus(fields.paymentStatus),
    validateDate(fields.date),
    validateTime(fields.time),
    validateUtr(fields.utr),
  ];
  const hard = results.filter(r => !r.pass && (!r.severity || r.severity !== 'soft'));
  const soft = results.filter(r => !r.pass && r.severity === 'soft');
  return { results, hard, soft, pass: hard.length === 0 };
}

module.exports = { run, validateAmount, validateName, validateUpi, validateStatus, validateDate, validateTime, validateUtr };