const { retryPaymentOrder } = require('../api/_paymentOrderManager.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  try {
    const { orderId } = req.body || {};
    if (!orderId) { res.writeHead(400); res.end(JSON.stringify({ error: 'orderId is required' })); return; }

    const result = await retryPaymentOrder(orderId);
    res.writeHead(200); res.end(JSON.stringify(result));
  } catch (err) {
    const status = err.status || 500;
    console.error('[retryPaymentOrder] Error:', err.message);
    res.writeHead(status); res.end(JSON.stringify({ error: err.status && err.status < 500 ? err.message : 'Internal server error' }));
  }
};
