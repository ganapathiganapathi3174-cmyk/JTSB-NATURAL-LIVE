const { getUserCycleData } = require('../api/_cycleEngine.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();

  try {
    const url = new URL(req.url, 'http://localhost');
    const userId = url.searchParams.get('userId');
    if (!userId) { res.writeHead(400); res.end(JSON.stringify({ error: 'userId is required' })); return; }

    const data = await getUserCycleData(userId);
    if (!data) { res.writeHead(404); res.end(JSON.stringify({ error: 'User not found' })); return; }
    res.writeHead(200); res.end(JSON.stringify(data));
  } catch (err) {
    console.error('[getUserCycleData] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
