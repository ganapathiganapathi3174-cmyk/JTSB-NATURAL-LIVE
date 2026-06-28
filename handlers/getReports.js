const { runQuery } = require('../api/_supabase.js');
const { COL_USERS, COL_UPI_PAYMENTS, COL_PENDING_REGS, COL_WALLET_TX, COL_NOTIFICATIONS } = require('../api/_shared.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (!req.admin) { res.writeHead(401); res.end(JSON.stringify({ error: 'Authentication required' })); return; }

  try {
    const url = new URL(req.url, 'http://localhost');
    const period = url.searchParams.get('period') || 'daily';

    const now = new Date();
    let startDate;
    if (period === 'daily') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'weekly') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    } else if (period === 'monthly') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else {
      startDate = new Date(0);
    }

    const startIso = startDate.toISOString();

    const [users, payments, regs] = await Promise.all([
      runQuery(COL_USERS, [{ field: 'created_at', op: 'GTE', value: startIso }], { limit: 10000 }),
      runQuery(COL_UPI_PAYMENTS, [{ field: 'created_at', op: 'GTE', value: startIso }], { limit: 10000 }),
      runQuery(COL_PENDING_REGS, [{ field: 'created_at', op: 'GTE', value: startIso }], { limit: 10000 }),
    ]);

    const approvedPayments = (payments || []).filter(p => p.status === 'verified' || p.status === 'approved');
    const rejectedPayments = (payments || []).filter(p => p.status === 'rejected');
    const manualReviewPayments = (payments || []).filter(p => p.status === 'manual_review');

    let totalOcr = 0;
    let ocrSuccess = 0;
    for (const p of payments || []) {
      if (p.ocr_attempted) totalOcr++;
      if (p.ocr_result && p.ocr_result.confidence > 0) ocrSuccess++;
    }

    let fraudCount = 0;
    for (const p of rejectedPayments) {
      const reasons = p.rejection_reasons || [];
      if (reasons.some(r => r.toLowerCase().includes('fraud') || r.toLowerCase().includes('duplicate') || r.toLowerCase().includes('suspicious'))) {
        fraudCount++;
      }
    }

    const report = {
      period,
      generated_at: now.toISOString(),
      date_from: startIso,
      date_to: now.toISOString(),
      revenue: {
        total: approvedPayments.reduce((s, p) => s + (p.amount || 0), 0),
        count: approvedPayments.length,
        average: approvedPayments.length > 0
          ? Math.round(approvedPayments.reduce((s, p) => s + (p.amount || 0), 0) / approvedPayments.length)
          : 0,
      },
      registrations: {
        total: (users || []).length + (regs || []).length,
        approved: (users || []).length,
        pending: (regs || []).filter(r => r.payment_status === 'pending' || !r.payment_status).length,
      },
      payments: {
        total: (payments || []).length,
        approved: approvedPayments.length,
        rejected: rejectedPayments.length,
        manual_review: manualReviewPayments.length,
        approval_rate: (payments || []).length > 0
          ? Math.round((approvedPayments.length / (payments || []).length) * 10000) / 100
          : 0,
      },
      ocr: {
        attempted: totalOcr,
        success: ocrSuccess,
        accuracy: totalOcr > 0 ? Math.round((ocrSuccess / totalOcr) * 10000) / 100 : 0,
      },
      fraud_detected: fraudCount,
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(report));
  } catch (err) {
    console.error('[getReports] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
