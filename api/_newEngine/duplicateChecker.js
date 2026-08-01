const crypto = require('crypto');
const { COL_UPI_PAYMENTS } = require('../_shared.js');
const supabaseMod = require('../_supabase.js');
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
      const existing = await supabaseMod.runQuery(COL_UPI_PAYMENTS, [
        { field: 'utr_hash', op: 'EQUAL', value: utrHash },
        { field: 'status', op: 'NOT_EQUAL', value: 'rejected' },
      ], { limit: 1 });
      if (existing && existing.length > 0) {
        result.duplicate = true;
        result.type = 'duplicate_utr';
        result.existingId = existing[0].id;
        result.reasons.push('UTR ' + utr.slice(0, 6) + '**** already exists');
      }
    } catch (e) {
      // utr_hash column may not exist yet — fall back to a plain-UTR scan so
      // duplicate detection never silently disables.
      console.warn('[DUPLICATE] utr_hash lookup failed, falling back to utr scan: ' + e.message);
      try {
        const dup = await supabaseMod.runQuery(COL_UPI_PAYMENTS, [], { limit: 2000 });
        const hit = (dup || []).find(p =>
          p.utr && p.utr.toUpperCase().trim() === utr.toUpperCase().trim() &&
          p.status !== 'rejected' && p.status !== 'failed'
        );
        if (hit) {
          result.duplicate = true;
          result.type = 'duplicate_utr';
          result.existingId = hit.id;
          result.reasons.push('UTR ' + utr.slice(0, 6) + '**** already exists');
        }
      } catch (scanErr) {
        console.warn('[DUPLICATE] utr fallback scan failed: ' + scanErr.message);
      }
    }
  }

  if (screenshotBuf && Buffer.isBuffer(screenshotBuf)) {
    const imgHash = hashBuffer(screenshotBuf);
    if (imgHash) {
      try {
        const existing = await supabaseMod.runQuery(COL_UPI_PAYMENTS, [
          { field: 'screenshot_hash', op: 'EQUAL', value: imgHash },
          { field: 'status', op: 'NOT_EQUAL', value: 'rejected' },
        ], { limit: 1 });
        if (existing && existing.length > 0) {
          result.duplicate = true;
          result.type = 'duplicate_screenshot';
          result.existingId = existing[0].id;
          result.reasons.push('Screenshot already exists in system');
        }
      } catch (e) {
        console.warn('[DUPLICATE] screenshot_hash lookup failed (column may not exist yet): ' + e.message);
      }
    }
  }

  return result;
}

module.exports = { checkDuplicate, hashBuffer, hashText };
