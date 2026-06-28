const { createSession } = require('../api/_smsEngine.js');

module.exports = async (req, res) => {
  try {
    const { paymentType, type, plan, amount, userId, pendingRegId, email } = req.body || {};
    if ((!paymentType && !type) || !amount) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'paymentType and amount are required' }));
      return;
    }
    const result = await createSession({ paymentType: paymentType || type, plan, amount, userId, pendingRegId, email });
    res.writeHead(200); res.end(JSON.stringify(result));
  } catch (err) {
    const status = err.status || 500;
    console.error('[createSmsSession] Error:', err.message);
    res.writeHead(status); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
