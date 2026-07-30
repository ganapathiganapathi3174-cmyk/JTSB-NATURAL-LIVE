const crypto = require('crypto');
let bcrypt;
try { bcrypt = require('bcrypt'); } catch (e) { console.warn('[ADMIN LOGIN] bcrypt not available, falling back to SHA-256'); }
const { signAdminToken } = require('../api/_auth.js');
const { runQuery } = require('../api/_supabase.js');
const { COL_ADMINS } = require('../api/_shared.js');
const metrics = require('../api/_metrics.js');

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
  const tStart = Date.now();
  const steps = [];
  function mark(name) { steps.push({ name, ms: Date.now() - tStart }); }

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
    mark('parse_body');

    if (isLoginRateLimited(normalizedEmail)) {
      console.log('[ADMIN LOGIN] Rate limited: ' + normalizedEmail);
      res.writeHead(429); res.end(JSON.stringify({ error: 'Too many attempts. Try again later.' }));
      return;
    }
    mark('rate_limit');

    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;
    if (adminEmail && adminPasswordHash) {
      const hash = crypto.createHash('sha256').update(password).digest('hex');
      if (normalizedEmail === adminEmail.toLowerCase() && hash === adminPasswordHash) {
        const role = 'admin';
        const token = signAdminToken({ email: normalizedEmail, role, name: 'Admin' });
        mark('jwt_sign');
        console.log('[ADMIN LOGIN] Super admin login success: ' + normalizedEmail + ' | timing: ' + JSON.stringify(steps));
        metrics.trackAuth(true);
        res.writeHead(200); res.end(JSON.stringify({
          token, expiresIn: 86400,
          admin: { email: normalizedEmail, role, name: 'Admin' },
        }));
        return;
      }
      console.log('[ADMIN LOGIN] Env var admin password mismatch for: ' + normalizedEmail);
    }
    mark('env_var_check');

    // Built-in default admin (jayaraj@gmail.com / jayaraj7523)
    // This avoids the DB query on cold start, preventing Vercel 504
    const DEFAULT_ADMIN_EMAIL = 'jayaraj@gmail.com';
    const DEFAULT_ADMIN_HASH = 'bc21f55e8275b8274e8e704fe2de13a43a46f70cc602e6888ec52893ab790b13';
    if (normalizedEmail === DEFAULT_ADMIN_EMAIL) {
      const hash = crypto.createHash('sha256').update(password).digest('hex');
      if (hash === DEFAULT_ADMIN_HASH) {
        const role = 'admin';
        const token = signAdminToken({ email: normalizedEmail, role, name: 'Admin' });
        mark('jwt_sign');
        console.log('[ADMIN LOGIN] Default admin login success: ' + normalizedEmail + ' | timing: ' + JSON.stringify(steps));
        metrics.trackAuth(true);
        res.writeHead(200); res.end(JSON.stringify({
          token, expiresIn: 86400,
          admin: { email: normalizedEmail, role, name: 'Admin' },
        }));
        return;
      }
      console.log('[ADMIN LOGIN] Default admin password mismatch for: ' + normalizedEmail);
    }
    mark('default_admin_check');

    console.log('[ADMIN LOGIN] Looking up admin in DB: ' + normalizedEmail);
    const admins = await runQuery(COL_ADMINS, [{ field: 'email', op: 'EQUAL', value: normalizedEmail }]);
    mark('db_query');
    if (admins && admins.length > 0) {
      const admin = admins[0];
      let passwordMatch = false;
      if (admin.password_hash && admin.password_hash.startsWith('$2b$') && bcrypt) {
        passwordMatch = bcrypt.compareSync(password, admin.password_hash);
      } else {
        const hash = crypto.createHash('sha256').update(password).digest('hex');
        passwordMatch = (admin.password_hash === hash);
      }
      mark('password_verify');
      if (passwordMatch) {
        const role = normalizeRole(admin.role);
        const name = admin.name || 'Admin';
        const token = signAdminToken({ email: admin.email, role, name });
        mark('jwt_sign');
        console.log('[ADMIN LOGIN] DB admin login success: ' + admin.email + ' (role=' + role + ') | timing: ' + JSON.stringify(steps));
        metrics.trackAuth(true);
        res.writeHead(200); res.end(JSON.stringify({
          token, expiresIn: 86400,
          admin: { email: admin.email, role, name },
        }));
        return;
      }
      console.log('[ADMIN LOGIN] Password hash mismatch for DB admin: ' + normalizedEmail);
    } else {
      console.log('[ADMIN LOGIN] Admin not found in DB: ' + normalizedEmail);
    }

    recordLoginAttempt(normalizedEmail);
    console.log('[ADMIN LOGIN] Login failed for: ' + normalizedEmail + ' | timing: ' + JSON.stringify(steps));
    metrics.trackAuth(false);
    res.writeHead(401); res.end(JSON.stringify({ error: 'Invalid credentials' }));
  } catch (err) {
    console.error('[ADMIN LOGIN] Error: ' + err.message + ' | timing: ' + JSON.stringify(steps));
    if (err.stack) console.error('[ADMIN LOGIN] Stack: ' + err.stack);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
