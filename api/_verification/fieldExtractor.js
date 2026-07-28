const C = require('./config');
const log = require('./logger').EXTRACT;

function extractAmount(text) {
  const patterns = [
    /(?:RS\.?|INR|₹)\s*[:.]?\s*([\d,]+\.?\d{0,2})/i,
    /(?:AMOUNT|TOTAL|AMT)\s*:?\s*(?:RS\.?|INR|₹)?\s*([\d,]+\.?\d{0,2})/i,
    /([\d,]+\.?\d{0,2})\s*(?:CREDITED|DEBITED|PAID|SENT)/i,
    /(?:CREDITED|DEBITED)\s+(?:BY|OF|RS\.?|INR|₹)\s*([\d,]+\.?\d{0,2})/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const n = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(n) && n > 0 && n < 10000000) return { value: Math.round(n), source: 'regex', confidence: 'high' };
    }
  }
  const digits = text.replace(/[^0-9]/g, '');
  for (const a of C.ALLOWED_AMOUNTS) {
    if (digits.includes(String(a))) return { value: a, source: 'digit_search', confidence: 'medium' };
  }
  return { value: null, source: 'none', confidence: 'none' };
}

function extractUtr(text) {
  const patterns = [
    /(?:UTR|RRN|REF(?:ERENCE)?)\s*(?:No|ID|NUMBER|NUM)?[\.\s]*:?\s*([A-Z0-9]{6,45})/i,
    /(?:TRANSACTION\s*(?:ID|REF|NO)|TXN\s*(?:ID|NO|REF))\s*:?\s*([A-Z0-9]{6,45})/i,
    /\b([A-Z]{2}[A-Z0-9]{10,})\b/,
    /\b([0-9]{12,22})\b/,
  ];
  const knownUtrLabels = ['UTR', 'RRN', 'REFERENCE', 'TRANSACTION REF', 'TXN REF'];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const val = m[1].trim().toUpperCase();
      if (val.length >= C.UTR_MIN_LENGTH && val.length <= C.UTR_MAX_LENGTH && /^[A-Z0-9]+$/.test(val)) {
        if (/\b(?:UPI|PAYMENT\s*ID|ORDER\s*ID)\b/i.test(m[0])) continue;
        return { value: val, source: 'regex', confidence: 'high' };
      }
    }
  }
  return { value: null, source: 'none', confidence: 'none' };
}

function extractReceiverUpi(text) {
  const known = C.EXPECTED_RECEIVER_UPI.replace(/[@.\-]/g, '\\$&');
  const knownPat = new RegExp('(' + known + ')', 'i');
  const m1 = text.match(knownPat);
  if (m1) return { value: m1[1].toLowerCase(), source: 'known_match', confidence: 'high' };

  const patterns = [
    /(?:PAID\s*TO|TO|RECEIVER|BENEFICIARY|SENT\s*TO)\s*:?\s*([\w.\-]+@[\w.]+)/i,
    /\b([\w.\-]+@[\w.]+)\b/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const id = m[1].toLowerCase().replace(/[^a-z0-9@._-]/g, '');
      if (id.includes('@') && id.split('@')[1].length >= 2) return { value: id, source: 'regex', confidence: 'medium' };
    }
  }
  return { value: null, source: 'none', confidence: 'none' };
}

function extractReceiverName(text) {
  const expected = C.EXPECTED_RECEIVER_NAME;
  if (text.toUpperCase().includes(expected)) return { value: expected, source: 'exact_match', confidence: 'high' };
  const parts = expected.split(/\s+/);
  const matched = parts.filter(p => text.toUpperCase().includes(p));
  if (matched.length >= Math.ceil(parts.length * 0.6)) return { value: expected, source: 'partial_match', confidence: 'medium' };

  const patterns = [
    /(?:BENEFICIARY|RECEIVER|PAID\s*TO|TO)\s*:?\s*([A-Z][A-Za-z.\s]{2,40}?)(?:\s*(?:UPI|VIA|ON|AT|\d|$))/i,
    /(?:BENEFICIARY\s*NAME)\s*:?\s*([A-Z][A-Za-z.\s]{2,40})/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const name = m[1].trim().replace(/[:\s]+$/, '');
      if (name.length > 1 && !/^\d+$/.test(name) && !name.includes('@')) return { value: name.toUpperCase(), source: 'regex', confidence: 'medium' };
    }
  }
  if (extractReceiverUpi(text).value === C.EXPECTED_RECEIVER_UPI) return { value: expected, source: 'inferred_from_upi', confidence: 'medium' };
  return { value: null, source: 'none', confidence: 'none' };
}

