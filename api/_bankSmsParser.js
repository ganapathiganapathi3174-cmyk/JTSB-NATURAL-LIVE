const KNOWN_BANKS = [
  'SBI', 'STATE BANK OF INDIA', 'HDFC BANK', 'ICICI BANK', 'AXIS BANK',
  'KOTAK MAHINDRA', 'YES BANK', 'PNB', 'CANARA BANK', 'BANK OF BARODA',
  'UNION BANK', 'IDBI BANK', 'INDUSIND BANK', 'FEDERAL BANK', 'RBL BANK',
  'BANDHAN BANK', 'SOUTH INDIAN BANK', 'IOB', 'INDIAN BANK', 'UCO BANK',
  'SYNDICATE BANK', 'ALLAHABAD BANK', 'ANDHRA BANK', 'CORPORATION BANK',
  'HSBC', 'CITI BANK', 'STANDARD CHARTERED', 'IDFC FIRST BANK',
  'AU SMALL FINANCE', 'JANA SMALL FINANCE', 'EQUITAS SMALL FINANCE',
];

const KNOWN_APPS = [
  'Google Pay', 'PhonePe', 'Paytm', 'BHIM', 'Amazon Pay', 'CRED',
  'Freecharge', 'Mobikwik', 'JioPay', 'WhatsApp Pay', 'Airtel Thanks',
  'GoogleTez',
];

function normalizeText(text) {
  if (!text) return '';
  return text
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSmsAmount(lines) {
  const ALLOWED = new Set([120, 500, 1000]);

  for (const line of lines) {
    const m = line.match(/(?:RS|INR|₹)\s*[:.]?\s*([\d,]+\.?\d{0,2})/i);
    if (m) {
      const n = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(n) && n > 0 && n < 10000000) return Math.round(n);
    }
  }

  for (const line of lines) {
    const m = line.match(/(?:AMOUNT|AMT|TOTAL|PAYMENT)\s*:?\s*(?:RS|INR|₹)?\s*([\d,]+\.?\d{0,2})/i);
    if (m) {
      const n = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(n) && n > 0 && n < 10000000) return Math.round(n);
    }
  }

  for (const line of lines) {
    const m = line.match(/([\d,]+\.?\d{0,2})\s*(?:CREDITED|DEBITED|TRANSFER|PAID|SENT|RECEIVED)/i);
    if (m && !/(?:AC|A\/C|ACCOUNT|ACNO)\s*:?\s*\*?\d{3,}/i.test(line)) {
      const n = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(n) && n > 0 && n <= 100000) return Math.round(n);
    }
  }

  for (const line of lines) {
    const m = line.match(/(?:CREDITED|DEBITED)\s+(?:BY|WITH|OF|RS\.?|INR\.?|₹)\s*([\d,]+\.?\d{0,2})/i);
    if (m) {
      const n = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(n) && n > 0 && n < 10000000) return Math.round(n);
    }
  }

  for (const line of lines) {
    const m = line.match(/([\d,]+\.\d{2})\b/);
    if (m) {
      const n = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(n) && n > 0 && n < 10000000 && ALLOWED.has(Math.round(n))) return Math.round(n);
    }
  }

  return null;
}

function extractSmsUtr(lines) {
  const patterns = [
    /(?:UPI\s*(?:REF|REFERENCE|TRANSACTION\s*(?:REF|ID)?|TRXN|TXN)?\s*(?:No|NUMBER|ID|REF|no|number|id|ref)?\.?\s*:?\s*([A-Z0-9]{10,30}))/i,
    /(?:REF|REFERENCE|TRANSACTION\s*(?:ID|REF)?|TXN?\s*(?:ID|No|NUMBER)?|RRN|RR\s*NUMBER)\s*(?:No|NUMBER|ID|REF|no|number|id|ref)?\.?\s*:?\s*([A-Z0-9]{10,30})/i,
    /(?:UTR|NEFT\s*UTR)\s*:?\s*([A-Z0-9]{10,30})/i,
  ];
  const found = [];
  for (const line of lines) {
    for (const pat of patterns) {
      const m = line.match(pat);
      if (m) {
        const val = m[1].trim();
        if (val.length >= 10 && val.length <= 30 && /^[A-Z0-9]+$/i.test(val) && !found.includes(val)) {
          found.push(val);
        }
      }
    }
  }
  if (found.length === 0) {
    for (const line of lines) {
      const m = line.match(/\b(\d{12,22})\b/);
      if (m) {
        const val = m[1].trim();
        if (val.length >= 12 && !found.includes(val)) found.push(val);
      }
    }
  }
  return found.length > 0 ? found[0] : null;
}

