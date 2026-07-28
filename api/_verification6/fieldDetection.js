const C = require('./config.js');

function extract(rawText) {
  const t = rawText || '';
  const result = { amount: null, utr: null, upi: null, name: null, date: null, time: null, status: null };
  const num = t.replace(/,/g, '');
  const amtMatch = num.match(/(?:Rs\.?|INR|₹)\s*(\d+[\.\d]*)/i) || t.match(/(\d{3,})\s*(?:rs|inr)/i);
  if (amtMatch) result.amount = parseFloat(amtMatch[1].replace(/[^\d.]/g, ''));
  const utrParts = t.match(/[A-Z0-9]{12,}/g);
  if (utrParts) result.utr = utrParts.sort((a, b) => b.length - a.length)[0];
  const upiParts = t.match(/[\w.\-]+@[\w.]+/g);
  if (upiParts) result.upi = upiParts[0].toLowerCase();
  const nameParts = t.match(/[A-Z]{4,}(?:\s+[A-Z]{2,})+/g);
  if (nameParts) result.name = nameParts[0];
  const dateParts = t.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (dateParts) result.date = dateParts[0];
  const timeParts = t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (timeParts) result.time = timeParts[0];
  if (/success|completed|paid|credited/i.test(t)) result.status = 'SUCCESS';
  else if (/failed|declined|rejected/i.test(t)) result.status = 'FAILED';
  else if (/pending|processing/i.test(t)) result.status = 'PENDING';
  return result;
}

module.exports = { extract };
