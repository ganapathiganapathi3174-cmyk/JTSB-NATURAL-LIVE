const { getPaymentOrder } = require('../api/_paymentOrderManager.js');

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
