const {
  COL_ORDERS, COL_UPI_PAYMENTS, COL_USERS,
} = require('../api/_shared.js');
const { runQuery, addDoc } = require('../api/_supabase.js');
const metrics = require('../api/_metrics.js');

const TRACE = (label) => console.log(`[${new Date().toISOString().slice(11, 23)}] ${label}`);

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  try {
    const orders = await runQuery(COL_ORDERS, [
      { field: 'status', op: 'EQUAL', value: 'pending' },
    ], { limit: 50 });

    TRACE(`[AUTO-VERIFY] Pending orders: ${orders ? orders.length : 0}`);

    const results = { processed: 0, approved: 0, rejected: 0, manualReview: 0, errors: [] };

    for (const order of orders) {
      const orderId = order.id;
      results.processed++;
      TRACE(`[AUTO-VERIFY] Processing order ${orderId}, type=${order.type}, amount=${order.amount}`);

      try {
        const { submitPaymentProof } = require('../api/_paymentOrderManager.js');
        const verification = await submitPaymentProof(orderId, order.screenshot_url || '');
        results[verification.status === 'verified' ? 'approved' : verification.status === 'rejected' ? 'rejected' : 'manualReview']++;
        TRACE(`[AUTO-VERIFY] Order ${orderId} -> ${verification.status}`);
      } catch (e) {
        TRACE(`[AUTO-VERIFY] Order ${orderId} error: ${e.message}`);
        results.errors.push({ orderId, error: e.message });
      }
    }

    // Also process old upi_payments still pending using new AI verification
    const pendingPayments = await runQuery(COL_UPI_PAYMENTS, [
      { field: 'status', op: 'EQUAL', value: 'pending' },
    ], { orderBy: 'created_at', ascending: true, limit: 20 });

    for (const payment of pendingPayments) {
      results.processed++;
      try {
        const { runBankSmsVerification } = require('../api/_bankSmsVerificationEngine.js');
        const verification = await runBankSmsVerification(payment, payment.screenshot_url || '', payment.user_id);
        const finalStatus = verification.status === 'verified' ? 'verified' : (verification.status === 'rejected' ? 'rejected' : 'manual_review');
        await require('../api/_supabase.js').updateDoc(COL_UPI_PAYMENTS, payment.id, {
          status: finalStatus,
          ocr_result: verification.ocrData || null,
          final_score: verification.verificationScore || 0,
          fraud_score: verification.fraudScore || 0,
          rejection_reasons: verification.reasons || [],
          verified_at: new Date().toISOString(),
          verification_completed_at: new Date().toISOString(),
          verification_locked: false,
        });
        results[finalStatus === 'verified' ? 'approved' : finalStatus === 'rejected' ? 'rejected' : 'manualReview']++;
      } catch (e) {
        results.errors.push({ paymentId: payment.id, error: e.message });
      }
    }

    TRACE(`[AUTO-VERIFY] END: processed=${results.processed} approved=${results.approved} rejected=${results.rejected} manualReview=${results.manualReview} errors=${results.errors.length}`);
    res.writeHead(200); res.end(JSON.stringify(results));
  } catch (err) {
    console.error('[processPendingPayments] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
