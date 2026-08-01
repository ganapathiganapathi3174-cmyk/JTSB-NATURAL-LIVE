const { runQuery } = require('../api/_supabase.js');
const { COL_UPI_PAYMENTS, COL_PENDING_REGS } = require('../api/_shared.js');
const verifyQueue = require('../api/_verifyQueue.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();

  try {
    const [payments, registrations, verification] = await Promise.all([
      runQuery(COL_UPI_PAYMENTS, []),
      runQuery(COL_PENDING_REGS, []),
      verifyQueue.getBookkeeping(),
    ]);

    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();

    const queueStatus = {
      ocr_queue: (payments || []).filter(p => p.status === 'pending' && (!p.ocr_attempted || p.ocr_retries < 3)).length,
      retry_queue: (payments || []).filter(p => p.status === 'pending' && p.ocr_retries >= 3).length,
      manual_review: (payments || []).filter(p => p.status === 'manual_review').length,
      pending_verification: (payments || []).filter(p => p.status === 'pending' && p.screenshot_url).length,
      stuck_items: (payments || []).filter(p =>
        p.status === 'processing' &&
        new Date(p.updated_at || p.created_at) < fiveMinAgo
      ).length,
      pending_registrations: (registrations || []).filter(r => r.payment_status === 'pending' || !r.payment_status).length,
      total_payments: (payments || []).length,
      total_registrations: (registrations || []).length,
      verification: verification || {},
      timestamp: now.toISOString(),
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(queueStatus));
  } catch (err) {
    console.error('[QUEUE STATUS] Error:', err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
