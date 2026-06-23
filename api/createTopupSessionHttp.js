const { randomString } = require('./_shared.js');
const { writeDoc } = require('./_supabase.js');

const COL_SESSIONS = 'payment_sessions';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  try {
    const { userId, amount } = req.body || {};
    if (!userId) { res.writeHead(400); res.end(JSON.stringify({ error: 'userId is required' })); return; }
    if (!amount || amount < 1) { res.writeHead(400); res.end(JSON.stringify({ error: 'Valid amount is required' })); return; }

    const sessionId = 'TOPUP-' + randomString(8);
    await writeDoc(COL_SESSIONS, sessionId, {
      sessionId, user_id: userId, type: 'topup', amount: Number(amount), status: 'created',
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
    res.writeHead(200); res.end(JSON.stringify({ sessionId, amount: Number(amount) }));
  } catch (err) {
    res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
  }
};
