function extractField(text, patterns) {
  if (!text) return null;
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function extractAmount(text) {
  const patterns = [
    /(?:Rs\.?|₹|INR)\s*([0-9,]+(?:\.[0-9]{2})?)/i,
    /(?:Amount|Paid|Total|Amount Paid)\s*:?\s*(?:Rs\.?|₹|INR)?\s*([0-9,]+(?:\.[0-9]{2})?)/i,
    /(?:Rs\.?|₹|INR)\s*([0-9,]+(?:\.[0-9]{2})?)/i,
    /\b([0-9]{2,4}(?:,[0-9]{3})*(?:\.[0-9]{2})?)\b/,
  ];
  const raw = extractField(text, patterns);
  if (!raw) return null;
  return parseFloat(raw.replace(/,/g, ''));
}

function extractUTR(text) {
  const patterns = [
    /\b(?:UTR|UTR\s*No|Transaction\s*(?:ID|No|Ref)|RRN|Ref\s*No)\s*:?\s*([A-Z0-9]{12,22})\b/i,
    /\b([A-Z0-9]{12,22})\b/,
  ];
  let utr = extractField(text, patterns);
  if (utr) {
    utr = utr.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (utr.length >= 12 && utr.length <= 22) return utr;
  }
  return null;
}

function extractUPI(text) {
  const patterns = [
    /\b([a-zA-Z0-9._-]{3,64}@[a-zA-Z]{3,20})\b/g,
    /(?:UPI\s*(?:ID|Handle|VPA)?|Pay\s*(?:to|via)|VPA)\s*:?\s*([a-zA-Z0-9._-]+@[a-zA-Z]+)/i,
  ];
  const matches = text.match(/([a-zA-Z0-9._-]{3,64}@[a-zA-Z]{3,20})/g);
  if (matches) {
    const valid = matches.filter(m => m.includes('@') && m.length < 70);
    return valid.length > 0 ? valid[valid.length - 1].toLowerCase() : null;
  }
  return null;
}

function extractReceiverName(text) {
  const patterns = [
    /(?:Paid to|Payee|Beneficiary|Receiver|To|Transfer to|Sent to)\s*:?\s*([A-Za-z\s]+)/i,
    /(?:Name|Account\s*Holder)\s*:?\s*([A-Za-z\s]{3,40})/i,
  ];
  return extractField(text, patterns);
}

function extractDate(text) {
  const patterns = [
    /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/,
    /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\b/i,
    /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4})\b/i,
    /\b(\d{4}[/-]\d{2}[/-]\d{2})\b/,
    /\b(\d{2}\s+[A-Za-z]{3}\s+\d{2,4})\b/,
  ];
  return extractField(text, patterns);
}

function extractTime(text) {
  const patterns = [
    /\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\b/i,
  ];
  return extractField(text, patterns);
}

function extractStatus(text) {
  if (!text) return null;
  const t = text.toUpperCase();
  // 1) Explicit Status/State field wins over any marketing footer text.
  const line = text.match(/(?:Payment\s*Status|Status|State)\s*:?\s*([A-Za-z]{3,20})/i);
  if (line && line[1]) {
    const w = line[1].toUpperCase();
    if (/\b(SUCCESS|SUCCESSFUL|COMPLETED|PAID|CREDITED|DONE)\b/.test(w)) return 'SUCCESS';
    if (/\b(FAILED|REJECTED|DECLINED|CANCELLED|FAIL|UNSUCCESSFUL|REFUNDED)\b/.test(w)) return 'FAILED';
    if (/\b(PENDING|PROCESSING|INITIATED|IN PROGRESS)\b/.test(w)) return 'PENDING';
  }
  // 2) FAILED/PENDING state words take priority over the SUCCESS tagline,
  //    otherwise a "Transaction successful via PhonePe" footer would mask a
  //    failed transaction that still carries the marketing line.
  if (/\b(FAILED|REJECTED|DECLINED|CANCELLED|FAIL|UNSUCCESSFUL|REFUNDED)\b/.test(t)) return 'FAILED';
  if (/\b(PENDING|PROCESSING|INITIATED|IN PROGRESS)\b/.test(t)) return 'PENDING';
  if (/\b(SUCCESS|SUCCESSFUL|COMPLETED|PAID|CREDITED|DONE)\b/.test(t)) return 'SUCCESS';
  return null;
}

function extractBankOrApp(text) {
  const patterns = [
    /(?:Bank|App|Via|Through)\s*:?\s*([A-Za-z\s]+)/i,
  ];
  return extractField(text, patterns);
}

function extractAllFields(text) {
  return {
    amount: extractAmount(text),
    utr: extractUTR(text),
    upi_id: extractUPI(text),
    receiver_name: extractReceiverName(text),
    date: extractDate(text),
    time: extractTime(text),
    status: extractStatus(text),
    bank_or_app: extractBankOrApp(text),
  };
}

module.exports = { extractAllFields, extractAmount, extractUTR, extractUPI, extractReceiverName, extractDate, extractTime, extractStatus, extractBankOrApp };
