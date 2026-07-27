const { getPaymentOrder, submitPaymentProof } = require('../api/_paymentOrderManager.js');

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

    const order = await getPaymentOrder(orderId);
    if (!order) { res.writeHead(404); res.end(JSON.stringify({ error: 'Order not found' })); return; }

    // If still pending with a screenshot, trigger verification now (first poll wins)
    if (order.status === 'pending' && order.screenshot_url && !order.verification_status) {
      console.log('[getPaymentOrderStatus] Auto-triggering verification for ' + orderId);
      try {
        await submitPaymentProof(orderId, order.screenshot_url, { userEnteredUtr: order.utr || null, userEnteredUpi: null });
      } catch (e) {
        console.error('[getPaymentOrderStatus] Auto-verify failed for ' + orderId + ': ' + e.message);
      }
      // Re-fetch after verification attempt
      const updated = await getPaymentOrder(orderId);
      if (updated) Object.assign(order, updated);
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
