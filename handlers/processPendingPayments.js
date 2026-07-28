const { COL_UPI_PAYMENTS } = require('../api/_shared.js');
const { runQuery, updateDoc } = require('../api/_supabase.js');
const v6 = require('../api/verification6.js');

async function processNextPayment() {
  const result = { processed: 0, approved: 0, rejected: 0, manualReview: 0, errors: [] };
  const payments = await runQuery(COL_UPI_PAYMENTS, [
    { field: 'status', op: 'IN', value: ['pending', 'manual_review'] },
  ], { orderBy: 'created_at', ascending: true, limit: 10 });
  for (const payment of payments || []) {
    if (!payment.screenshot_url) { result.errors.push({ paymentId: payment.id, error: 'No screenshot' }); continue; }
    result.processed++;
    try {
      const v = await v6.verify(payment, payment.screenshot_url, payment.user_id, payment.utr, null, null);
      const fs = v.status === 'verified' ? 'verified' : (v.status === 'rejected' ? 'rejected' : 'manual_review');
      await updateDoc(COL_UPI_PAYMENTS, payment.id, {
        status: fs, ocr_result: v.ocrData || null, final_score: v.confidence || 0,
        rejection_reasons: v.reasons || [], verified_at: new Date().toISOString(),
        verification_locked: false,
      });
      if (fs === 'verified') result.approved++;
      else if (fs === 'rejected') result.rejected++;
      else result.manualReview++;
    } catch (e) {
      result.errors.push({ paymentId: payment.id, error: e.message });
      result.manualReview++;
    }
  }
  return result;
}

// HTTP handler (used by API route)
async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }
  try {
    const result = await processNextPayment();
    res.writeHead(200); res.end(JSON.stringify(result));
  } catch (err) {
    console.error('[processPendingPayments] Error:', err.message);
    console.error('[processPendingPayments] Stack:', err.stack);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

module.exports = handler;
module.exports.processNextPayment = processNextPayment;
