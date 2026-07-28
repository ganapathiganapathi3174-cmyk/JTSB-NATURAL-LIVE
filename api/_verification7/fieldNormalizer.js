const C = require('./config.js');

function normalizeDate(raw) {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (!m) return null;
  let d = parseInt(m[1]), mo = parseInt(m[2]), y = parseInt(m[3]);
  if (y < 100) y += 2000;
  if (d > 31) { const t = d; d = mo; mo = t; }
  const pad = n => String(n).padStart(2, '0');
  return { year: y, month: mo, day: d, iso: y + '-' + pad(mo) + '-' + pad(d), raw };
}

function normalizeTime(raw) {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!m) return null;
  let h = parseInt(m[1]), mi = parseInt(m[2]), s = m[3] ? parseInt(m[3]) : 0;
  const ap = m[4] ? m[4].toUpperCase() : null;
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  const pad = n => String(n).padStart(2, '0');
  return { hours: h, minutes: mi, seconds: s, iso: pad(h) + ':' + pad(mi) + ':' + pad(s), raw };
}

function normalizeAmount(raw) {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === 'string' ? parseFloat(raw.replace(/[^\d.]/g, '')) : raw;
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

function normalize(fields) {
  return {
    amount: normalizeAmount(fields?.amount?.value),
    utr: fields?.utr?.value || null,
    upi: fields?.upi?.value ? fields.upi.value.toLowerCase().trim() : null,
    name: fields?.name?.value ? fields.name.value.toUpperCase().trim() : null,
    date: normalizeDate(fields?.date?.value),
    time: normalizeTime(fields?.time?.value),
    status: fields?.status?.value || null,
  };
}

function isTodayOrYesterday(dateObj) {
  if (!dateObj) return false;
  const now = new Date();
  const d = new Date(dateObj.year, dateObj.month - 1, dateObj.day);
  const diff = Math.abs(now - d) / (1000 * 60 * 60 * 24);
  return diff <= C.DATE_TOLERANCE_DAYS;
}

module.exports = { normalize, isTodayOrYesterday };
