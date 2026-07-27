const { parseBankSmsOcr } = require('../_bankSmsParser.js');
const C = require('./config');
const log = require('./logger').EXTRACT;

function extractAmount(ocrText, parsed) {
  if (parsed.extractedAmount) return { value: parsed.extractedAmount, source: 'parser', confidence: 'high' };
  const patterns = [
    /(?:RS\.?|INR|₹)\s*[:.]?\s*([\d,]+\.?\d{0,2})/i,
    /(?:AMOUNT|AMT|TOTAL|PAYMENT|PRICE)\s*:?\s*(?:RS\.?|INR|₹)?\s*([\d,]+\.?\d{0,2})/i,
    /([\d,]+\.?\d{0,2})\s*(?:CREDITED|DEBITED|TRANSFER(?:RED)?|PAID|SENT|RECEIVED)/i,
    /(?:CREDITED|DEBITED)\s+(?:BY|WITH|OF|RS\.?|INR\.?|₹)\s*([\d,]+\.?\d{0,2})/i,
  ];
  for (const pat of patterns) {
    const m = ocrText.match(pat);
    if (m) {
      const n = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(n) && n > 0 && n < 10000000) return { value: Math.round(n), source: 'regex', confidence: 'medium' };
    }
  }
  return { value: null, source: 'none', confidence: 'none' };
}

function extractUtr(ocrText, parsed) {
  if (parsed.extractedUtr) return { value: parsed.extractedUtr.toUpperCase(), source: 'parser', confidence: 'high' };
  const patterns = [
    /(?:UPI|RRN|REF(?:ERENCE)?|TXN|TRXN|UTR)\s*(?:No|ID|NUMBER|REF)?\.?\s*:?\s*([A-Z0-9]{10,30})/i,
    /(?:NEFT|IMPS|RTGS)\s*(?:REF|UTR|ID)?\s*:?\s*([A-Z0-9]{10,30})/i,
    /\b([A-Z0-9]{12,22})\b/,
  ];
  for (const pat of patterns) {
    const m = ocrText.match(pat);
    if (m) {
      const val = m[1].trim().toUpperCase();
      if (val.length >= 10 && /^[A-Z0-9]+$/.test(val)) return { value: val, source: 'regex', confidence: 'medium' };
    }
  }
  return { value: null, source: 'none', confidence: 'none' };
}

function extractReceiverUpi(ocrText, parsed) {
  if (parsed.extractedSenderVpa) return { value: parsed.extractedSenderVpa.toLowerCase(), source: 'parser', confidence: 'high' };
  const patterns = [
    /(?:TO|RECEIVER|PAID\s*TO|TRANSFER(?:RED)?\s*TO|BENEFICIARY|SENT\s*TO)\s*:?\s*([\w.\-]+@[\w.]+)/i,
    /([\w.\-]+@(?:okicici|okaxis|okhdfc|oksbi|okbank|okyes|ibl|paytm|ptyes|ybl|razorpay|xpress|axl))/i,
    /([\w.\-]+@[\w.]{2,})/i,
  ];
  for (const pat of patterns) {
    const m = ocrText.match(pat);
    if (m) {
      const id = m[1].toLowerCase().replace(/[^a-z0-9@._-]/g, '');
      if (id.includes('@') && id.split('@')[1].length >= 2) return { value: id, source: 'regex', confidence: 'medium' };
    }
  }
  return { value: null, source: 'none', confidence: 'none' };
}

function extractSenderUpi(ocrText, parsed) {
  if (parsed.extractedSenderVpa) return { value: parsed.extractedSenderVpa.toLowerCase(), source: 'parser', confidence: 'high' };
  const patterns = [
    /(?:FROM|SENDER|PAID\s*BY|DEBITED\s*FROM|FROM\s*ACCT)\s*:?\s*([\w.\-]+@[\w.]+)/i,
  ];
  for (const pat of patterns) {
    const m = ocrText.match(pat);
    if (m) {
      const id = m[1].toLowerCase().replace(/[^a-z0-9@._-]/g, '');
      if (id.includes('@') && id.split('@')[1].length >= 2) return { value: id, source: 'regex', confidence: 'medium' };
    }
  }
  return { value: null, source: 'none', confidence: 'none' };
}

