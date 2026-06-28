const KNOWN_APPS = [
  'Google Pay', 'PhonePe', 'Paytm', 'BHIM', 'Amazon Pay', 'CRED',
  'Freecharge', 'Mobikwik', 'JioPay', 'WhatsApp Pay', 'Airtel Thanks',
  'Axis Pay', 'ICICI Pockets', 'SBI YONO', 'HDFC PayZapp',
  'Kotak Mahindra', 'Yes Pay', 'IDFC First', 'Federal Bank',
  'GoogleTez',
];

const KNOWN_BANKS = [
  'HDFC BANK', 'ICICI BANK', 'STATE BANK OF INDIA', 'SBI',
  'AXIS BANK', 'KOTAK MAHINDRA', 'YES BANK', 'PNB', 'CANARA BANK',
  'BANK OF BARODA', 'UNION BANK', 'IDBI BANK', 'INDUSIND BANK',
  'FEDERAL BANK', 'RBL BANK', 'BANDHAN BANK', 'SOUTH INDIAN BANK',
  'IOB', 'INDIAN BANK', 'UCO BANK', 'SYNDICATE BANK', 'ALLAHABAD BANK',
  'ANDHRA BANK', 'CORPORATION BANK', 'Dena Bank', 'Vijaya Bank',
  'HSBC', 'CITI BANK', 'STANDARD CHARTERED', 'AU SMALL FINANCE',
  'JANA SMALL FINANCE', 'EQUITAS SMALL FINANCE', 'IDFC FIRST BANK',
];

const OCR_SUBSTITUTIONS = [
  [/O/g, '0'], [/o/g, '0'],
  [/I/g, '1'], [/l/g, '1'],
  [/S/g, '5'],
  [/B/g, '8'],
  [/Z/g, '2'],
  [/G/g, '6'],
  [/D/g, '0'],
];

function normalizeText(text) {
  if (!text) return '';
  return text
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ')
    .replace(/[–—−]/g, '-')
    .replace(/[࿿]/g, '')
    .trim();
}

function normalizeOCRValue(raw) {
  if (!raw) return raw;
  let val = raw;
  for (const [re, sub] of OCR_SUBSTITUTIONS) {
    val = val.replace(re, sub);
  }
  return val;
}

function extractAmount(lines) {
  const found = [];
  for (const line of lines) {
    const upper = line.toUpperCase();
    const currencyLabels = [
      /(?:₹|Rs\.?\s*|INR\s*|Rupees?\s*|Amount|Total|Amt|Pay|Paid)\s*:?\s*([\d,]+\.?\d{0,2})/i,
      /([\d,]+\.?\d{0,2})\s*(?:₹|Rs\.?|INR)/i,
      /(?:₹|Rs\.?)\s*([\d,]+\.?\d{0,2})/i,
    ];
    for (const pat of currencyLabels) {
      const m = line.match(pat);
      if (m) {
        const num = parseFloat(m[1].replace(/,/g, ''));
        if (!isNaN(num) && num > 0 && num < 10000000) {
          found.push(num);
          break;
        }
      }
    }
  }
  if (found.length === 0) {
    for (const line of lines) {
      const m = line.match(/^(\d+\.?\d{0,2})$/);
      if (m) {
        const num = parseFloat(m[1].replace(/,/g, ''));
        if (!isNaN(num) && num > 0 && num < 10000000) {
          found.push(num);
        }
      }
    }
  }
  return found.length > 0 ? found[0] : null;
}

function extractUtr(lines) {
  const found = [];
  const patterns = [
    /(?:UTR|NEFT\s*UTR|UPI\s*Ref|UPI\s*Transaction\s*(?:ID|Id|No|Number)?)\s*:?\s*([A-Z0-9]{10,})/i,
    /(?:Transaction\s*(?:ID|Id|No|Number|Ref)|TXN?\s*(?:ID|Id|No|Number)?|TXNID|TRANSACTIONID)\s*:?\s*([A-Z0-9]{10,})/i,
    /(?:Reference|Ref)\s*(?:No|Number)?\.?\s*:?\s*([A-Z0-9]{10,})/i,
    /(?:Bank\s*Ref|Payment\s*Ref|RRN|RR Number)\s*:?\s*([A-Z0-9]{10,})/i,
  ];
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
        if (val.length >= 12 && !found.includes(val)) {
          found.push(val);
        }
      }
    }
  }
  return found.length > 0 ? found[0] : null;
}

