const { reactivateUser } = require('../api/_cycleEngine.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }
  if (!req.admin) { res.writeHead(401); res.end(JSON.stringify({ error: 'Authentication required' })); return; }

  try {
    const { userId, reason } = req.body || {};
    if (!userId) { res.writeHead(400); res.end(JSON.stringify({ error: 'userId is required' })); return; }

    const result = await reactivateUser(userId, req.admin.email || 'admin', reason || 'Admin reactivation');
    res.writeHead(200); res.end(JSON.stringify(result));
  } catch (err) {
    console.error('[reactivateUser] Error:', err.message);
    if (err.message === 'User not found') { res.writeHead(404); res.end(JSON.stringify({ error: err.message })); return; }
    if (err.message === 'User is already active') { res.writeHead(400); res.end(JSON.stringify({ error: err.message })); return; }
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
