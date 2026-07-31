// Shared rate limiting utilities.
//
// Security: the origin NEVER trusts a client-supplied X-Forwarded-For header.
// The client IP is derived from the socket address, falling back only to
// platform-trusted headers that are set by a reverse proxy we control.
//
// - Vercel: `x-vercel-forwarded-for` is set by the platform edge, never the client.
// - Cloudflare: `cf-connecting-ip` is set by the CF proxy when present.
// - Otherwise: `req.socket.remoteAddress` is the direct peer.

function getClientIp(req) {
  const reqObj = req && req.req ? req.req : req;
  if (process.env.VERCEL && reqObj.headers && reqObj.headers['x-vercel-forwarded-for']) {
    const v = String(reqObj.headers['x-vercel-forwarded-for']);
    if (v) return v.split(',')[0].trim() || 'unknown';
  }
  if (process.env.CF_IP && reqObj.headers && reqObj.headers['cf-connecting-ip']) {
    const v = String(reqObj.headers['cf-connecting-ip']);
    if (v) return v.split(',')[0].trim() || 'unknown';
  }
  return (reqObj.socket && reqObj.socket.remoteAddress) || 'unknown';
}

function createRateLimiter({ windowMs = 60000, max = 60, onLimited } = {}) {
  const store = new Map();
  function limiter(req, res) {
    const ip = getClientIp(req);
    const now = Date.now();
    const entry = store.get(ip) || { count: 0, resetAt: now + windowMs };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
    entry.count++;
    store.set(ip, entry);
    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      if (onLimited) onLimited(ip);
      if (res) {
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfter),
        });
        res.end(JSON.stringify({ error: 'Too many requests. Try again in ' + retryAfter + 's.' }));
      }
      return true;
    }
    return false;
  }
  limiter.getClientIp = getClientIp;
  return limiter;
}

module.exports = { getClientIp, createRateLimiter };
