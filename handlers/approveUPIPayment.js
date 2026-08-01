const { getDoc, runQuery } = require('../api/_supabase.js');
const { approvePayment } = require('../api/_approvalPipeline.js');

const COL_UPI_PAYMENTS = 'upi_payments';

// Resolve an admin-supplied ID (UPI payment UUID, or ORD-* order id) to a
// upi_payments UUID.
async function resolvePaymentId(input) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)) return input;

  const orderRow = await getDoc('payment_sessions', input).catch(() => null);
  if (orderRow && orderRow.paymentId && /^[0-9a-f]{8}-/.test(orderRow.paymentId)) return orderRow.paymentId;
  if (orderRow) {
    const searchField = orderRow.pending_reg_id ? 'pending_reg_id' : 'user_id';
    const searchValue = orderRow.pending_reg_id || orderRow.user_id;
    if (searchValue) {
      const ups = await runQuery(COL_UPI_PAYMENTS, [
        { field: searchField, op: 'EQUAL', value: searchValue },
        { field: 'status', op: 'IN', value: ['pending', 'manual_review', 'pending_review'] },
      ], { limit: 1 });
      if (ups.length) return ups[0].id;
    }
  }
  return input;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }
  if (!req.admin) { res.writeHead(401); res.end(JSON.stringify({ error: 'Authentication required' })); return; }

  try {
    const { paymentId } = req.body || {};
    if (!paymentId) { res.writeHead(400); res.end(JSON.stringify({ error: 'Payment ID is required' })); return; }

    const resolved = await resolvePaymentId(paymentId);
    const result = await approvePayment(resolved, { adminEmail: req.admin?.email });

    if (!result || result.status === 'failed') {
      res.writeHead(404); res.end(JSON.stringify({ error: 'Payment record not found' })); return;
    }
    res.writeHead(200); res.end(JSON.stringify(result));
  } catch (err) {
    console.error('[approveUPIPayment] Error:', err.message);
    if (err.code === 'BAD_DATA') { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid registration data' })); return; }
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
