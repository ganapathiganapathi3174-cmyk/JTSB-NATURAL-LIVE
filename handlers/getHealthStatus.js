const health = require('../_health.js');
const queue = require('../_queue.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
    }));
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
};