function extractUpiIds(lines) {
  const receivers = [];
  const senders = [];
  const allUpiIds = [];
  const upiPattern = /([\w.\-]+@[\w.]+)/gi;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLower = line.toLowerCase();
    const isReceiverLine = /(?:paid\s*to|payee|beneficiary|receiver|transfer\s*to|sent\s*to|^to\b|creditor)/i.test(lineLower);
    const isSenderLine = /(?:from|sender|paid\s*by|debit|sent\s*by|payer)/i.test(lineLower);
    const matches = [...line.matchAll(upiPattern)];
    for (const m of matches) {
      const id = m[1].toLowerCase();
      if (!id.includes('@') || id.split('@')[1].length < 2) continue;
      if (!allUpiIds.includes(id)) allUpiIds.push(id);
      if (isReceiverLine && !receivers.includes(id)) receivers.push(id);
      else if (isSenderLine && !senders.includes(id)) senders.push(id);
    }
    if (!isReceiverLine && !isSenderLine && matches.length > 0) {
      const prevLine = i > 0 ? lines[i - 1].toLowerCase() : '';
      const nextLine = i < lines.length - 1 ? lines[i + 1].toLowerCase() : '';
      for (const m of matches) {
        const id = m[1].toLowerCase();
        if (!id.includes('@') || id.split('@')[1].length < 2) continue;
        if ((/to|pay|beneficiary/i.test(prevLine) || /receiv/i.test(prevLine) || /transferred/i.test(prevLine)) && !receivers.includes(id)) {
          receivers.push(id);
        }
        if ((/from|sender|debit|paid\s*by/i.test(prevLine)) && !senders.includes(id)) {
          senders.push(id);
        }
        if ((/to|beneficiary/i.test(nextLine)) && !receivers.includes(id)) {
          receivers.push(id);
        }
      }
    }
  }
  if (receivers.length === 0 && senders.length === 0 && allUpiIds.length === 1) {
    senders.push(allUpiIds[0]);
  }
  return { receivers, senders, allUpiIds };
}

function extractNames(lines) {
  const receivers = [];
  const senders = [];
  const patterns = [
    { re: /(?:Paid\s+to|Payee|Beneficiary|Receiver|Transfer\s+to|Sent\s+to)\s*:?\s*(.+)/i, type: 'receiver' },
    { re: /(?:From|Sender|Paid\s+by|Debit|Sent\s+by|Payer)\s*:?\s*(.+)/i, type: 'sender' },
    { re: /^(?:To|Pay)\s*:?\s*(.+)/i, type: 'receiver' },
  ];
  for (const line of lines) {
    const clean = line.replace(/@[\w.]+/g, '').replace(/₹?[\d,]+\.?\d*/g, '').trim();
    if (clean.length < 2) continue;
    for (const { re, type } of patterns) {
      const m = clean.match(re);
      if (m) {
        const name = m[1].trim().replace(/^[:\s]+/, '').replace(/[:\s]+$/, '');
        if (name && name.length > 1 && !/^\d+$/.test(name) && !name.includes('@') && !name.includes('.com')) {
          if (type === 'receiver' && !receivers.includes(name)) receivers.push(name);
          else if (type === 'sender' && !senders.includes(name)) senders.push(name);
        }
      }
    }
  }
  return { receiverName: receivers[0] || null, senderName: senders[0] || null };
}

