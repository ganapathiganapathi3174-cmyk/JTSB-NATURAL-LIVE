const crypto = require('crypto');
const { runQuery } = require('../_supabase.js');
const { COL_UPI_PAYMENTS } = require('../_shared.js');
const log = require('./logger').DEDUP;

function computeTextHash(text) {
  if (!text) return '';
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

async function checkField(field, value, label) {
  if (!value) return { name: label, isDuplicate: false, existingPaymentId: null };
  try {
    const results = await runQuery(COL_UPI_PAYMENTS, [
      { field, op: 'EQUAL', value },
    ], { limit: 5 });
    if (results && results.length > 0) {
      const active = results.filter(r => r.status !== 'rejected');
      if (active.length > 0) return { name: label, isDuplicate: true, existingPaymentId: active[0].id, matchCount: active.length };
    }
  } catch (e) {
    log.error(label + ' DB check error: ' + e.message);
  }
  return { name: label, isDuplicate: false, existingPaymentId: null };
}

async function run(utr, txnId, screenshotHash, ocrTextHash) {
  const t0 = Date.now();
  const checks = await Promise.all([
    checkField('utr', utr, 'utr_duplicate'),
    checkField('screenshot_hash', screenshotHash || '', 'screenshot_duplicate'),
    checkField('ocr_text_hash', ocrTextHash || '', 'ocr_text_duplicate'),
  ]);

  if (txnId && txnId !== utr) {
    const txnCheck = await checkField('transaction_id', txnId, 'transaction_id_duplicate');
    checks.push(txnCheck);
  }

  const isDuplicate = checks.some(c => c.isDuplicate);
  const details = checks.map(c => c.name + '=' + c.isDuplicate).join(' ');
  log.info('Duplicates: ' + details + ' (' + (Date.now() - t0) + 'ms)');
  return { checks, isDuplicate, duration: Date.now() - t0 };
}

module.exports = { run, computeTextHash };