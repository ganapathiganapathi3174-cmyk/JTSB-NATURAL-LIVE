const { createSession } = require('../api/_paymentConfirm.js');

module.exports = async (req, res) => {
  try {
    const { type, plan, amount, pendingRegId, userId, email } = req.body || {};

    if (!type || !amount) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'type and amount are required' }));
      return;
    }

    const result = await createSession({ type, plan, amount, pendingRegId, userId, email });

    res.writeHead(200); res.end(JSON.stringify(result));
  } catch (err) {
    const status = err.status || 500;
    console.error('[createPaymentSession] Error:', err.message);
    res.writeHead(status); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
