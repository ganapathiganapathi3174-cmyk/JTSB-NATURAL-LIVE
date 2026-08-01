const crypto = require('crypto');
const { COL_UPI_PAYMENTS } = require('../_shared.js');
const supabaseMod = require('../_supabase.js');
const { normalizeUTR } = require('./fieldNormalizer.js');
const phashModule = require('./phash.js');
const C = require('./config.js');

function hashBuffer(buf) {
  if (!buf) return null;
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function hashText(val) {
  if (!val) return null;
  return crypto.createHash('sha256').update(String(val).toUpperCase().trim()).digest('hex');
}

async function checkDuplicate(extractedUtr, screenshotBuf, opts = {}) {
  const result = {
    duplicate: false, type: null, existingId: null, reasons: [],
    utrHash: null, screenshotHash: null, phash: null,
  };

  const currentPaymentId = opts.paymentId || null;

  // ── 1) UTR duplicate (SHA-256 of normalized UTR) ──
  const utr = extractedUtr ? normalizeUTR(extractedUtr) : null;
  if (utr && utr.length >= 12) {
    const utrHash = hashText(utr);
    result.utrHash = utrHash;
    try {
      const existing = await supabaseMod.runQuery(COL_UPI_PAYMENTS, [
        { field: 'utr_hash', op: 'EQUAL', value: utrHash },
        { field: 'status', op: 'NOT_EQUAL', value: 'rejected' },
      ], { limit: 1 });
      if (existing && existing.length > 0 && existing[0].id !== currentPaymentId) {
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
          p.status !== 'rejected' && p.status !== 'failed' &&
          p.id !== currentPaymentId
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

  // ── 2) Screenshot duplicate (SHA-256 exact-content hash) ──
  let imgHash = null;
  if (screenshotBuf && Buffer.isBuffer(screenshotBuf)) {
    imgHash = hashBuffer(screenshotBuf);
    result.screenshotHash = imgHash;
    if (imgHash) {
      try {
        const existing = await supabaseMod.runQuery(COL_UPI_PAYMENTS, [
          { field: 'screenshot_hash', op: 'EQUAL', value: imgHash },
          { field: 'status', op: 'NOT_EQUAL', value: 'rejected' },
        ], { limit: 1 });
        if (existing && existing.length > 0 && existing[0].id !== currentPaymentId) {
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

  // ── 3) Perceptual-hash duplicate (dHash, tolerant to re-encoding) ──
  // Runs only when a buffer is available and no exact duplicate was found.
  if (screenshotBuf && Buffer.isBuffer(screenshotBuf) && !result.duplicate) {
    try {
      const phash = await phashModule.computePhash(screenshotBuf);
      result.phash = phash;
      if (phash) {
        const recent = await supabaseMod.runQuery(COL_UPI_PAYMENTS, [], {
          limit: C.PHASH_SCAN_LIMIT,
          orderBy: 'created_at',
          ascending: false,
        });
        for (const row of (recent || [])) {
          if (row.id === currentPaymentId) continue;
          if (!row.screenshot_phash) continue;
          if (row.status === 'rejected' || row.status === 'failed') continue;
          if (phashModule.isSimilar(phash, row.screenshot_phash, C.PHASH_THRESHOLD)) {
            result.duplicate = true;
            result.type = 'duplicate_phash';
            result.existingId = row.id;
            result.reasons.push('Screenshot perceptually identical to an existing payment (distance=' + phashModule.hammingDistance(phash, row.screenshot_phash) + ')');
            break;
          }
        }
      }
    } catch (e) {
      // screenshot_phash column may not exist yet — phash detection degrades
      // gracefully (sha256 exact-match still active).
      if (String(e.message || '').includes('does not exist')) {
        console.warn('[DUPLICATE] screenshot_phash column missing — phash detection disabled');
      } else {
        console.warn('[DUPLICATE] phash scan failed: ' + e.message);
      }
    }
  }

  return result;
}

module.exports = { checkDuplicate, hashBuffer, hashText };
