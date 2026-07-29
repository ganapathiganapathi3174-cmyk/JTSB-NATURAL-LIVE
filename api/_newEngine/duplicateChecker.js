const crypto = require('crypto');
const { COL_UPI_PAYMENTS } = require('../_shared.js');
const { runQuery } = require('../_supabase.js');
const { normalizeUTR } = require('./fieldNormalizer.js');

function hashBuffer(buf) {
  if (!buf) return null;
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function hashText(val) {
  if (!val) return null;
  return crypto.createHash('sha256').update(String(val).toUpperCase().trim()).digest('hex');
}

async function checkDuplicate(extractedUtr, screenshotBuf) {
  const result = { duplicate: false, type: null, existingId: null, reasons: [] };

  const utr = extractedUtr ? normalizeUTR(extractedUtr) : null;
  if (utr && utr.length >= 12) {
    const utrHash = hashText(utr);
    try {
      const existing = await runQuery(COL_UPI_PAYMENTS, [
        { field: 'utr_hash', op: 'EQUAL', value: utrHash },
        { field: 'status', op: 'NOT_EQUAL', value: 'rejected' },
      ], { limit: 1 });
      if (existing && existing.length > 0) {
        result.duplicate = true;
        result.type = 'duplicate_utr';
        result.existingId = existing[0].id;
        result.reasons.push('UTR ' + utr.slice(0, 6) + '**** already exists');
      }
    } catch {}
  }

  if (screenshotBuf && Buffer.isBuffer(screenshotBuf)) {
    const imgHash = hashBuffer(screenshotBuf);
    if (imgHash) {
      try {
        const existing = await runQuery(COL_UPI_PAYMENTS, [
          { field: 'screenshot_hash', op: 'EQUAL', value: imgHash },
          { field: 'status', op: 'NOT_EQUAL', value: 'rejected' },
        ], { limit: 1 });
        if (existing && existing.length > 0) {
          result.duplicate = true;
          result.type = 'duplicate_screenshot';
          result.existingId = existing[0].id;
          result.reasons.push('Screenshot already exists in system');
        }
      } catch {}
    }
  }

  return result;
}

module.exports = { checkDuplicate, hashBuffer, hashText };
