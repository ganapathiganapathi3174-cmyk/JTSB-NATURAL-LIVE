const { createPaymentOrder } = require('../api/_paymentOrderManager.js');

module.exports = async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  } catch (setHeaderErr) {
    console.error('[CPO] setHeader failed:', setHeaderErr.message, setHeaderErr.stack);
    if (!res.headersSent) { res.writeHead(500); res.end(String(setHeaderErr.message || 'header error')); }
    return;
  }
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  try {
    const { type, amount, userId, pendingRegId } = req.body || {};
    const errors = [];
    if (!type || !['registration', 'topup'].includes(type)) errors.push('type must be registration or topup');
    if (!amount || amount < 1) errors.push('Valid amount is required');
    if (type === 'registration' && !pendingRegId) errors.push('pendingRegId is required for registration');
    if (type === 'topup' && !userId) errors.push('userId is required for topup');
    if (errors.length) { res.writeHead(400); res.end(JSON.stringify({ error: errors.join('. ') })); return; }

    console.log('[CPO] Calling createPaymentOrder with:', JSON.stringify({ type, amount, userId, pendingRegId }));
    const result = await createPaymentOrder(type, Number(amount), userId || null, pendingRegId || null);
    console.log('[CPO] createPaymentOrder succeeded:', JSON.stringify(result));
    res.writeHead(200); res.end(JSON.stringify(result));
  } catch (err) {
    const status = err.status || 500;
    console.error('[createPaymentOrder] Error:', err.message, err.stack || '');
    console.error('[createPaymentOrder] Body:', JSON.stringify(req.body));
    try {
      if (!res.headersSent) {
        res.writeHead(status, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: err.status && err.status < 500 ? err.message : 'Internal server error', _ref: 'CPO-' + Date.now() }));
    } catch (sendErr) {
      console.error('[CPO] Failed to send error response:', sendErr.message, sendErr.stack);
      try { res.end(String(err.message || 'error')); } catch (_) {}
    }
  }
};
