const { submitPaymentProof } = require('../api/_paymentOrderManager.js');

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

    // ⚠️ SECURITY: A client-typed UTR is NEVER enough to approve a payment.
    // A screenshot is required and verification runs server-side through the
    // V7 engine (OCR + business rules + fraud + duplicate checks).
    if (!screenshotUrl) {
      sendJSON(400, { error: 'Payment screenshot is required for verification' });
      return;
    }

    log('Verifying order=' + orderId + ' utr=' + cleanUtr);

    const result = await submitPaymentProof(orderId, screenshotUrl, {
      userEnteredUtr: cleanUtr,
    });

    const status = result.status || 'manual_review';
    log('Decision: ' + orderId + ' -> ' + status);

    sendJSON(200, {
      orderId,
      status,
      verificationStatus: result.verificationStatus || status,
      verificationScore: result.verificationScore,
      autoVerified: status === 'verified',
      reasons: result.reasons || [],
      checks: result.checks || [],
      utr: cleanUtr,
      message: status === 'verified'
        ? 'Payment verified successfully!'
        : status === 'rejected'
          ? 'Payment verification failed'
          : 'Payment submitted for manual review',
    });
  } catch (err) {
    log('Error: ' + err.message);
    sendJSON(err.status || 500, { error: 'Internal server error' });
  }
};
