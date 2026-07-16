const { COL_ORDERS, COL_UPI_PAYMENTS } = require('../api/_shared.js');
const { runQuery, updateDoc } = require('../api/_supabase.js');
const { runBankSmsVerification } = require('../api/_bankSmsVerificationEngine.js');
const { submitPaymentProof } = require('../api/_paymentOrderManager.js');

const IS_VERCEL = !!process.env.VERCEL;
const PER_PAYMENT_TIMEOUT = IS_VERCEL ? 22000 : 90000;

async function processNextPayment() {
  const result = { processed: 0, approved: 0, rejected: 0, manualReview: 0, errors: [] };

  // Try pending orders with screenshots first
  const orders = await runQuery(COL_ORDERS, [
    { field: 'status', op: 'EQUAL', value: 'pending' },
  ], { limit: 5 });

  for (const order of orders || []) {
    if (!order.screenshot_url) continue;
    result.processed++;
    try {
      const v = await Promise.race([
        submitPaymentProof(order.id, order.screenshot_url, {}),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), PER_PAYMENT_TIMEOUT)),
      ]);
      if (v.status === 'verified') result.approved++;
      else if (v.status === 'rejected') result.rejected++;
      else result.manualReview++;
    } catch (e) {
      result.errors.push({ orderId: order.id, error: e.message === 'TIMEOUT' ? 'Timeout' : e.message });
    }
  }

  // If no orders processed, try pending upi_payments
  if (result.processed === 0) {
    const payments = await runQuery(COL_UPI_PAYMENTS, [
      { field: 'status', op: 'EQUAL', value: 'pending' },
    ], { orderBy: 'created_at', ascending: true, limit: 5 });

    for (const payment of payments || []) {
      if (!payment.screenshot_url) continue;
      result.processed++;
      try {
        const v = await Promise.race([
          runBankSmsVerification(payment, payment.screenshot_url, payment.user_id),
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
      }
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
