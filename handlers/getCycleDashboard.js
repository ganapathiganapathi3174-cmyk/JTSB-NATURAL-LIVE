const { getCycleDashboardData } = require('../api/_cycleEngine.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'GET') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }
  if (!req.admin) { res.writeHead(401); res.end(JSON.stringify({ error: 'Authentication required' })); return; }

  try {
    const data = await getCycleDashboardData();
    res.writeHead(200); res.end(JSON.stringify(data));
  } catch (err) {
    console.error('[getCycleDashboard] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
