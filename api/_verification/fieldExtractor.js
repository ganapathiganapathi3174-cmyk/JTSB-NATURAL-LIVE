const C = require('./config');

function single(regex, text) {
  if (!text) return null;
  const m = text.match(regex);
  if (!m) return null;
  return (m[1] || m[0]).trim();
}

function amount(text) {
  const r = single(/(?:RS\.?|INR|₹)\s*[:.]?\s*([\d,]+)/i, text);
  if (r) return { value: parseInt(r.replace(/,/g, '')), source: 'label' };
  const digits = text.replace(/[^0-9]/g, '');
  for (const a of C.ALLOWED_AMOUNTS) {
    if (digits.includes(String(a))) return { value: a, source: 'digit' };
  }
  return null;
}

function utr(text) {
  const r = single(/(?:UTR|RRN|REF)\s*:?\s*([A-Z0-9]{6,40})/i, text);
  if (r) return { value: r.toUpperCase(), source: 'label' };
  const fallback = text.match(/\b([A-Z0-9]{12,22})\b/);
  if (fallback) return { value: fallback[1].toUpperCase(), source: 'pattern' };
  return null;
}

function upi(text) {
  const escaped = C.RECEIVER_UPI.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const known = single(new RegExp('(' + escaped + ')', 'i'), text);
  if (known) return { value: known.toLowerCase(), source: 'label' };
  const r = single(/\b([\w.\-]+@[\w.]+)\b/i, text);
  if (r && r.includes('@')) return { value: r.toLowerCase(), source: 'pattern' };
  return null;
}

function rname(text) {
  const escaped = C.RECEIVER_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const known = single(new RegExp('(' + escaped + ')', 'i'), text);
  if (known) return { value: known.toUpperCase(), source: 'exact' };
  const parts = C.RECEIVER_NAME.split(/\s+/);
  const upper = (text || '').toUpperCase();
  const found = parts.filter(p => upper.includes(p));
  if (found.length >= 2) return { value: C.RECEIVER_NAME, source: 'partial' };
  const upiVal = upi(text);
  if (upiVal && upiVal.value === C.RECEIVER_UPI) return { value: C.RECEIVER_NAME, source: 'inferred' };
  return null;
}

function pdate(text) {
  const m = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    let y = parseInt(m[3]); if (y < 100) y += 2000;
    return { value: y + '-' + String(parseInt(m[2])).padStart(2, '0') + '-' + String(parseInt(m[1])).padStart(2, '0'), source: 'regex' };
  }
  const m2 = text.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i);
  if (m2) {
    const months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
    const mo = months[m2[2].toLowerCase().slice(0,3)];
    if (mo) return { value: m2[3] + '-' + mo + '-' + String(parseInt(m2[1])).padStart(2, '0'), source: 'regex' };
  }
  return null;
}

function ptime(text) {
  const m = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (m) {
    let h = parseInt(m[1]), min = parseInt(m[2]), ap = (m[4] || '').toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return { value: String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0'), source: 'regex' };
    }
  }
  return null;
}

function pstatus(text) {
  const upper = text.toUpperCase();
  for (const s of C.ACCEPTED_STATUSES) {
    if (new RegExp('\\b' + s + '\\b').test(upper)) return { value: 'SUCCESS', source: 'label' };
  }
  if (/\b(CREDITED|RECEIVED|SENT|DONE)\b/i.test(upper)) return { value: 'SUCCESS', source: 'inferred' };
  if (/\b(FAILED|REJECTED|DECLINED|CANCELLED)\b/i.test(upper)) return { value: 'FAILED', source: 'label' };
  return null;
}

function extract(text) {
  const t = text || '';
  return {
    amount: amount(t),
    utr: utr(t),
    receiverUpi: upi(t),
    receiverName: rname(t),
    date: pdate(t),
    time: ptime(t),
    paymentStatus: pstatus(t),
    raw: t.substring(0, 1000),
  };
}

module.exports = { extract, amount, utr, upi, rname, pdate, ptime, pstatus };