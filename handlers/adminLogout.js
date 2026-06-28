const { blacklistToken, verifyAdminToken } = require('../api/_auth.js');

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
    const authHeader = req.headers?.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (token) {
      const payload = verifyAdminToken(token);
      if (payload && payload.jti) {
        blacklistToken(payload.jti);
      }
    }

    res.writeHead(200);
    res.end(JSON.stringify({ success: true, message: 'Logged out' }));
  } catch (err) {
    console.error('[adminLogout] Error:', err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