function extractDate(lines) {
  const months = { jan:1, january:1, feb:2, february:2, mar:3, march:3, apr:4, april:4, may:5, jun:6, june:6, jul:7, july:7, aug:8, august:8, sep:9, september:9, oct:10, october:10, nov:11, november:11, dec:12, december:12 };
  const patterns = [
    { re: /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{2,4})/i, fmt: 'dmy' },
    { re: /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/, fmt: 'mdy' },
    { re: /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/, fmt: 'ymd' },
    { re: /(?:Date|Dt|On)\s*:?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i, fmt: 'mdy_label' },
    { re: /(?:Date|Dt|On)\s*:?\s*(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{2,4})/i, fmt: 'dmy_label' },
  ];
  for (const line of lines) {
    for (const pat of patterns) {
      const m = line.match(pat.re);
      if (!m) continue;
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
        if (a >= 1 && a <= 31 && b >= 1 && b <= 12) {
          return String(y) + '-' + String(b).padStart(2, '0') + '-' + String(a).padStart(2, '0');
        }
        if (b >= 1 && b <= 31 && a >= 1 && a <= 12) {
          return String(y) + '-' + String(a).padStart(2, '0') + '-' + String(b).padStart(2, '0');
        }
      }
      if (pat.fmt === 'ymd') {
        let y = parseInt(m[1]), mo = parseInt(m[2]), d = parseInt(m[3]);
        if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) continue;
        return String(y) + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      }
    }
  }
  return null;
}

function extractTime(lines) {
  for (const line of lines) {
    const m = line.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:AM|PM|am|pm)?/);
    if (m) {
      let hour = parseInt(m[1]), minute = parseInt(m[2]);
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        let ampm = (m[0].toUpperCase().includes('PM') && hour < 12) ? 'PM' : (m[0].toUpperCase().includes('AM') && hour >= 12) ? 'AM' : '';
        let display = String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
        if (m[3]) display += ':' + m[3];
        if (ampm) display += ' ' + ampm;
        return display;
      }
    }
  }
  return null;
}

function extractStatus(lines) {
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (/\b(SUCCESS|SUCCESSFUL|SUCCESSFULLY|COMPLETED|PAID|DONE|CREDITED)\b/.test(upper)) return 'SUCCESS';
    if (/\b(PENDING|PROCESSING|INITIATED|IN\s*PROGRESS|AWAITING)\b/.test(upper)) return 'PENDING';
    if (/\b(FAILED|REJECTED|DECLINED|CANCELLED|FAIL|CANCEL|UNSUCCESSFUL|REFUNDED|REVERSED|EXPIRED|TIMED?\s*OUT)\b/.test(upper)) return 'FAILED';
  }
  return null;
}

function extractBankApp(lines) {
  const allNames = [...KNOWN_BANKS, ...KNOWN_APPS].sort((a, b) => b.length - a.length);
  const pat = new RegExp('(' + allNames.map(n => n.replace(/[ .]/g, '[\\s.]?')).join('|') + ')', 'i');
  for (const line of lines) {
    const m = line.match(pat);
    if (m) return m[1].trim();
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

function extractTxnId(lines) {
  for (const line of lines) {
    const m = line.match(/(?:TXN?\s*(?:ID|Id|No|Number)?|TRANSACTION\s*(?:ID|Id|No|Number)?|TXNID|TRANSACTIONID)\s*:?\s*([A-Z0-9]{10,})/i);
    if (m && m[1].length >= 8) return m[1].trim();
  }
  return null;
}

function extractReceiverName(lines) {
  for (const line of lines) {
    const clean = line.replace(/@[\w.]+/g, '').replace(/₹?[\d,]+\.?\d*/g, '').trim();
    if (clean.length < 3) continue;
    const m = clean.match(/(?:Paid\s+to|To|Payee|Beneficiary)\s*:?\s*([A-Za-z][A-Za-z\s.]+)/i);
    if (m) {
      const name = m[1].trim().replace(/^[:\s]+/, '');
      if (name.length > 1 && !/^\d+$/.test(name) && !name.includes('@')) return name;
    }
  }
  for (const line of lines) {
    const clean = line.replace(/@[\w.]+/g, '').replace(/₹?[\d,]+\.?\d*/g, '').trim();
    if (clean.length < 3) continue;
    const m = clean.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})$/);
    if (m && !m[1].includes('@') && m[1].length > 2) return m[1];
  }
  return null;
}

