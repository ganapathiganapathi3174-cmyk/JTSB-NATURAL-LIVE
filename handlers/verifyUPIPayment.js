const { COL_PENDING_REGS, COL_USERS, getReferrerPackage, getPackageByReferral, validatePackageAmount } = require('../api/_shared.js');
const { getDoc, runQuery } = require('../api/_supabase.js');
const { createPaymentOrder, submitPaymentProof } = require('../api/_paymentOrderManager.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  try {
    const { pendingRegId, userId, type, amount, utr, upiId, paymentDate, screenshotUrl } = req.body || {};
    if (!type || !amount || !screenshotUrl) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Missing required fields: type, amount, screenshotUrl' })); return;
    }

    // Package validation for registration
    if (type === 'registration' && pendingRegId) {
      const pending = await getDoc(COL_PENDING_REGS, pendingRegId);
      if (!pending) { res.writeHead(404); res.end(JSON.stringify({ error: 'Pending registration not found' })); return; }
      const refCode = pending.referral_code;
      if (refCode) {
        const refUsers = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: refCode.toUpperCase() }], { limit: 1 });
        let allowedPkg = null;
        if (refUsers.length) allowedPkg = getReferrerPackage(refUsers[0]);
        else allowedPkg = getPackageByReferral(refCode);
        if (allowedPkg && !validatePackageAmount(allowedPkg, amount)) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'This referral link accepts only the \u20B9' + allowedPkg + ' package. Selected \u20B9' + amount + ' does not match.' })); return;
        }
      }
    }

    // Package validation for topup
    if (type === 'topup' && userId) {
      const user = await getDoc(COL_USERS, userId);
      if (user) {
        const userPkg = getReferrerPackage(user);
        if (userPkg && !validatePackageAmount(userPkg, amount)) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'Your \u20B9' + userPkg + ' package only accepts \u20B9' + userPkg + ' topup. Selected \u20B9' + amount + ' does not match.' })); return;
        }
      }
    }

    const orderResult = await createPaymentOrder(type, Number(amount), userId || null, pendingRegId || null);

    const proofResult = await submitPaymentProof(orderResult.orderId, screenshotUrl, {
      pendingRegId: orderResult.pendingRegId,
      userId: orderResult.userId,
      userEnteredUtr: utr || null,
    });

    const paymentId = proofResult.paymentId || orderResult.orderId;

    const statusMessage = proofResult.status === 'verified'
      ? 'Payment verified successfully'
      : proofResult.status === 'rejected'
        ? 'Payment verification failed'
        : 'Payment submitted for manual review';

    res.writeHead(200); res.end(JSON.stringify({
      status: proofResult.status,
      paymentId,
      autoVerified: proofResult.verificationStatus === 'verified' || proofResult.verificationStatus === 'rejected',
      message: statusMessage,
      verificationScore: proofResult.verificationScore,
      reasons: proofResult.reasons,
      ocrData: proofResult.ocrData,
      checks: proofResult.checks,
      fraudScore: proofResult.fraudScore,
      matchedAmount: proofResult.matchedAmount,
      matchedReceiver: proofResult.matchedReceiver,
      matchedUtr: proofResult.matchedUtr,
      matchedDate: proofResult.matchedDate,
      userUtrMatched: proofResult.userUtrMatched,
      userEnteredUtr: proofResult.userEnteredUtr,
    }));
  } catch (err) {
    const status = err.status || 500;
    console.error('[verifyUPIPayment] Error:', err.message);
    res.writeHead(status); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
