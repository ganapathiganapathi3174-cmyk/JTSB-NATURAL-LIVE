const { COL_USERS } = require('../api/_shared.js');
const { getDoc, runQuery } = require('../api/_supabase.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();

  try {
    const { userId } = req.query || req.body || {};
    if (!userId) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing userId' }));
      return;
    }

    const user = await getDoc(COL_USERS, userId);
    if (!user) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'User not found' }));
      return;
    }

    const currentPlan = parseInt(user.membership_type || user.membership_paid || '0', 10);
    const availablePlans = [120, 500, 1000].filter(p => p > currentPlan);

    const pendingRequest = await runQuery('upgrade_requests', [
      { field: 'user_id', op: 'EQUAL', value: userId },
      { field: 'status', op: 'EQUAL', value: 'pending' },
    ], { limit: 1 });

    const previousRequests = await runQuery('upgrade_requests', [
      { field: 'user_id', op: 'EQUAL', value: userId },
    ], { orderBy: 'created_at', orderDir: 'desc', limit: 10 });

    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      currentPlan: String(currentPlan),
      availablePlans,
      canUpgrade: availablePlans.length > 0,
      hasPendingRequest: pendingRequest.length > 0,
      pendingRequest: pendingRequest[0] || null,
      previousRequests,
    }));
  } catch (err) {
    console.error('[getUserUpgradeStatus] Error:', err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
