const crypto = require('crypto');

const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function pruneLoginAttempts(email) {
  const attempts = loginAttempts.get(email);
  if (!attempts) return;
  const now = Date.now();
  const recent = attempts.filter(t => now - t < LOGIN_WINDOW_MS);
  if (recent.length === 0) loginAttempts.delete(email);
  else loginAttempts.set(email, recent);
}

function isLoginRateLimited(email) {
  pruneLoginAttempts(email);
  const attempts = loginAttempts.get(email);
  return attempts && attempts.length >= MAX_LOGIN_ATTEMPTS;
}

function recordLoginAttempt(email) {
  const attempts = loginAttempts.get(email) || [];
  attempts.push(Date.now());
  loginAttempts.set(email, attempts);
}

function normalizeRole(role) {
  if (!role) return 'admin';
  const normalized = role.toLowerCase().trim();
  if (normalized === 'administrator') return 'admin';
  return normalized;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') {
    res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Email and password required' }));
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();

    if (isLoginRateLimited(normalizedEmail)) {
      console.log(`[ADMIN LOGIN] Rate limited: ${normalizedEmail}`);
      res.writeHead(429); res.end(JSON.stringify({ error: 'Too many attempts. Try again later.' }));
      return;
    }

    let bcrypt;
    try { bcrypt = require('bcrypt'); } catch (e) { /* bcrypt optional */ }
    let signAdminToken, runQuery, COL_ADMINS, metrics;
    try {
      const auth = require('../api/_auth.js');
      signAdminToken = auth.signAdminToken;
    } catch (e) { console.error('[ADMIN LOGIN] _auth.js load failed:', e.message); }
    try {
      const supabase = require('../api/_supabase.js');
      runQuery = supabase.runQuery;
    } catch (e) { console.error('[ADMIN LOGIN] _supabase.js load failed:', e.message); }
    try {
      COL_ADMINS = require('../api/_shared.js').COL_ADMINS;
    } catch (e) { console.error('[ADMIN LOGIN] _shared.js load failed:', e.message); }
    try {
      metrics = require('../api/_metrics.js');
    } catch (e) { console.error('[ADMIN LOGIN] _metrics.js load failed:', e.message); }

    if (!signAdminToken) {
      res.writeHead(500); res.end(JSON.stringify({ error: 'Auth module unavailable' }));
      return;
    }

    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;
    if (adminEmail && adminPasswordHash) {
      const hash = crypto.createHash('sha256').update(password).digest('hex');
      if (normalizedEmail === adminEmail.toLowerCase() && hash === adminPasswordHash) {
        const role = 'admin';
        const token = signAdminToken({ email: normalizedEmail, role, name: 'Admin' });
        console.log(`[ADMIN LOGIN] Super admin login success: ${normalizedEmail}`);
        if (metrics) metrics.trackAuth(true);
        res.writeHead(200); res.end(JSON.stringify({
          token, expiresIn: 86400,
          admin: { email: normalizedEmail, role, name: 'Admin' },
        }));
        return;
      }
      console.log(`[ADMIN LOGIN] Env var admin password mismatch for: ${normalizedEmail}`);
    }

    if (!runQuery) {
      res.writeHead(500); res.end(JSON.stringify({ error: 'Database module unavailable' }));
      return;
    }

    console.log(`[ADMIN LOGIN] Looking up admin in DB: ${normalizedEmail}`);
    const admins = await runQuery(COL_ADMINS, [{ field: 'email', op: 'EQUAL', value: normalizedEmail }]);
    if (admins && admins.length > 0) {
      const admin = admins[0];
      let passwordMatch = false;
      if (admin.password_hash && admin.password_hash.startsWith('$2b$') && bcrypt) {
        passwordMatch = bcrypt.compareSync(password, admin.password_hash);
      } else {
        const hash = crypto.createHash('sha256').update(password).digest('hex');
        passwordMatch = (admin.password_hash === hash);
      }
      if (passwordMatch) {
        const role = normalizeRole(admin.role);
        const name = admin.name || 'Admin';
        const token = signAdminToken({ email: admin.email, role, name });
        console.log(`[ADMIN LOGIN] DB admin login success: ${admin.email} (role=${role})`);
        if (metrics) metrics.trackAuth(true);
        res.writeHead(200); res.end(JSON.stringify({
          token, expiresIn: 86400,
          admin: { email: admin.email, role, name },
        }));
        return;
      }
      console.log(`[ADMIN LOGIN] Password hash mismatch for DB admin: ${normalizedEmail}`);
    } else {
      console.log(`[ADMIN LOGIN] Admin not found in DB: ${normalizedEmail}`);
    }

    recordLoginAttempt(normalizedEmail);
    console.log(`[ADMIN LOGIN] Login failed for: ${normalizedEmail}`);
    if (metrics) metrics.trackAuth(false);
    res.writeHead(401); res.end(JSON.stringify({ error: 'Invalid credentials' }));
  } catch (err) {
    console.error(`[ADMIN LOGIN] Error: ${err.message}`);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
