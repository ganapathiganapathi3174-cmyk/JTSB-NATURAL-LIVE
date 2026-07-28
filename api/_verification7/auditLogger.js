const { addDoc } = require('../_supabase.js');
const { COL_VERIFICATION_LOGS } = require('../_shared.js');
const crypto = require('crypto');

async function record(entry) {
  try {
    await addDoc(COL_VERIFICATION_LOGS, {
      payment_id: entry.paymentId || null,
      order_id: entry.orderId || null,
      user_id: entry.userId || null,
      utr: entry.utr || null,
      status: entry.status || 'unknown',
      score: entry.confidence || 0,
      ocr_confidence: entry.ocrConfidence || 0,
      ocr_amount: entry.normalized?.amount !== null && entry.normalized?.amount !== undefined ? String(entry.normalized.amount) : null,
      ocr_upi: entry.normalized?.upi || null,
      ocr_utr: entry.normalized?.utr || null,
      ocr_date: entry.normalized?.date?.iso || null,
      final_score: entry.confidence || 0,
      fraud_score: entry.fraudScore || 0,
      reason: entry.reasons ? entry.reasons.join('; ') : null,
      image_hash: entry.imageHash || null,
      engine: 'JSREE APEX Enterprise V7',
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[V7 AUDIT] Write failed:', e.message);
  }
}

module.exports = { record };