function extractTransactionId(text) {
  const patterns = [
    /(?:TXN\s*(?:ID|NO|REF)|TRANSACTION\s*(?:ID|NO|NUMBER|REF))\s*:?\s*([A-Z0-9]{6,50})/i,
    /(?:PAYMENT\s*(?:ID|REF)|ORDER\s*(?:ID|NO))\s*:?\s*([A-Z0-9]{6,50})/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const val = m[1].trim().toUpperCase();
      if (val.length >= C.TXN_ID_MIN_LENGTH && val.length <= C.TXN_ID_MAX_LENGTH && /^[A-Z0-9]+$/.test(val)) return { value: val, source: 'regex', confidence: 'high' };
    }
  }
  return { value: null, source: 'none', confidence: 'none' };
}

function extractDate(text) {
  const months = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' };
  const patterns = [
    { re: /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i, parse: (m) => { const mo = months[m[2].toLowerCase().slice(0,3)]; return mo ? m[3] + '-' + mo + '-' + String(parseInt(m[1])).padStart(2,'0') : null; }},
    { re: /(\d{2})\/(\d{2})\/(\d{4})/, parse: (m) => { const d = parseInt(m[1]), mo = parseInt(m[2]), y = parseInt(m[3]); if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return y + '-' + String(mo).padStart(2,'0') + '-' + String(d).padStart(2,'0'); }},
    { re: /(?:DATE|DT)\s*:?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i, parse: (m) => { let d = parseInt(m[1]), mo = parseInt(m[2]), y = parseInt(m[3]); if (y < 100) y += 2000; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return y + '-' + String(mo).padStart(2,'0') + '-' + String(d).padStart(2,'0'); }},

    { re: /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/, parse: (m) => { let d = parseInt(m[1]), mo = parseInt(m[2]), y = parseInt(m[3]); if (y < 100) y += 2000; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return y + '-' + String(mo).padStart(2,'0') + '-' + String(d).padStart(2,'0'); return y + '-' + String(d).padStart(2,'0') + '-' + String(mo).padStart(2,'0'); }},
  ];
  for (const { re, parse } of patterns) {
    const m = text.match(re);
    if (m) { const v = parse(m); if (v) return { value: v, source: 'regex', confidence: 'high' }; }
  }
  return { value: null, source: 'none', confidence: 'none' };
}

function extractTime(text) {
  const m = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (m) {
    let h = parseInt(m[1]), min = parseInt(m[2]);
    let ampm = (m[4] || '').toUpperCase();
    if (ampm === 'PM' && h < 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      const display = String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
      return { value: display, source: 'regex', confidence: 'high' };
    }
  }
  return { value: null, source: 'none', confidence: 'none' };
}

function extractPaymentStatus(text) {
  const upper = text.toUpperCase();
  for (const accepted of C.ACCEPTED_PAYMENT_STATUSES) {
    if (new RegExp('\\b' + accepted + '\\b').test(upper)) return { value: 'SUCCESS', source: 'regex', confidence: 'high' };
  }
  if (/\b(CREDITED|RECEIVED|SENT|DONE)\b/i.test(upper)) return { value: 'SUCCESS', source: 'regex', confidence: 'medium' };
  if (/\b(FAILED|REJECTED|DECLINED|CANCELLED|UNSUCCESSFUL|REVERSED|EXPIRED)\b/i.test(upper)) return { value: 'FAILED', source: 'regex', confidence: 'high' };
  if (/\b(PENDING|PROCESSING|INITIATED|AWAITING)\b/i.test(upper)) return { value: 'PENDING', source: 'regex', confidence: 'medium' };
  return { value: null, source: 'none', confidence: 'none' };
}

function detectApp(text) {
  const pairs = [
    ['PhonePe', [/phonepe/i, /phone\s*pe/i]],
    ['Google Pay', [/google\s*pay/i, /gpay/i, /tez/i]],
    ['Paytm', [/paytm/i]],
    ['BHIM', [/bhim/i]],
    ['Amazon Pay', [/amazon\s*pay/i]],
    ['CRED', [/\bCRED\b/i]],
  ];
  for (const [name, patterns] of pairs) {
    for (const p of patterns) { if (p.test(text)) return name; }
  }
  return null;
}

function run(ocrText, ocrWords) {
  const t0 = Date.now();
  const text = ocrText || '';

  const result = {
    amount: extractAmount(text),
    utr: extractUtr(text),
    receiverUpi: extractReceiverUpi(text),
    receiverName: extractReceiverName(text),
    transactionId: extractTransactionId(text),
    date: extractDate(text),
    time: extractTime(text),
    paymentStatus: extractPaymentStatus(text),
    appIdentity: detectApp(text),
    rawText: text.substring(0, 2000),
    wordCount: (ocrWords || []).length,
  };

  const found = Object.entries(result).filter(([k, v]) => v && v.value !== null && !['rawText', 'wordCount', 'appIdentity'].includes(k)).length;
  log.info('Extracted ' + found + '/8 fields app=' + (result.appIdentity || 'unknown') + ' (' + (Date.now() - t0) + 'ms)');
  return result;
}

module.exports = { run, extractAmount, extractUtr, extractReceiverUpi, extractReceiverName, extractTransactionId, extractDate, extractTime, extractPaymentStatus };