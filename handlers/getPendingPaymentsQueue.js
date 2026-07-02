const { COL_UPI_PAYMENTS, COL_USERS } = require('../api/_shared.js');
const { runQuery } = require('../api/_supabase.js');
const { checkAndExpirePendingPayments, PENDING_TIMEOUT_MINUTES } = require('../api/_upiPaymentMonitor.js');

module.exports = async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    await checkAndExpirePendingPayments();

    const allPayments = await runQuery(COL_UPI_PAYMENTS, [], {
      orderBy: 'created_at',
      ascending: false,
      limit: 200,
    }) || [];

    if (allPayments.length === 0) {
      res.writeHead(200); res.end(JSON.stringify({
        success: true,
        payments: [],
        stats: { pending: 0, expired: 0, verified: 0, rejected: 0 },
        timeoutMinutes: PENDING_TIMEOUT_MINUTES,
      })); return;
    }

    const userIds = [...new Set(allPayments.map(p => p.user_id).filter(Boolean))];
    const userMap = {};

    if (userIds.length > 0) {
      const users = await runQuery(COL_USERS, [
        { field: 'id', op: 'IN', value: userIds },
      ], { limit: 200 }) || [];
      for (const u of users) userMap[u.id] = u;
    }

    const now = Date.now();
    const payments = allPayments.map(p => {
      const createdTime = p.created_at ? new Date(p.created_at).getTime() : 0;
      const elapsedMin = createdTime ? ((now - createdTime) / 60000).toFixed(1) : '0';
      const remainingMin = createdTime ? Math.max(0, PENDING_TIMEOUT_MINUTES - parseFloat(elapsedMin)).toFixed(1) : '0';
      const isExpired = p.status === 'expired' || (p.status === 'pending' && createdTime && (now - createdTime) >= PENDING_TIMEOUT_MINUTES * 60000);

      const user = userMap[p.user_id] || {};

      return {
        id: p.id,
        userId: p.user_id,
        userName: user.name || 'Unknown',
        userEmail: user.email || '',
        userReferralCode: user.referral_code || '',
        userReferredBy: user.referred_by || '',
        type: p.payment_type || 'unknown',
        amount: p.amount,
        utr: p.utr || '',
        status: isExpired && p.status === 'pending' ? 'expired' : p.status,
        createdAt: p.created_at,
        elapsedMinutes: parseFloat(elapsedMin),
        remainingMinutes: parseFloat(remainingMin),
        verifiedAt: p.verified_at,
        rejectionReasons: p.rejection_reasons,
        screenshotUrl: p.screenshot_url,
      };
    });

    const stats = { pending: 0, expired: 0, verified: 0, rejected: 0, manual_review: 0 };
    for (const p of payments) {
      if (stats[p.status] !== undefined) stats[p.status]++;
      else if (p.status === 'verified') stats.verified++;
    }

    res.writeHead(200); res.end(JSON.stringify({
      success: true,
      payments,
      stats,
      timeoutMinutes: PENDING_TIMEOUT_MINUTES,
    }));
  } catch (err) {
    console.error('[GET-PENDING-PAYMENTS] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
