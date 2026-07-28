const crypto = require('crypto');
const { runQuery } = require('../_supabase.js');
const { COL_UPI_PAYMENTS, COL_PROCESSED_PAYMENTS } = require('../_shared.js');

function hashUtr(utr) {
  if (!utr) return null;
  return crypto.createHash('sha256').update(utr.toUpperCase().trim()).digest('hex');
}

function hashBuffer(buf) {
  if (!buf || buf.length === 0) return null;
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function check(utr, imageBuffer, userId) {
  const result = { duplicateUtr: false, duplicateImage: false, existingPayment: null };

  const utrHash = hashUtr(utr);
  if (utrHash) {
    const matches = await runQuery(COL_UPI_PAYMENTS, [
      { field: 'utr_hash', op: 'EQUAL', value: utrHash },
    ], { limit: 2 });
    for (const m of matches || []) {
      if (m.user_id !== userId) {
        result.duplicateUtr = true;
        result.existingPayment = m;
        break;
      }
    }
  }

  const imgHash = hashBuffer(imageBuffer);
  if (imgHash) {
    const imgMatches = await runQuery(COL_UPI_PAYMENTS, [
      { field: 'screenshot_hash', op: 'EQUAL', value: imgHash },
    ], { limit: 2 });
    if (imgMatches && imgMatches.length > 0) result.duplicateImage = true;
  }

  return result;
}

module.exports = { check, hashUtr, hashBuffer };
