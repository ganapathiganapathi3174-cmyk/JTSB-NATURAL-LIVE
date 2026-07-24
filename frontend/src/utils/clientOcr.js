let worker = null;
let loading = false;
let loaded = false;

const ADMIN_UPI = 'jayarajj126-3@okicici';
const ACCEPTED_STATUSES = ['SUCCESS', 'SUCCESSFUL', 'CREDITED', 'PAID', 'DEBIT_SUCCESS', 'COMPLETED'];
const UPI_DOMAINS = ['okicici', 'okaxis', 'oksbi', 'paytm', 'ybl', 'ibl', 'axl', 'hdfcbank', 'icicibank', 'kvb', 'sbi', 'ubi', 'ptyes'];

function normalizeUpi(u) {
  return (u || '').toLowerCase().replace(/\s/g, '').trim();
}

function extractAmount(text) {
  const patterns = [
    /(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/gi,
    /(?:Amount|AMT|Total|Debited|Paid)[:\s]*(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d{1,2})?)/gi,
    /(?:^|\s)([\d,]+\.\d{2})(?:\s|$)/gm,
  ];
  const found = [];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(text)) !== null) {
      const num = parseFloat(m[1].replace(/,/g, ''));
      if (num > 0 && num < 1000000) found.push(num);
    }
  }
  return found.length ? String(found[0]) : null;
}

function extractUtr(text) {
  const patterns = [
    /(?:UTR|RRN|Ref(?:erence)?|Txn\s*ID|Transaction\s*(?:ID|No))[:\s#]*([A-Za-z0-9]{8,30})/gi,
    /\b(\d{12,})\b/g,
    /\b([A-Za-z0-9]{10,30})\b/g,
  ];
  for (let i = 0; i < patterns.length; i++) {
    const matches = [];
    let m;
    const p = patterns[i];
    while ((m = p.exec(text)) !== null) {
      const val = m[1] || m[0];
      if (i === 0) return val.trim();
      if (/^\d{10,}$/.test(val) && val.length >= 10) matches.push(val);
    }
    if (matches.length) return matches[0];
  }
  return null;
}

function extractReceiverUpi(text) {
  const patterns = [
    /(?:To|Beneficiary|Receiver|Merchant|Sent to)[:\s]*([a-zA-Z0-9.\-_]+@[a-zA-Z0-9]+)/gi,
    /\b([a-zA-Z0-9.\-_]+@(?:okicici|okaxis|oksbi|paytm|ybl|ibl|axl|hdfcbank|icicibank|ptyes|kvb|sbi|ubi))\b/gi,
    /\b([a-zA-Z0-9.\-_]+@[a-zA-Z0-9]+)\b/g,
  ];
  for (const p of patterns) {
    const matches = [];
    let m;
    while ((m = p.exec(text)) !== null) {
      const vpa = m[1].trim().toLowerCase();
      if (vpa.includes('@') && vpa.length > 5) matches.push(vpa);
    }
    if (matches.length) {
      const exact = matches.find(u => u === normalizeUpi(ADMIN_UPI));
      return exact || matches[0];
    }
  }
  return null;
}

function extractDate(text) {
  const patterns = [
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/g,
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+(\d{2,4})/gi,
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/g,
  ];
  const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  for (const p of patterns) {
    let m;
    while ((m = p.exec(text)) !== null) {
      let y, mo, d;
      if (p.source.includes('Jan|Feb')) {
        d = m[1].padStart(2, '0');
        mo = (months[m[2].toLowerCase().slice(0, 3)] || '01');
        y = m[3].length === 2 ? '20' + m[3] : m[3];
      } else if (p.source.startsWith('(\\d{4})')) {
        y = m[1]; mo = m[2].padStart(2, '0'); d = m[3].padStart(2, '0');
      } else {
        d = m[1].padStart(2, '0'); mo = m[2].padStart(2, '0');
        y = m[3].length === 2 ? '20' + m[3] : m[3];
      }
      return y + '-' + mo + '-' + d;
    }
  }
  return null;
}

function extractTime(text) {
  const m = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const mi = m[2];
    const ap = m[4] ? m[4].toUpperCase() : null;
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return String(h).padStart(2, '0') + ':' + mi;
  }
  return null;
}

function extractPaymentStatus(text) {
  const upper = text.toUpperCase();
  for (const s of ACCEPTED_STATUSES) {
    if (upper.includes(s)) return s;
  }
  if (upper.includes('FAILED') || upper.includes('DECLINED')) return 'FAILED';
  if (upper.includes('PENDING')) return 'PENDING';
  return null;
}

function extractSenderUpi(text) {
  const patterns = [
    /(?:From|Sender|Debited from|Paid by)[:\s]*([a-zA-Z0-9.\-_]+@[a-zA-Z0-9]+)/gi,
  ];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(text)) !== null) {
      return m[1].trim().toLowerCase();
    }
  }
  return null;
}

export async function runClientOcr(imageSource, onProgress) {
  if (!loaded && !loading) {
    loading = true;
    try {
      const Tesseract = await import('tesseract.js');
      worker = await Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text' && onProgress) {
            onProgress({ stage: 'ocr', progress: Math.round((m.progress || 0) * 100) });
          }
        },
      });
      loaded = true;
    } catch (e) {
      loading = false;
      throw new Error('Failed to load OCR engine: ' + e.message);
    }
    loading = false;
  }

  if (onProgress) onProgress({ stage: 'ocr', progress: 0 });

  const { data } = await worker.recognize(imageSource);
  const text = data.text || '';
  const confidence = data.confidence || 0;

  if (onProgress) onProgress({ stage: 'ocr', progress: 100 });

  const amount = extractAmount(text);
  const utr = extractUtr(text);
  const receiverUpi = extractReceiverUpi(text);
  const senderUpi = extractSenderUpi(text);
  const date = extractDate(text);
  const time = extractTime(text);
  const paymentStatus = extractPaymentStatus(text);

  return {
    rawText: text,
    confidence: Math.round(confidence * 10) / 10,
    extracted: { amount, utr, receiverUpi, senderUpi, date, time, paymentStatus },
  };
}

export function isClientOcrAvailable() {
  return loaded || !loading;
}
