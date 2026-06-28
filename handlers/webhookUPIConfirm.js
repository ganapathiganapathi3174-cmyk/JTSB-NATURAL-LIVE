const { processWebhook } = require('../api/_orderManager.js');

const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'dev-webhook-secret';

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  try {
    const signature = req.headers['x-webhook-signature'] || req.headers['x-razorpay-signature'] || '';
    const rawBody = JSON.stringify(req.body);
    const bodySecret = req.body?.secret || '';

    if (WEBHOOK_SECRET && WEBHOOK_SECRET !== 'dev-webhook-secret') {
      if (!signature && !bodySecret) {
        res.writeHead(401); res.end(JSON.stringify({ error: 'Missing webhook signature' }));
        return;
      }
    }

    const { order_id, transaction_ref, status } = req.body || {};
    if (!order_id || !transaction_ref || !status) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'order_id, transaction_ref, and status are required' }));
      return;
    }

    const result = await processWebhook(order_id, transaction_ref, status, signature, rawBody);

    res.writeHead(200);
    res.end(JSON.stringify({ success: true, ...result }));
  } catch (err) {
    const status = err.status || 500;
    console.error('[webhookUPIConfirm] Error:', err.message);
    res.writeHead(status);
    res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
  }
};