function extractSmsTransactionRef(lines) {
  for (const line of lines) {
    const m = line.match(/(?:TXN?\s*(?:ID|REF|NUMBER)?|TRANSACTION\s*(?:ID|REF)?)\s*:?\s*([A-Z0-9]{8,})/i);
    if (m && m[1].length >= 8) return m[1].trim();
  }
  return null;
}

function extractSmsSenderVpa(lines) {
  const patterns = [
    /(?:TO|FROM|SENDER|PAYER|PAID\s*(?:TO|BY)?|TRANSFER\s*(?:TO|FROM)?)\s*:?\s*([\w.\-]+@[\w.]+)/i,
    /([\w.\-]+@[\w.]+)/i,
  ];
  for (const line of lines) {
    for (const pat of patterns) {
      const m = line.match(pat);
      if (m) {
        const id = m[1].toLowerCase().replace(/[^a-z0-9@._-]/g, '');
        if (id.includes('@') && id.split('@')[1].length >= 2) return id;
      }
    }
  }
  return null;
}

function extractSmsReceiverName(lines) {
  for (const line of lines) {
    if (/\bA\/?C\b|ACCOUNT\s*(?:NO|NUMBER)?\.?\s*:?\s*[*X]/i.test(line)) continue;
    const m = line.match(/(?:TO|PAID\s*TO|BENEFICIARY|RECEIVER|TRANSFER\s*TO)\s*:?\s*([A-Za-z][A-Za-z\s.]+?)(?:\s*(?:UPI|VIA|ON|AT|REF|\d|$))/i);
    if (m) {
      const name = m[1].trim().replace(/[:\s]+$/, '');
      if (name.length > 1 && !/^\d+$/.test(name) && !name.includes('@') && !name.includes('.com')
          && !/^(?:YOUR\s+)?A\/?C|ACCOUNT/i.test(name)
          && name !== 'your') return name;
    }
  }
  return null;
}

function extractSmsReceiverAccount(lines) {
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (/A\/?C|AC(?:COUNT)?\s*(?:NO|NUMBER)?/.test(upper)) {
      const m = line.match(/[AX]\/?C(?:\s*(?:NO|NUMBER))?\.?\s*:?\s*[X\*]?(\d{4,})/i) ||
               line.match(/ACCOUNT(?:\s*(?:NO|NUMBER))?\.?\s*:?\s*[X\*]?(\d{4,})/i);
      if (m) return m[1].trim();
    }
  }
  for (const line of lines) {
    const m = line.match(/(?:\*\*\*\*|XXXX|XXXXX)\s*(\d{4})\b/);
    if (m) return m[1].trim();
  }
  return null;
}

function extractSmsBankName(lines) {
  const sorted = [...KNOWN_BANKS].sort((a, b) => b.length - a.length);
  const pat = new RegExp('(?:^|[^a-zA-Z0-9])(' + sorted.map(n => n.replace(/[ .]/g, '[\\s.]?')).join('|') + ')(?:$|[^a-zA-Z0-9])', 'i');
  for (const line of lines) {
    const m = line.match(pat);
    if (m) {
      const matched = m[1].trim();
      const idx = KNOWN_BANKS.findIndex(b => b.toUpperCase() === matched.toUpperCase());
      return idx >= 0 ? KNOWN_BANKS[idx] : matched;
    }
  }
  for (const app of KNOWN_APPS) {
    const words = app.toLowerCase().split(/\s+/);
    if (words.length <= 1) continue;
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (words.every(w => lower.includes(w))) return app;
    }
  }
  return null;
}

