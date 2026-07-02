const { getCompanionStatus } = require('../api/_companionAuth.js');
const { runQuery } = require('../api/_supabase.js');

module.exports = async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
    if (req.method !== 'POST' && req.method !== 'GET') {
      res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return;
    }

    const device = getCompanionStatus();

    const pendingCount = await runQuery('upi_payments', [
      { field: 'status', op: 'EQUAL', value: 'pending' },
    ], { limit: 1 }).then(function (r) { return r && r.length ? 1 : 0; }).catch(function () { return 0; });

    const reviews = await runQuery('upi_payments', [
      { field: 'status', op: 'EQUAL', value: 'manual_review' },
    ], { limit: 1 }).then(function (r) { return r && r.length ? 1 : 0; }).catch(function () { return 0; });

    res.writeHead(200); res.end(JSON.stringify({
      success: true,
      companion: {
        connected: device.connected,
        deviceName: device.deviceName,
        lastSyncAt: device.lastSyncAt,
        paymentsReceived: device.paymentsReceived,
        errors: device.errors,
        lastError: device.lastError,
      },
      queue: {
        pendingPayments: pendingCount,
        manualReviews: reviews,
      },
      configured: !!(process.env.COMPANION_API_KEY),
    }));
  } catch (err) {
    console.error('[getCompanionStatus] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
