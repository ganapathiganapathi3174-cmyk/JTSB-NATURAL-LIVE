const health = require('../api/_health.js');
const queue = require('../api/_queue.js');
const metrics = require('../api/_metrics.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();

  try {
    const healthStatus = health.getHealthStatus();
    const queueStatus = await queue.getQueueStatus();

    // Run fresh checks if requested
    if (req.method === 'POST' && req.body?.refresh) {
      await health.runAllChecks();
    }

    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      timestamp: new Date().toISOString(),
      health: healthStatus,
      queue: queueStatus,
      metrics: metrics.getMetrics(),
    }));
  } catch (err) {
    console.error('[getHealthStatus] Error:', err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
