const { COL_UPI_PAYMENTS } = require('../api/_shared.js');
const { runQuery, conditionalUpdateDoc, addDoc } = require('../api/_supabase.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  if (!req.admin) { res.writeHead(401); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
  try {
    const { paymentId } = req.body || {};
    if (!paymentId) { res.writeHead(400); res.end(JSON.stringify({ error: 'Payment ID is required' })); return; }

    // ATOMIC: Only restore if currently rejected or manual_review
    const claimed = await conditionalUpdateDoc(COL_UPI_PAYMENTS, paymentId, [
      { field: 'status', op: 'IN', value: ['rejected', 'manual_review', 'failed'] },
    ], { status: 'pending', rejection_reasons: [], verified_at: new Date().toISOString() });

    if (claimed === 0) {
      const existing = await runQuery(COL_UPI_PAYMENTS, [{ field: 'id', op: 'EQUAL', value: paymentId }]);
      if (existing && existing.length) {
        res.writeHead(200); res.end(JSON.stringify({ status: existing[0].status, idempotent: true }));
        return;
      }
      res.writeHead(404); res.end(JSON.stringify({ error: 'Payment not found' })); return;
    }

    // Audit log
    try { await addDoc('audit_logs', { action: 'restore_payment', target_id: paymentId, target_type: 'upi_payment', admin_id: req.admin?.email || 'unknown', details: {}, created_at: new Date().toISOString() }); } catch (e) { console.error('[restoreUPIPayment] Audit log failed: ' + e.message); }

    res.writeHead(200); res.end(JSON.stringify({ status: 'restored' }));
  } catch (err) {
    console.error('[restoreUPIPayment] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
