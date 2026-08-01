const { COL_UPI_PAYMENTS } = require('../api/_shared.js');
const { runQuery, updateDoc } = require('../api/_supabase.js');
const { verifySession } = require('../api/_verificationEngine.js');
const { executeVerifiedOrder } = require('../api/_approvalPipeline.js');
const { broadcast } = require('../api/_sse.js');

function nowISO() { return new Date().toISOString(); }

async function processNextPayment() {
  const result = { processed: 0, approved: 0, rejected: 0, manualReview: 0, errors: [] };
  const payments = await runQuery(COL_UPI_PAYMENTS, [
    { field: 'status', op: 'IN', value: ['pending', 'manual_review'] },
  ], { orderBy: 'created_at', ascending: true, limit: 10 });
  for (const payment of payments || []) {
    if (!payment.screenshot_url) { result.errors.push({ paymentId: payment.id, error: 'No screenshot' }); continue; }
    result.processed++;
    try {
      const v = await verifySession(payment, payment.screenshot_url, payment.user_id, payment.utr, null, null);
      const fs = v.status === 'verified' ? 'verified' : (v.status === 'rejected' ? 'rejected' : 'manual_review');
      await updateDoc(COL_UPI_PAYMENTS, payment.id, {
        status: fs, ocr_result: v.ocrData || null, final_score: v.confidence || 0,
        fraud_score: v.fraudScore || 0, risk_score: v.riskScore || 0,
        utr_hash: v.utrHash || null, screenshot_hash: v.screenshotHash || null,
        rejection_reasons: v.reasons || [], verified_at: nowISO(),
        verification_locked: false, verification_completed_at: nowISO(),
      });
      if (fs === 'verified') {
        // B2 FIX: execute full post-approval business logic (wallet credit for
        // topups, user creation for registrations, referrals, notifications).
        const orderLike = {
          id: payment.id,
          type: payment.payment_type,
          amount: Number(payment.amount),
          pending_reg_id: payment.pending_reg_id,
          user_id: payment.user_id,
          screenshot_url: payment.screenshot_url,
        };
        await executeVerifiedOrder(orderLike, v, {
          userId: payment.user_id,
          pendingRegId: payment.pending_reg_id,
          userEnteredUtr: payment.utr || null,
          upiPaymentId: payment.id,
        }).catch(e => result.errors.push({ paymentId: payment.id, error: 'Post-approval: ' + e.message }));
        result.approved++;
      } else if (fs === 'rejected') {
        result.rejected++;
      } else {
        result.manualReview++;
      }
      try { broadcast('paymentUpdated', { paymentId: payment.id, status: fs, type: payment.payment_type }); } catch {}
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
