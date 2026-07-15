const { COL_ORDERS, COL_UPI_PAYMENTS } = require('../api/_shared.js');
const { runQuery } = require('../api/_supabase.js');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  try {
    const orders = await runQuery(COL_ORDERS, [
      { field: 'status', op: 'EQUAL', value: 'pending' },
    ], { limit: 50 });

    const result = { processed: 0, updated: 0, errors: [] };

    for (const order of orders || []) {
      result.processed++;
      if (!order.screenshot_url) {
        result.errors.push({ orderId: order.id, error: 'No screenshot' });
        continue;
      }
      result.errors.push({ orderId: order.id, error: 'Manual review required' });
    }

    res.writeHead(200); res.end(JSON.stringify(result));
  } catch (err) {
    console.error('[processPendingPayments] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
