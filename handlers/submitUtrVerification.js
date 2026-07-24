const { runQuery } = require('../api/_supabase.js');
const { COL_UPI_PAYMENTS, COL_ORDERS, ADMIN_UPI_ID } = require('../api/_shared.js');
const { broadcast } = require('../api/_sse.js');

const UTR_REGEX = /^[A-Za-z0-9]{8,30}$/;

function log(msg) {
  console.log('[' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '] [UTR-VERIFY] ' + msg);
}

module.exports = async (req, res) => {
  const sendJSON = (code, data) => {
    if (res.headersSent) return;
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { sendJSON(405, { error: 'Method not allowed' }); return; }

  try {
    const { orderId, utr, screenshotUrl } = req.body || {};
    if (!orderId) { sendJSON(400, { error: 'orderId is required' }); return; }
    if (!utr || !utr.trim()) { sendJSON(400, { error: 'UTR is required' }); return; }

    const cleanUtr = utr.trim();
    if (!UTR_REGEX.test(cleanUtr)) {
      sendJSON(400, { error: 'Invalid UTR format. UTR must be 8-30 alphanumeric characters.' });
      return;
    }

    const { getDoc, updateDoc, addDoc } = require('../api/_supabase.js');
    const { executeVerifiedOrder } = require('../api/_paymentOrderManager.js');
    const order = await getDoc(COL_ORDERS, orderId);
    if (!order) { sendJSON(404, { error: 'Order not found' }); return; }
    if (order.status === 'expired') { sendJSON(400, { error: 'Order expired' }); return; }
    if (order.status === 'verified') { sendJSON(400, { error: 'Order already verified' }); return; }

    const expectedAmount = Number(order.amount) || 0;

    log('Validating order=' + orderId + ' utr=' + cleanUtr + ' expected=' + expectedAmount);

    const reasons = [];
    const checks = [];
    let decision = 'verified';
    let confidence = 95;

    // Check 1: UTR not duplicate
    const existingPayments = await runQuery(COL_UPI_PAYMENTS, [], { limit: 2000 });
    const duplicate = existingPayments.find(p =>
      p.utr && p.utr.toUpperCase().trim() === cleanUtr.toUpperCase().trim() &&
      p.status !== 'rejected' && p.id !== orderId
    );
    if (duplicate) {
      decision = 'rejected';
      reasons.push('This UTR has already been used for another payment');
      checks.push({ name: 'utr_unique', passed: false });
    } else {
      checks.push({ name: 'utr_unique', passed: true });
    }

    // Check 2: Amount is valid
    if (!expectedAmount || expectedAmount <= 0) {
      decision = 'rejected';
      reasons.push('Invalid order amount');
      checks.push({ name: 'valid_amount', passed: false });
    } else {
      checks.push({ name: 'valid_amount', passed: true });
    }

    // Check 3: Screenshot hash dedup (if provided)
    if (screenshotUrl && decision === 'verified') {
      try {
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256').update(screenshotUrl).digest('hex').substring(0, 16);
        const screenDup = existingPayments.find(p =>
          p.screenshot_hash === hash && p.id !== orderId
        );
        if (screenDup) {
          decision = 'manual_review';
          reasons.push('Screenshot appears to be a duplicate');
          checks.push({ name: 'screenshot_unique', passed: false });
        } else {
          checks.push({ name: 'screenshot_unique', passed: true });
        }
      } catch (_) {}
    }

    // Check 4: Submission timing (submitted within 60 minutes of order creation)
    if (order.created_at) {
      const createdMs = new Date(order.created_at).getTime();
      const ageMin = (Date.now() - createdMs) / 60000;
      if (ageMin > 60) {
        decision = 'manual_review';
        reasons.push('Payment submitted after 60 minutes');
        checks.push({ name: 'timing', passed: false });
      } else {
        checks.push({ name: 'timing', passed: true });
      }
    }

    if (decision === 'verified' && reasons.length === 0) {
      reasons.push('UTR validated successfully');
      confidence = 95;
    } else if (decision === 'manual_review') {
      confidence = 50;
    } else {
      confidence = 10;
    }

    log('Decision: ' + order.id + ' -> ' + decision + ' utr=' + cleanUtr + ' score=' + confidence);

    const nowISO = new Date().toISOString();
    const updateData = {
      status: decision,
      verification_status: decision,
      verification_score: confidence,
      ocr_result: { extractedUtr: cleanUtr, source: 'utr_manual_entry', confidence: 100 },
      rejection_reasons: reasons,
      updated_at: nowISO,
      utr: cleanUtr,
      verification_locked: false,
    };
    if (screenshotUrl) updateData.screenshot_url = screenshotUrl;

    await updateDoc(COL_ORDERS, orderId, updateData);

    if (decision === 'verified') {
      log('Auto-approved order ' + orderId);
      try {
        await executeVerifiedOrder(order, {
          status: 'verified',
          verificationScore: confidence,
          ocrData: { extractedUtr: cleanUtr, source: 'utr_manual_entry' },
          reasons,
        }, {
          userId: order.user_id,
          pendingRegId: order.pending_reg_id,
          userEnteredUtr: cleanUtr,
        });
      } catch (e) {
        log('Post-approval failed: ' + e.message);
      }
    }

    try {
      const searchField = order.pending_reg_id ? 'pending_reg_id' : 'user_id';
      const searchValue = order.pending_reg_id || order.user_id;
      if (searchValue) {
        const ups = await runQuery(COL_UPI_PAYMENTS, [
          { field: searchField, op: 'EQUAL', value: searchValue },
        ], { limit: 5 });
        for (const p of ups) {
          await updateDoc(COL_UPI_PAYMENTS, p.id, {
            status: decision,
            utr: cleanUtr,
            verification_locked: false,
            verified_at: nowISO,
            verification_completed_at: nowISO,
            final_score: confidence,
          }).catch(() => {});
        }
      }
    } catch (e) {
      log('upi_payments update failed: ' + e.message);
    }

    try { broadcast('paymentUpdated', { orderId, status: decision, type: order.type }); } catch (_) {}

    sendJSON(200, {
      orderId,
      status: decision,
      verificationStatus: decision,
      verificationScore: confidence,
      autoVerified: decision === 'verified',
      reasons,
      checks,
      utr: cleanUtr,
      message: decision === 'verified'
        ? 'Payment verified successfully!'
        : decision === 'rejected'
          ? 'Payment verification failed'
          : 'Payment submitted for manual review',
    });
  } catch (err) {
    log('Error: ' + err.message);
    sendJSON(500, { error: 'Internal server error' });
  }
};
