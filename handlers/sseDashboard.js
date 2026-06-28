const { addClient, broadcast } = require('../api/_sse.js');
const { runQuery } = require('../api/_supabase.js');
const { COL_PENDING_REGS, COL_UPI_PAYMENTS } = require('../api/_shared.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();

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
