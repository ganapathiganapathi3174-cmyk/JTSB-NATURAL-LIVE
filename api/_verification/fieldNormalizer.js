const log = require('./logger').NORMALIZE;

function normalizeAmount(raw) {
  if (raw === null || raw === undefined) return { normalized: null, original: raw };
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^0-9.]/g, ''));
  if (isNaN(n) || n <= 0) return { normalized: null, original: raw, issue: 'Non-numeric amount' };
  return { normalized: Math.round(n), original: raw };
}

function normalizeUtr(raw) {
  if (!raw) return { normalized: null, original: raw };
  const u = String(raw).replace(/[\s\-]/g, '').toUpperCase();
  if (u.length < 6) return { normalized: null, original: raw, issue: 'Too short' };
  return { normalized: u, original: raw };
}

function normalizeReceiverUpi(raw) {
  if (!raw) return { normalized: null, original: raw };
  const u = String(raw).toLowerCase().replace(/[^a-z0-9@._-]/g, '');
  if (!u.includes('@')) return { normalized: null, original: raw, issue: 'Missing @' };
  return { normalized: u, original: raw };
}

function normalizeReceiverName(raw) {
  if (!raw) return { normalized: null, original: raw };
  const n = String(raw).toUpperCase().replace(/\s+/g, ' ').trim();
  if (n.length < 2) return { normalized: null, original: raw, issue: 'Too short' };
  return { normalized: n, original: raw };
}

function normalizeDate(raw) {
  if (!raw) return { normalized: null, original: raw };
  const d = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return { normalized: d, original: raw };
  const m = d.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    let y = parseInt(m[3]); if (y < 100) y += 2000;
    const mo = String(parseInt(m[2])).padStart(2, '0');
    const day = String(parseInt(m[1])).padStart(2, '0');
    return { normalized: y + '-' + mo + '-' + day, original: raw };
  }
  return { normalized: d, original: raw };
}

function normalizeTime(raw) {
  if (!raw) return { normalized: null, original: raw };
  const t = String(raw).trim().toUpperCase();
  const m = t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/);
  if (m) {
    let h = parseInt(m[1]), min = parseInt(m[2]), ampm = m[4] || '';
    if (ampm === 'PM' && h < 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return { normalized: String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0'), original: raw };
  }
  return { normalized: t, original: raw };
}

function normalizeTransactionId(raw) {
  if (!raw) return { normalized: null, original: raw };
  const id = String(raw).trim().toUpperCase();
  if (id.length < 4) return { normalized: null, original: raw, issue: 'Too short' };
  return { normalized: id, original: raw };
}

function normalizePaymentStatus(raw) {
  if (!raw) return { normalized: null, original: raw };
  const s = String(raw).toUpperCase().trim();
  const successWords = ['SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'PAID', 'CREDITED', 'RECEIVED', 'SENT', 'DONE'];
  const failWords = ['FAILED', 'REJECTED', 'DECLINED', 'CANCELLED', 'UNSUCCESSFUL', 'REVERSED', 'EXPIRED'];
  const pendingWords = ['PENDING', 'PROCESSING', 'INITIATED', 'AWAITING'];
  if (successWords.some(w => s.includes(w))) return { normalized: 'SUCCESS', original: raw };
  if (failWords.some(w => s.includes(w))) return { normalized: 'FAILED', original: raw };
  if (pendingWords.some(w => s.includes(w))) return { normalized: 'PENDING', original: raw };
  return { normalized: s, original: raw };
}

function normalizeAll(extracted) {
  const t0 = Date.now();
  const result = {
    amount: normalizeAmount(extracted.amount ? extracted.amount.value : null),
    utr: normalizeUtr(extracted.utr ? extracted.utr.value : null),
    receiverUpi: normalizeReceiverUpi(extracted.receiverUpi ? extracted.receiverUpi.value : null),
    receiverName: normalizeReceiverName(extracted.receiverName ? extracted.receiverName.value : null),
    transactionId: normalizeTransactionId(extracted.transactionId ? extracted.transactionId.value : null),
    date: normalizeDate(extracted.date ? extracted.date.value : null),
    time: normalizeTime(extracted.time ? extracted.time.value : null),
    paymentStatus: normalizePaymentStatus(extracted.paymentStatus ? extracted.paymentStatus.value : null),
  };
  log.info('Normalized ' + Object.values(result).filter(v => v.normalized !== null).length + '/8 fields (' + (Date.now() - t0) + 'ms)');
  return result;
}

module.exports = { normalizeAll, normalizeAmount, normalizeUtr, normalizeReceiverUpi, normalizeReceiverName, normalizeDate, normalizeTime, normalizeTransactionId, normalizePaymentStatus };