const { getPaymentOrder, submitPaymentProof } = require('../api/_paymentOrderManager.js');

function log(msg) {
  console.log('[' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '] [ORDER-STATUS] ' + msg);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();

  try {
    let orderId;
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      orderId = url.searchParams.get('orderId');
    } else {
      orderId = req.body?.orderId;
    }
    if (!orderId) { res.writeHead(400); res.end(JSON.stringify({ error: 'orderId is required' })); return; }

    let order = await getPaymentOrder(orderId);
    if (!order) { res.writeHead(404); res.end(JSON.stringify({ error: 'Order not found' })); return; }

    // If a screenshot was submitted but verification hasn't run yet, run it NOW,
    // synchronously inside this poll request. This is the ONLY place verification
    // is guaranteed to complete on serverless: fire-and-forget work launched after
    // a previous response gets killed before it can update the database.
    const needsVerification =
      (order.status === 'pending' || order.status === 'expired') &&
      !!order.screenshot_url &&
      (!order.verification_status || order.verification_status === 'pending');

    if (needsVerification) {
      log('order=' + orderId + ' has screenshot but no verification — verifying synchronously');
      const t0 = Date.now();
      try {
        await submitPaymentProof(orderId, order.screenshot_url, {
          userEnteredUtr: order.utr || null,
          userEnteredUpi: order.upi_id || null,
        });
      } catch (e) {
        // 409 = verification already in progress by a concurrent poll — fine, re-read status.
        if (e.status !== 409) console.error('[getPaymentOrderStatus] verify failed for ' + orderId + ': ' + e.message);
      }
      log('order=' + orderId + ' verification attempt took ' + (Date.now() - t0) + 'ms');
      order = await getPaymentOrder(orderId);
      if (!order) { res.writeHead(404); res.end(JSON.stringify({ error: 'Order not found' })); return; }
    }

    res.writeHead(200); res.end(JSON.stringify({
      orderId: order.id,
      type: order.type,
      amount: Number(order.amount),
      status: order.status,
      verificationStatus: order.verification_status,
      verificationScore: order.verification_score,
      screenshotUrl: order.screenshot_url,
      createdAt: order.created_at,
      expiresAt: order.expires_at,
      rejectionReasons: order.rejection_reasons,
    }));
  } catch (err) {
    console.error('[getPaymentOrderStatus] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
