const { addClient, broadcast } = require('../api/_sse.js');
const { runQuery } = require('../api/_supabase.js');
const { COL_PENDING_REGS, COL_UPI_PAYMENTS } = require('../api/_shared.js');
const { verifyAdminToken } = require('../api/_auth.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();

  const token = (req.url || '').split('token=')[1]?.split('&')[0] || req.headers['authorization']?.replace('Bearer ', '') || '';
  if (!token || !verifyAdminToken(token)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Authentication required' }));
    return;
  }

  const client = addClient(req, res);

  // Send initial state
  try {
    const [pendingReg, pendingPayments] = await Promise.all([
      runQuery(COL_PENDING_REGS, [{ field: 'payment_status', op: 'EQUAL', value: 'pending' }]),
      runQuery(COL_UPI_PAYMENTS, [{ field: 'status', op: 'EQUAL', value: 'pending' }]),
    ]);

    client.res.write(`event: initialState\ndata: ${JSON.stringify({
      pending_registrations: (pendingReg || []).length,
      pending_payments: (pendingPayments || []).length,
      timestamp: new Date().toISOString(),
    })}\n\n`);
  } catch (err) {
    console.error('[SSE] Initial state error:', err.message);
  }
};