function extractDate(ocrText, parsed) {
  if (parsed.extractedDate) return { value: parsed.extractedDate, source: 'parser', confidence: 'high' };
  const months = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' };
  const patterns = [
    { re: /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/, parse: (m) => { let d=parseInt(m[1]), mo=parseInt(m[2]), y=parseInt(m[3]); if(y<100)y+=2000; if(mo>=1&&mo<=12&&d>=1&&d<=31)return y+'-'+String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0'); if(d>=1&&d<=12&&mo>=1&&mo<=31)return y+'-'+String(d).padStart(2,'0')+'-'+String(mo).padStart(2,'0'); return null; }},
    { re: /(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*(\d{2,4})/i, parse: (m) => { const mo=months[m[2].toLowerCase().slice(0,3)]; if(!mo)return null; let d=parseInt(m[1]),y=parseInt(m[3]); if(y<100)y+=2000; return y+'-'+mo+'-'+String(d).padStart(2,'0'); }},
    { re: /(\d{1,2})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{2,4})/i, parse: (m) => { const mo=months[m[2].toLowerCase().slice(0,3)]; if(!mo)return null; let d=parseInt(m[1]),y=parseInt(m[3]); if(y<100)y+=2000; return y+'-'+mo+'-'+String(d).padStart(2,'0'); }},
    { re: /(?:DATE|DT|ON)\s*:?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i, parse: (m) => { let d=parseInt(m[1]),mo=parseInt(m[2]),y=parseInt(m[3]); if(y<100)y+=2000; if(mo>=1&&mo<=12&&d>=1&&d<=31)return y+'-'+String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0'); if(d>=1&&d<=12&&mo>=1&&mo<=31)return y+'-'+String(d).padStart(2,'0')+'-'+String(mo).padStart(2,'0'); return null; }},
  ];
  for (const { re, parse } of patterns) {
    const m = ocrText.match(re);
    if (m) {
      const v = parse(m);
      if (v) return { value: v, source: 'regex', confidence: 'medium' };
    }
  }
  return { value: null, source: 'none', confidence: 'none' };
}

function extractTime(ocrText, parsed) {
  if (parsed.extractedTime) return { value: parsed.extractedTime, source: 'parser', confidence: 'high' };
  const m = ocrText.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (m) {
    let h = parseInt(m[1]), min = parseInt(m[2]);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      let display = String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
      if (m[3]) display += ':' + m[3];
      if (m[4]) display += ' ' + m[4].toUpperCase();
      return { value: display, source: 'regex', confidence: 'medium' };
    }
  }
  return { value: null, source: 'none', confidence: 'none' };
}

function extractPaymentStatus(ocrText, parsed) {
  if (parsed.extractedPaymentStatus) return { value: parsed.extractedPaymentStatus, source: 'parser', confidence: 'high' };
  const upper = ocrText.toUpperCase();
  if (/\b(CREDITED|SUCCESS|SUCCESSFUL|COMPLETED|PAID|DONE|RECEIVED|SENT|PAYMENT\s+SUCCESSFUL|TXN\s+SUCCESSFUL)\b/i.test(upper)) return { value: 'SUCCESS', source: 'regex', confidence: 'medium' };
  if (/\bDEBITED\b/i.test(upper)) return { value: 'DEBIT_SUCCESS', source: 'regex', confidence: 'medium' };
  if (/\b(PENDING|PROCESSING|INITIATED|AWAITING)\b/i.test(upper)) return { value: 'PENDING', source: 'regex', confidence: 'medium' };
  if (/\b(FAILED|REJECTED|DECLINED|CANCELLED|REVERSED|EXPIRED|UNSUCCESSFUL)\b/i.test(upper)) return { value: 'FAILED', source: 'regex', confidence: 'medium' };
  return { value: null, source: 'none', confidence: 'none' };
}

function extractReceiverName(ocrText, parsed) {
  if (parsed.extractedReceiverName) return { value: parsed.extractedReceiverName, source: 'parser', confidence: 'high' };
  const patterns = [
    /(?:BENEFICIARY|RECEIVER|TO|PAID\s*TO)\s*:?\s*([A-Z][A-Za-z\s.]{2,40}?)(?:\s*(?:UPI|VIA|ON|AT|REF|\d))/i,
    /(?:BENEFICIARY\s*NAME)\s*:?\s*([A-Z][A-Za-z\s.]{2,40})/i,
  ];
  for (const pat of patterns) {
    const m = ocrText.match(pat);
    if (m) {
      const name = m[1].trim().replace(/[:\s]+$/, '');
      if (name.length > 1 && !/^\d+$/.test(name) && !name.includes('@')) return { value: name, source: 'regex', confidence: 'medium' };
    }
  }
  return { value: null, source: 'none', confidence: 'none' };
}

function extractBankName(ocrText, parsed) {
  if (parsed.extractedBankName) return { value: parsed.extractedBankName, source: 'parser', confidence: 'high' };
  const banks = ['SBI', 'HDFC', 'ICICI', 'AXIS', 'KOTAK', 'YES BANK', 'PNB', 'CANARA', 'IDBI', 'INDUSIND', 'FEDERAL', 'RBL', 'IDFC', 'BANK OF BARODA', 'UNION BANK'];
  for (const b of banks) {
    if (new RegExp('\\b' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(ocrText)) return { value: b, source: 'regex', confidence: 'medium' };
  }
  return { value: null, source: 'none', confidence: 'none' };
}

function detectAppIdentity(ocrText) {
  const apps = [
    { name: 'PhonePe', patterns: [/phonepe/i, /phone\s*pe/i, /YBL/i, /yes\s*bank/i] },
    { name: 'Google Pay', patterns: [/google\s*pay/i, /gpay/i, /tez/i] },
    { name: 'Paytm', patterns: [/paytm/i] },
    { name: 'BHIM', patterns: [/bhim/i] },
    { name: 'CRED', patterns: [/\bCRED\b/i] },
    { name: 'Amazon Pay', patterns: [/amazon\s*pay/i] },
  ];
  for (const app of apps) {
    for (const pat of app.patterns) {
      if (pat.test(ocrText)) return app.name;
    }
  }
  return null;
}

function run(ocrText, ocrWords) {
  const t0 = Date.now();
  const parsed = parseBankSmsOcr(ocrText);

  const extracted = {
    amount: extractAmount(ocrText, parsed),
    utr: extractUtr(ocrText, parsed),
    receiverUpi: extractReceiverUpi(ocrText, parsed),
    senderUpi: extractSenderUpi(ocrText, parsed),
    date: extractDate(ocrText, parsed),
    time: extractTime(ocrText, parsed),
    paymentStatus: extractPaymentStatus(ocrText, parsed),
    receiverName: extractReceiverName(ocrText, parsed),
    bankName: extractBankName(ocrText, parsed),
    appIdentity: detectAppIdentity(ocrText),
    parserConfidence: parsed.confidence || 0,
    parserFieldCount: parsed.fieldCount || 0,
    rawText: ocrText,
    wordCount: (ocrWords || []).length,
  };

  const fieldsFound = Object.values(extracted).filter(f => f && f.value !== null && f !== ocrText).length;
  log.info('', 'Extracted ' + fieldsFound + '/10 fields, parserConf=' + extracted.parserConfidence + '% (' + (Date.now() - t0) + 'ms)');
  return extracted;
}

module.exports = { run };
