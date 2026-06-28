const { getOrderStatus, createUPIOrder, ORDER_STATUS, pendingOrders } = require('../api/_orderManager.js');
const { updateDoc } = require('../api/_supabase.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  try {
    const { orderId } = req.body || {};
    if (!orderId) { res.writeHead(400); res.end(JSON.stringify({ error: 'orderId is required' })); return; }

    const order = await getOrderStatus(orderId);
    if (!order) { res.writeHead(404); res.end(JSON.stringify({ error: 'Order not found' })); return; }

    if (order.status !== ORDER_STATUS.EXPIRED && order.status !== ORDER_STATUS.FAILED && order.status !== ORDER_STATUS.CANCELLED) {
      res.writeHead(200); res.end(JSON.stringify({ orderId, status: order.status, message: 'Order is still active, no retry needed' }));
      return;
    }

    const newOrder = await createUPIOrder(order.type, order.amount, order.userId || null, order.pendingRegId || null);

    try { await updateDoc('payment_sessions', orderId, { status: ORDER_STATUS.CANCELLED.toLowerCase() }).catch(() => {}); } catch {}
    const mem = pendingOrders.get(orderId);
    if (mem) { mem.status = ORDER_STATUS.CANCELLED; pendingOrders.set(orderId, mem); }

    res.writeHead(200);
    res.end(JSON.stringify({ previousOrderId: orderId, ...newOrder }));
  } catch (err) {
    console.error('[retryUPIOrder] Error:', err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
