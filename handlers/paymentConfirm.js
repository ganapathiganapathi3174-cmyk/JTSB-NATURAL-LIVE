const { matchAndApprove } = require('../api/_paymentConfirm.js');

const rateLimitStore = new Map();

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const windowMs = 60000;
    const maxReqs = 20;
    const entry = rateLimitStore.get(ip) || { count: 0, resetAt: now + windowMs };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
    entry.count++;
    rateLimitStore.set(ip, entry);
    if (entry.count > maxReqs) {
      res.writeHead(429); res.end(JSON.stringify({ error: 'Too many requests' }));
      return;
    }

    const secret = process.env.PAYMENT_CONFIRM_SECRET;
    if (secret) {
      const provided = req.headers['x-payment-secret'] || '';
      if (provided !== secret) {
        res.writeHead(401); res.end(JSON.stringify({ error: 'Invalid secret' }));
        return;
      }
    }

    const { amount, transactionReference, transactionTime } = req.body || {};
    if (!amount || !transactionReference) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'amount and transactionReference are required' }));
      return;
    }

    const result = await matchAndApprove({ amount, transactionReference, transactionTime });

    if (result.error && !result.matched) {
      res.writeHead(404); res.end(JSON.stringify(result));
      return;
    }

    res.writeHead(200); res.end(JSON.stringify(result));
  } catch (err) {
    console.error('[paymentConfirm] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