function extractSenderName(lines) {
  for (const line of lines) {
    const clean = line.replace(/@[\w.]+/g, '').replace(/₹?[\d,]+\.?\d*/g, '').trim();
    if (clean.length < 3) continue;
    const m = clean.match(/(?:From|Sender|Paid\s+by|Sent\s+by|Debit|Payer)\s*:?\s*([A-Za-z][A-Za-z\s.]+)/i);
    if (m) {
      const name = m[1].trim().replace(/^[:\s]+/, '');
      if (name.length > 1 && !/^\d+$/.test(name) && !name.includes('@')) return name;
    }
  }
  return null;
}

function computeConfidence(parsed, rawText) {
  let score = 0;
  const checks = [];
  const weights = {
    extractedAmount: 20,
    extractedUtr: 20,
    extractedReceiverUpi: 15,
    extractedSenderUpi: 5,
    extractedDate: 10,
    extractedTime: 5,
    extractedStatus: 10,
    extractedBankName: 5,
    extractedTxnId: 5,
    receiverName: 3,
    senderName: 2,
  };
  for (const [field, weight] of Object.entries(weights)) {
    if (parsed[field] !== null && parsed[field] !== undefined && parsed[field] !== '') {
      score += weight;
      checks.push(field);
    }
  }
  const rawLen = (rawText || '').length;
  if (rawLen > 100) score = Math.min(score + 5, 100);
  if (rawLen > 300) score = Math.min(score + 5, 100);
  score = Math.min(score, 100);
  return { score, checks };
}

function parseOCRText(fullText) {
  const text = normalizeText(fullText || '');
  const rawText = text;

  const result = {
    rawText,
    extractedAmount: null,
    extractedUtr: null,
    extractedReceiverUpi: null,
    extractedSenderUpi: null,
    extractedDate: null,
    extractedTime: null,
    extractedStatus: null,
    extractedBankName: null,
    extractedTxnId: null,
    receiverName: null,
    senderName: null,
    confidence: 0,
    wordCount: 0,
    ambiguous: false,
    fieldCount: 0,
    parserError: false,
    parserErrorDetail: null,
  };

  if (!rawText || rawText.trim().length < 5) {
    result.parserError = true;
    result.parserErrorDetail = 'No readable text found in screenshot';
    return result;
  }

  result.wordCount = rawText.split(/\s+/).length;
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  if (lines.length > 0) {
    result.extractedAmount = extractAmount(lines);
    result.extractedUtr = extractUtr(lines.map(l => normalizeOCRValue(l)));
    const { receivers, senders, allUpiIds } = extractUpiIds(lines);
    if (receivers.length > 0) result.extractedReceiverUpi = receivers[0];
    if (senders.length > 0) result.extractedSenderUpi = senders[0];
    result.extractedDate = extractDate(lines);
    result.extractedTime = extractTime(lines);
    result.extractedStatus = extractStatus(lines);
    result.extractedBankName = extractBankApp(lines);
    result.extractedTxnId = extractTxnId(lines);
    const { receiverName, senderName } = extractNames(lines);
    if (receiverName) result.receiverName = receiverName;
    if (senderName) result.senderName = senderName;
    if (allUpiIds.length > 3) result.ambiguous = true;
  }

  const fieldNames = ['extractedAmount', 'extractedUtr', 'extractedReceiverUpi', 'extractedSenderUpi', 'extractedDate', 'extractedTime', 'extractedStatus', 'extractedBankName', 'extractedTxnId', 'receiverName', 'senderName'];
  result.fieldCount = fieldNames.filter(f => result[f] !== null && result[f] !== undefined && result[f] !== '').length;

  if (result.fieldCount === 0 && rawText.length > 50) {
    result.parserError = true;
    result.parserErrorDetail = 'Parser failed to extract any fields despite ' + rawText.length + ' chars of text';
  }

  const { score } = computeConfidence(result, rawText);
  result.confidence = score;

  return result;
}

module.exports = { parseOCRText };
