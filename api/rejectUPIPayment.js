const { COL_UPI_PAYMENTS } = require('./_shared.js');
const { runQuery, updateDoc } = require('./_supabase.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  try {
    const { paymentId, reason } = req.body || {};
    if (!paymentId) { res.writeHead(400); res.end(JSON.stringify({ error: 'Payment ID is required' })); return; }

    const payments = await runQuery(COL_UPI_PAYMENTS, [{ field: 'id', op: 'EQUAL', value: paymentId }]);
    if (!payments.length) { res.writeHead(404); res.end(JSON.stringify({ error: 'Payment record not found' })); return; }

    await updateDoc(COL_UPI_PAYMENTS, paymentId, { status: 'rejected', rejection_reasons: reason ? [reason] : [] });
    res.writeHead(200); res.end(JSON.stringify({ status: 'rejected' }));
  } catch (err) {
    res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
  }
};
