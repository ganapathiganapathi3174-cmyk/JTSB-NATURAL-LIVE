const { COL_ORDERS, COL_UPI_PAYMENTS } = require('../api/_shared.js');
const { runQuery, updateDoc } = require('../api/_supabase.js');
const { submitPaymentProof } = require('../api/_paymentOrderManager.js');

const IS_VERCEL = !!process.env.VERCEL;
const PER_ORDER_TIMEOUT = IS_VERCEL ? 20000 : 60000;

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  try {
    const orders = await runQuery(COL_ORDERS, [
      { field: 'status', op: 'EQUAL', value: 'pending' },
    ], { limit: 50 });

    const result = { processed: 0, approved: 0, rejected: 0, manualReview: 0, errors: [] };

    for (const order of orders || []) {
      result.processed++;
      if (!order.screenshot_url) {
        result.errors.push({ orderId: order.id, error: 'No screenshot' });
        continue;
      }
      try {
        const verifyResult = await Promise.race([
          submitPaymentProof(order.id, order.screenshot_url, {}),
          new Promise((_, reject) => setTimeout(() => reject(new Error('PER_ORDER_TIMEOUT')), PER_ORDER_TIMEOUT)),
        ]);
        if (verifyResult.status === 'verified') {
          result.approved++;
        } else if (verifyResult.status === 'rejected') {
          result.rejected++;
        } else {
          result.manualReview++;
        }
      } catch (e) {
        if (e.message === 'PER_ORDER_TIMEOUT') {
          result.errors.push({ orderId: order.id, error: 'Processing timed out - will retry next batch' });
        } else {
          result.errors.push({ orderId: order.id, error: e.message });
        }
      }
    }

    const pendingPayments = await runQuery(COL_UPI_PAYMENTS, [
      { field: 'status', op: 'EQUAL', value: 'pending' },
    ], { orderBy: 'created_at', ascending: true, limit: 10 });

    for (const payment of pendingPayments || []) {
      if (!payment.screenshot_url) continue;
      result.processed++;
      try {
        const { runBankSmsVerification } = require('../api/_bankSmsVerificationEngine.js');
        const verification = await Promise.race([
          runBankSmsVerification(payment, payment.screenshot_url, payment.user_id),
          new Promise((_, reject) => setTimeout(() => reject(new Error('PER_ORDER_TIMEOUT')), PER_ORDER_TIMEOUT)),
        ]);
        const finalStatus = verification.status === 'verified' ? 'verified' : (verification.status === 'rejected' ? 'rejected' : 'manual_review');
        await updateDoc(COL_UPI_PAYMENTS, payment.id, {
          status: finalStatus,
          ocr_result: verification.ocrData || null,
          final_score: verification.verificationScore || 0,
          fraud_score: verification.fraudScore || 0,
          rejection_reasons: verification.reasons || [],
          verified_at: new Date().toISOString(),
          verification_completed_at: new Date().toISOString(),
          verification_locked: false,
        });
        if (finalStatus === 'verified') result.approved++;
        else if (finalStatus === 'rejected') result.rejected++;
        else result.manualReview++;
      } catch (e) {
        if (e.message === 'PER_ORDER_TIMEOUT') {
          result.errors.push({ paymentId: payment.id, error: 'Processing timed out' });
        } else {
          result.errors.push({ paymentId: payment.id, error: e.message });
        }
      }
    }

    res.writeHead(200); res.end(JSON.stringify(result));
  } catch (err) {
    console.error('[processPendingPayments] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
