const { COL_UPI_PAYMENTS } = require('../api/_shared.js');
const { runQuery, updateDoc } = require('../api/_supabase.js');
const verificationEngine = require('../api/_verification/index.js');

const IS_VERCEL = !!process.env.VERCEL;
const PER_PAYMENT_TIMEOUT = IS_VERCEL ? 22000 : 90000;

async function processNextPayment() {
  const result = { processed: 0, approved: 0, rejected: 0, manualReview: 0, errors: [] };

  // Process pending upi_payments with screenshots (the source of truth)
  const payments = await runQuery(COL_UPI_PAYMENTS, [
    { field: 'status', op: 'IN', value: ['pending', 'manual_review'] },
  ], { orderBy: 'created_at', ascending: true, limit: 10 });

  for (const payment of payments || []) {
    if (!payment.screenshot_url) { result.errors.push({ paymentId: payment.id, error: 'No screenshot' }); continue; }
    result.processed++;
    try {
      const v = await Promise.race([
        verificationEngine.run(payment, payment.screenshot_url, payment.user_id, payment.utr),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), PER_PAYMENT_TIMEOUT)),
      ]);
      const finalStatus = v.status === 'verified' ? 'verified' : (v.status === 'rejected' ? 'rejected' : 'manual_review');
      await updateDoc(COL_UPI_PAYMENTS, payment.id, {
        status: finalStatus, ocr_result: v.ocrData || null, final_score: v.verificationScore || 0,
        fraud_score: v.fraudScore || 0, rejection_reasons: v.reasons || [],
        verified_at: new Date().toISOString(), verification_completed_at: new Date().toISOString(),
        verification_locked: false,
      });
      if (finalStatus === 'verified') result.approved++;
      else if (finalStatus === 'rejected') result.rejected++;
      else result.manualReview++;
    } catch (e) {
      result.errors.push({ paymentId: payment.id, error: e.message === 'TIMEOUT' ? 'Timeout' : e.message });
      await updateDoc(COL_UPI_PAYMENTS, payment.id, {
        status: 'manual_review', verification_locked: false,
        rejection_reasons: ['Auto-verification timed out, awaiting admin review'],
      }).catch(() => {});
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