function extractSmsDate(lines) {
  const months = { jan:1, january:1, feb:2, february:2, mar:3, march:3, apr:4, april:4, may:5, jun:6, june:6, jul:7, july:7, aug:8, august:8, sep:9, september:9, oct:10, october:10, nov:11, november:11, dec:12, december:12 };
  const patterns = [
    { re: /(\d{1,2})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{2,4})/i, fmt: 'dmyc' },
    { re: /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{2,4})/i, fmt: 'dmy' },
    { re: /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/, fmt: 'mdy' },
    { re: /(?:DATE|DT|ON)\s*:?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i, fmt: 'mdy_label' },
    { re: /(?:DATE|DT|ON)\s*:?\s*(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{2,4})/i, fmt: 'dmy_label' },
  ];
  for (const line of lines) {
    for (const pat of patterns) {
      const m = line.match(pat.re);
      if (!m) continue;
      if (pat.fmt === 'dmyc') {
        const monthStr = m[2].substring(0, 3).toLowerCase();
        const moNum = months[monthStr];
        if (!moNum) continue;
        let d = parseInt(m[1]), y = m[3].length === 2 ? 2000 + parseInt(m[3]) : parseInt(m[3]);
        if (d < 1 || d > 31 || moNum < 1 || moNum > 12 || y < 2000 || y > 2100) continue;
        return String(y) + '-' + String(moNum).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      }
      if (pat.fmt === 'dmy' || pat.fmt === 'dmy_label') {
        const monthStr = m[2].substring(0, 3).toLowerCase();
        const moNum = months[monthStr];
        if (!moNum) continue;
        let d = parseInt(m[1]), y = m[3].length === 2 ? 2000 + parseInt(m[3]) : parseInt(m[3]);
        if (d < 1 || d > 31 || moNum < 1 || moNum > 12 || y < 2000 || y > 2100) continue;
        return String(y) + '-' + String(moNum).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      }
      if (pat.fmt === 'mdy' || pat.fmt === 'mdy_label') {
        let a = parseInt(m[1]), b = parseInt(m[2]), y = m[3].length === 2 ? 2000 + parseInt(m[3]) : parseInt(m[3]);
        if (y < 2000 || y > 2100) continue;
        if (a >= 1 && a <= 31 && b >= 1 && b <= 12) return String(y) + '-' + String(b).padStart(2, '0') + '-' + String(a).padStart(2, '0');
        if (b >= 1 && b <= 31 && a >= 1 && a <= 12) return String(y) + '-' + String(a).padStart(2, '0') + '-' + String(b).padStart(2, '0');
      }
    }
  }
  return null;
}

function extractSmsTime(lines) {
  for (const line of lines) {
    const m = line.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:AM|PM|am|pm)?/);
    if (m) {
      let hour = parseInt(m[1]), minute = parseInt(m[2]);
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        let display = String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
        if (m[3]) display += ':' + m[3];
        return display;
      }
    }
  }
  for (const line of lines) {
    const m = line.match(/(\d{1,2})\.(\d{2})\s*(?:AM|PM|am|pm)?/);
    if (m) {
      let hour = parseInt(m[1]), minute = parseInt(m[2]);
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
      }
    }
  }
  return null;
}

function extractSmsPaymentStatus(lines) {
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (/\b(CREDITED|SUCCESS|SUCCESSFUL|COMPLETED|PAID|DONE|RECEIVED)\b/.test(upper)) return 'SUCCESS';
    if (/\b(DEBITED|DEBIT)\b/.test(upper)) return 'DEBIT_SUCCESS';
    if (/\b(PENDING|PROCESSING|INITIATED|AWAITING)\b/.test(upper)) return 'PENDING';
    if (/\b(FAILED|REJECTED|DECLINED|CANCELLED|FAIL|UNSUCCESSFUL|REVERSED|EXPIRED)\b/.test(upper)) return 'FAILED';
  }
  return null;
}

function extractSmsTransactionType(lines) {
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (/\bCREDITED\b/.test(upper)) return 'CREDITED';
    if (/\bDEBITED\b/.test(upper)) return 'DEBITED';
    if (/\bPAID\b/.test(upper)) return 'PAID';
    if (/\bSENT\b/.test(upper)) return 'SENT';
    if (/\bRECEIVED\b/.test(upper)) return 'RECEIVED';
    if (/\bTRANSFER\b|\bTRANSFERRED\b/.test(upper)) return 'TRANSFER';
    if (/\bREFUND\b/.test(upper)) return 'REFUND';
    if (/\bWITHDRAWAL\b|\bWITHDRAWN\b/.test(upper)) return 'WITHDRAWAL';
  }
  return null;
}

