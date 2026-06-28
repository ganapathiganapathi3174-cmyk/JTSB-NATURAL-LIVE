const { runQuery, conditionalUpdateDoc } = require('../api/_supabase.js');
const { COL_UPI_PAYMENTS } = require('../api/_shared.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') {
    res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }
  if (!req.admin) { res.writeHead(401); res.end(JSON.stringify({ error: 'Authentication required' })); return; }

  try {
    const { paymentId } = req.body || {};
    if (!paymentId) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'paymentId required' }));
      return;
    }

    const result = await conditionalUpdateDoc(
      COL_UPI_PAYMENTS, paymentId,
      [{ field: 'id', op: 'EQUAL', value: paymentId }],
      {
        verification_result: null,
        final_score: null,
        matched_amount: null,
        matched_utr: null,
        matched_receiver: null,
        matched_date: null,
        fraud_checks: null,
        status: 'pending',
        updated_at: new Date().toISOString(),
      }
    );

    if (result && result.length > 0) {
      res.writeHead(200); res.end(JSON.stringify({ success: true, message: 'Verification re-queued' }));
    } else {
      res.writeHead(404); res.end(JSON.stringify({ error: 'Payment not found' }));
    }
  } catch (err) {
    console.error('[RERUN VERIFICATION] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
