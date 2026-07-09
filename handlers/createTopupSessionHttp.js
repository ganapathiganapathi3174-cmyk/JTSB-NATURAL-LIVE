const { randomString, COL_USERS, getReferrerPackage, validatePackageAmount } = require('../api/_shared.js');
const { writeDoc, getDoc } = require('../api/_supabase.js');

const COL_SESSIONS = 'payment_sessions';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  try {
    const { userId, amount } = req.body || {};
    if (!userId) { res.writeHead(400); res.end(JSON.stringify({ error: 'userId is required' })); return; }
    if (!amount || amount < 1) { res.writeHead(400); res.end(JSON.stringify({ error: 'Valid amount is required' })); return; }

    // Package validation for topup
    const user = await getDoc(COL_USERS, userId);
    if (user) {
      const userPkg = getReferrerPackage(user);
      if (userPkg && !validatePackageAmount(userPkg, amount)) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'Your \u20B9' + userPkg + ' package only accepts \u20B9' + userPkg + ' topup. Selected \u20B9' + amount + ' does not match.' })); return;
      }
    }

    const sessionId = 'TOPUP-' + randomString(8);
    await writeDoc(COL_SESSIONS, sessionId, {
      sessionId, user_id: userId, type: 'topup', amount: Number(amount), status: 'created',
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
    res.writeHead(200); res.end(JSON.stringify({ sessionId, amount: Number(amount) }));
  } catch (err) {
    console.error('[createTopupSessionHttp] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
