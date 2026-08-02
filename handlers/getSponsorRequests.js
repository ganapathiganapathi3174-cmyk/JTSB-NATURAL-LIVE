const { COL_USERS, COL_SPONSOR_TRANSFERS } = require('../api/_shared.js');
const { runQuery } = require('../api/_supabase.js');

module.exports = async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
    if (req.method !== 'POST') {
      res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return;
    }

    const { sponsorId } = req.body || {};

    if (!sponsorId) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'sponsorId is required' })); return;
    }

    const transfers = await runQuery(COL_SPONSOR_TRANSFERS, [
      { field: 'new_sponsor_id', op: 'EQUAL', value: sponsorId },
      { field: 'status', op: 'EQUAL', value: 'pending' },
    ], { orderBy: 'created_at', ascending: false, limit: 200 }) || [];

    if (transfers.length === 0) {
      res.writeHead(200); res.end(JSON.stringify({ success: true, requests: [] })); return;
    }

    const userIds = [...new Set(transfers.map(t => t.user_id))];

    const users = await runQuery(COL_USERS, [
      { field: 'id', op: 'IN', value: userIds },
    ], { limit: 200 }) || [];

    const userMap = {};
    for (const u of users) userMap[u.id] = u;

    const enriched = transfers.map(t => {
      const u = userMap[t.user_id] || {};
      return {
        id: t.id,
        userId: t.user_id,
        userName: u.name || 'Unknown',
        userEmail: u.email || '',
        userPhone: u.phone || '',
        userReferralCode: u.referral_code || '',
        userPlan: t.user_plan,
        oldSponsorId: t.old_sponsor_id,
        oldSponsorCode: t.old_sponsor_code,
        requestedAt: t.requested_at || t.created_at,
        status: t.status,
      };
    });

    res.writeHead(200); res.end(JSON.stringify({ success: true, requests: enriched }));
  } catch (err) {
    console.error('[SPONSOR-REQUESTS] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
