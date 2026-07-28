const { addDoc } = require('../_supabase.js');
const { COL_VERIFICATION_LOGS } = require('../_shared.js');

async function record(entry) {
  try {
    await addDoc(COL_VERIFICATION_LOGS, {
      payment_id: entry.paymentId || null,
      order_id: entry.orderId || null,
      user_id: entry.userId || null,
      status: entry.status || 'unknown',
      confidence: entry.confidence || 0,
      raw_text: entry.rawText ? entry.rawText.substring(0, 2000) : null,
      extracted: entry.extracted || null,
      reasons: entry.reasons || [],
      engine: 'JSREE APEX V6',
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[V6 AUDIT] Write failed:', e.message);
  }
}

module.exports = { record };