function extractSmsHeader(lines) {
  const knownBankNames = [...KNOWN_BANKS, ...KNOWN_APPS];
  const sorted = [...knownBankNames].sort((a, b) => b.length - a.length);
  const pat = new RegExp('^\\s*(' + sorted.map(n => n.replace(/[ .]/g, '[\\\\s.]?')).join('|') + ')', 'i');
  for (const line of lines) {
    const m = line.match(pat);
    if (m) return m[1].trim();
  }
  for (const line of lines) {
    const m = line.match(/^[,\s]*([A-Z][A-Za-z0-9 .]+?)(?:\s*-|\s*:|\s*\|)/);
    if (m) {
      const h = m[1].trim();
      if (h.length >= 3 && h.length <= 40) return h;
    }
  }
  return null;
}

function computeSmsConfidence(parsed, rawText) {
  let score = 0;
  const weights = {
    extractedAmount: 25,
    extractedUtr: 25,
    extractedBankName: 10,
    extractedDate: 12,
    extractedTime: 5,
    extractedPaymentStatus: 10,
    extractedSenderVpa: 3,
    extractedReceiverName: 1,
    extractedReceiverAccount: 4,
    extractedTransactionType: 5,
  };
  for (const [field, weight] of Object.entries(weights)) {
    if (parsed[field] !== null && parsed[field] !== undefined && parsed[field] !== '') {
      score += weight;
    }
  }
  const len = (rawText || '').length;
  if (len > 50) score = Math.min(score + 5, 100);
  if (len > 150) score = Math.min(score + 5, 100);
  return Math.min(score, 100);
}

function parseBankSmsOcr(fullText) {
  const text = normalizeText(fullText || '');
  const rawText = text;

  const result = {
    rawText,
    extractedAmount: null,
    extractedUtr: null,
    extractedTransactionRef: null,
    extractedSenderVpa: null,
    extractedReceiverName: null,
    extractedReceiverAccount: null,
    extractedBankName: null,
    extractedDate: null,
    extractedTime: null,
    extractedPaymentStatus: null,
    extractedTransactionType: null,
    extractedSmsHeader: null,
    confidence: 0,
    wordCount: 0,
    fieldCount: 0,
    parserError: false,
    parserErrorDetail: null,
  };

  if (!rawText || rawText.trim().length < 10) {
    result.parserError = true;
    result.parserErrorDetail = 'No readable text found in SMS screenshot';
    return result;
  }

  result.wordCount = rawText.split(/\s+/).length;
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Check for lines that are too short — bank SMS should have meaningful lines
  const meaningfulLines = lines.filter(l => l.length > 10);
  if (meaningfulLines.length === 0) {
    result.parserError = true;
    result.parserErrorDetail = 'No meaningful text lines in screenshot';
    return result;
  }

  if (lines.length > 0) {
    result.extractedAmount = extractSmsAmount(lines);
    result.extractedUtr = extractSmsUtr(lines);
    result.extractedTransactionRef = extractSmsTransactionRef(lines);
    result.extractedSenderVpa = extractSmsSenderVpa(lines);
    result.extractedReceiverName = extractSmsReceiverName(lines);
    result.extractedReceiverAccount = extractSmsReceiverAccount(lines);
    result.extractedBankName = extractSmsBankName(lines);
    result.extractedDate = extractSmsDate(lines);
    result.extractedTime = extractSmsTime(lines);
    result.extractedPaymentStatus = extractSmsPaymentStatus(lines);
    result.extractedTransactionType = extractSmsTransactionType(lines);
    result.extractedSmsHeader = extractSmsHeader(lines);
  }

  const fieldNames = ['extractedAmount', 'extractedUtr', 'extractedTransactionRef', 'extractedSenderVpa', 'extractedReceiverName', 'extractedReceiverAccount', 'extractedBankName', 'extractedDate', 'extractedTime', 'extractedPaymentStatus', 'extractedTransactionType', 'extractedSmsHeader'];
  result.fieldCount = fieldNames.filter(f => result[f] !== null && result[f] !== undefined && result[f] !== '').length;

  if (result.fieldCount === 0 && rawText.length > 50) {
    result.parserError = true;
    result.parserErrorDetail = 'Bank SMS parser failed to extract any fields';
  }

  result.confidence = computeSmsConfidence(result, rawText);

  return result;
}

module.exports = { parseBankSmsOcr };
