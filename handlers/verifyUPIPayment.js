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

    const orderResult = await createPaymentOrder(type, Number(amount), userId || null, pendingRegId || null);

    const proofResult = await submitPaymentProof(orderResult.orderId, screenshotUrl);

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
    }));
  } catch (err) {
    const status = err.status || 500;
    console.error('[verifyUPIPayment] Error:', err.message);
    res.writeHead(status); res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
  }
};
