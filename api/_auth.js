const crypto = require('crypto');

// In-memory JWT blacklist (keyed by jti)
const tokenBlacklist = new Set();

function blacklistToken(jti) {
  if (jti) tokenBlacklist.add(jti);
}

function isTokenBlacklisted(jti) {
  return tokenBlacklist.has(jti);
}

function getSecret() {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (secret && secret.length >= 16) return secret;
  // FAIL CLOSED: never sign tokens with a well-known constant. Any deployment
  // without a strong ADMIN_JWT_SECRET gets a null secret, which makes
  // signAdminToken throw and verifyAdminToken reject every token.
  console.error('[AUTH] FATAL: ADMIN_JWT_SECRET is not configured or too short (min 16 chars). Authentication is disabled.');
  return null;
}

function signAdminToken(payload) {
  const secret = getSecret();
  if (!secret) throw new Error('ADMIN_JWT_SECRET not configured');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const expiry = parseInt(process.env.ADMIN_JWT_EXPIRY || '86400', 10);
  const body = Buffer.from(JSON.stringify({
    ...payload,
    iat: now,
    exp: now + expiry,
    jti: crypto.randomBytes(8).toString('hex'),
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(header + '.' + body).digest('base64url');
  return header + '.' + body + '.' + signature;
}

function verifyAdminToken(token) {
  try {
    const secret = getSecret();
    if (!secret) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const expectedSig = crypto.createHmac('sha256', secret).update(parts[0] + '.' + parts[1]).digest('base64url');
    if (parts[2] !== expectedSig) return null;
    const body = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (body.exp && Math.floor(Date.now() / 1000) > body.exp) return null;
    if (body.jti && isTokenBlacklisted(body.jti)) return null;
    return body;
  } catch { return null; }
}

function signRefreshToken(payload) {
  const secret = getSecret();
  if (!secret) throw new Error('ADMIN_JWT_SECRET not configured');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({
    ...payload,
    purpose: 'refresh',
    iat: now,
    exp: now + 604800,
    jti: crypto.randomBytes(8).toString('hex'),
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(header + '.' + body).digest('base64url');
  return header + '.' + body + '.' + signature;
}

function verifyRefreshToken(token) {
  try {
    const secret = getSecret();
    if (!secret) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const expectedSig = crypto.createHmac('sha256', secret).update(parts[0] + '.' + parts[1]).digest('base64url');
    if (parts[2] !== expectedSig) return null;
    const body = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (body.purpose !== 'refresh') return null;
    if (body.exp && Math.floor(Date.now() / 1000) > body.exp) return null;
    if (body.jti && isTokenBlacklisted(body.jti)) return null;
    return body;
  } catch { return null; }
}

function rotateToken(token) {
  const payload = verifyAdminToken(token);
  if (!payload) return null;
  if (payload.jti) blacklistToken(payload.jti);
  const { iat, exp, jti, ...cleanPayload } = payload;
  return signAdminToken(cleanPayload);
}

function requireAdmin(handler) {
  return async (req, res) => {
    const authHeader = req.headers?.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Authentication required' }));
      return;
    }
    const payload = verifyAdminToken(token);
    if (!payload) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid or expired admin session' }));
      return;
    }
    req.admin = payload;
    req.token = token;
    req.jti = payload.jti;
    return handler(req, res);
  };
}

module.exports = { signAdminToken, verifyAdminToken, requireAdmin, blacklistToken, isTokenBlacklisted, signRefreshToken, verifyRefreshToken, rotateToken };
