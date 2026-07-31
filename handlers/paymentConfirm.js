const { matchAndApprove } = require('../api/_paymentConfirm.js');
const { getClientIp } = require('../api/_rateLimit.js');
const { addDoc } = require('../api/_supabase.js');

const rateLimitStore = new Map();
const replayCache = new Map();

function verifyTimestamp(req) {
  const ts = parseInt(req.headers['x-timestamp'], 10);
  if (!ts || isNaN(ts)) return { valid: false, error: 'Missing or invalid x-timestamp' };
  const diff = Math.abs(Date.now() - ts);
  if (diff > 300000) return { valid: false, error: 'Timestamp expired (max 5 min)' };
  return { valid: true };
}

function verifyNonce(req) {
  const nonce = req.headers['x-nonce'];
  if (!nonce || nonce.length < 8) return { valid: false, error: 'Missing x-nonce (replay protection)' };
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

    const ip = getClientIp(req);
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

    // ⚠️ SECURITY: This endpoint auto-approves payments. It is a server-to-server
    // webhook only and MUST be protected by a shared secret. Fail-closed: if the
    // secret is not configured, the endpoint refuses to serve.
    const secret = process.env.PAYMENT_CONFIRM_SECRET;
    if (!secret) {
      res.writeHead(503); res.end(JSON.stringify({ error: 'paymentConfirm not configured (PAYMENT_CONFIRM_SECRET missing)' }));
      return;
    }
    const provided = req.headers['x-payment-secret'] || '';
    if (provided !== secret) {
      res.writeHead(401); res.end(JSON.stringify({ error: 'Invalid secret' }));
      return;
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

    try {
      await addDoc('audit_logs', {
        action: 'payment_confirm_webhook',
        target_id: transactionReference,
        target_type: 'payment_confirmation',
        admin_id: 'system',
        details: { amount, ip, matched: !!result.matched },
        created_at: new Date().toISOString(),
      });
    } catch (auditErr) { console.error('[paymentConfirm] audit log failed:', auditErr.message); }

    res.writeHead(200); res.end(JSON.stringify(result));
  } catch (err) {
    console.error('[paymentConfirm] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
