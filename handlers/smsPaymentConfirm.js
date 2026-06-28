const { processSmsAndApprove } = require('../api/_smsEngine.js');

const rateLimitStore = new Map();
const replayCache = new Map();

function log(msg) { console.log(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] [SMS-CONFIRM] ${msg}`); }

function verifyBearer(req) {
  const auth = req.headers['authorization'] || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return match[1];
}

function verifyTimestamp(req) {
  const ts = parseInt(req.headers['x-timestamp'], 10);
  if (!ts || isNaN(ts)) return { valid: false, error: 'Missing or invalid x-timestamp' };
  const now = Date.now();
  const diff = Math.abs(now - ts);
  if (diff > 300000) return { valid: false, error: 'Timestamp expired (max 5 min)' };
  return { valid: true };
}

function verifyNonce(req) {
  const nonce = req.headers['x-nonce'];
  if (!nonce) return { valid: false, error: 'Missing x-nonce (replay protection)' };
  if (replayCache.has(nonce)) return { valid: false, error: 'Nonce already used (replay detected)' };
  replayCache.set(nonce, Date.now());
  setTimeout(() => replayCache.delete(nonce), 600000);
  return { valid: true };
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const nowMs = Date.now();
    const rlEntry = rateLimitStore.get(ip) || { count: 0, resetAt: nowMs + 60000 };
    if (nowMs > rlEntry.resetAt) { rlEntry.count = 0; rlEntry.resetAt = nowMs + 60000; }
    rlEntry.count++;
    rateLimitStore.set(ip, rlEntry);
    if (rlEntry.count > 20) {
      res.writeHead(429); res.end(JSON.stringify({ error: 'Too many requests' }));
      return;
    }

    const bearerSecret = process.env.PAYMENT_CONFIRM_SECRET;
    if (bearerSecret) {
      const bearerToken = verifyBearer(req);
      if (!bearerToken || bearerToken !== bearerSecret) {
        log('Invalid bearer token from ' + ip);
        res.writeHead(401); res.end(JSON.stringify({ error: 'Invalid authorization' }));
        return;
      }
    }

    const apiSecret = process.env.SMS_PAYMENT_SECRET;
    if (apiSecret) {
      const provided = req.headers['x-api-secret'] || '';
      if (provided !== apiSecret) {
        log('Invalid API secret from ' + ip);
        res.writeHead(401); res.end(JSON.stringify({ error: 'Invalid API secret' }));
        return;
      }
    }

    const tsCheck = verifyTimestamp(req);
    if (!tsCheck.valid) {
      res.writeHead(400); res.end(JSON.stringify({ error: tsCheck.error }));
      return;
    }

    const nonceCheck = verifyNonce(req);
    if (!nonceCheck.valid) {
      res.writeHead(400); res.end(JSON.stringify({ error: nonceCheck.error }));
      return;
    }

    const { amount, reference, time, bank, smsBody } = req.body || {};
    if (!smsBody) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'smsBody is required' }));
      return;
    }

    const result = await processSmsAndApprove({ amount, reference, time, bank, smsBody });

    if (result.error && !result.matched) {
      res.writeHead(404); res.end(JSON.stringify(result));
      return;
    }

    res.writeHead(200); res.end(JSON.stringify(result));
  } catch (err) {
    console.error('[smsPaymentConfirm] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
