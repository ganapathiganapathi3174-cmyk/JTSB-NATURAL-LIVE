const { COL_UPI_PAYMENTS } = require('../api/_shared.js');
const { runQuery, conditionalUpdateDoc, addDoc } = require('../api/_supabase.js');
const { broadcast } = require('../api/_sse.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }
  if (!req.admin) { res.writeHead(401); res.end(JSON.stringify({ error: 'Authentication required' })); return; }

  try {
    const { paymentId, reason } = req.body || {};
    if (!paymentId) { res.writeHead(400); res.end(JSON.stringify({ error: 'Payment ID is required' })); return; }

    // ATOMIC: Only reject if currently processable
    const claimed = await conditionalUpdateDoc(COL_UPI_PAYMENTS, paymentId, [
      { field: 'status', op: 'IN', value: ['pending', 'manual_review', 'pending_review', 'verifying'] },
    ], { status: 'rejected', rejection_reasons: reason ? [reason] : [], verified_at: new Date().toISOString() });

    if (claimed === 0) {
      const existing = await runQuery(COL_UPI_PAYMENTS, [{ field: 'id', op: 'EQUAL', value: paymentId }]);
      if (existing && existing.length) {
        res.writeHead(200); res.end(JSON.stringify({ status: existing[0].status, idempotent: true }));
        return;
      }
      res.writeHead(404); res.end(JSON.stringify({ error: 'Payment not found' })); return;
    }

    const payment = await runQuery(COL_UPI_PAYMENTS, [{ field: 'id', op: 'EQUAL', value: paymentId }]).then(r => r.length ? r[0] : null);

    // Audit log
    try { await addDoc('audit_logs', { action: 'reject_payment', target_id: paymentId, target_type: 'upi_payment', admin_id: req.admin?.email || 'unknown', details: { reason, user_id: payment?.user_id }, created_at: new Date().toISOString() }); } catch (e) { console.error('[rejectUPIPayment] Audit log failed: ' + e.message); }

    try {
      if (payment?.user_id) {
        await addDoc('notifications', {
          receiverId: payment.user_id,
          title: 'Payment Rejected',
          message: 'Your payment was rejected' + (reason ? ': ' + reason : ''),
          type: 'payment_rejected', status: 'unread', createdAt: new Date().toISOString(),
          senderId: 'system', senderName: 'System',
        });
      }
    } catch (e) { console.error('[rejectUPIPayment] Notification failed: ' + e.message); }

    try { broadcast('paymentUpdated', { id: paymentId, status: 'rejected', reason }); } catch (e) { console.error('[rejectUPIPayment] Broadcast failed: ' + e.message); }
    res.writeHead(200); res.end(JSON.stringify({ status: 'rejected' }));
  } catch (err) {
    console.error('[rejectUPIPayment] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
