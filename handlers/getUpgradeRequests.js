const { runQuery } = require('../api/_supabase.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();

  try {
    const { userId, status } = req.query || req.body || {};

    const filters = [];
    if (userId) filters.push({ field: 'user_id', op: 'EQUAL', value: userId });
    if (status) filters.push({ field: 'status', op: 'EQUAL', value: status });

    const requests = await runQuery('upgrade_requests', filters, {
      orderBy: 'created_at',
      orderDir: 'desc',
      limit: 100,
    });

    res.writeHead(200);
    res.end(JSON.stringify({ success: true, requests }));
  } catch (err) {
    console.error('[getUpgradeRequests] Error:', err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
