const { COL_USERS, COL_SPONSOR_TRANSFERS } = require('../api/_shared.js');
const { runQuery } = require('../api/_supabase.js');

module.exports = async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    const queryStatus = req.query?.status || null;
    const queryUserId = req.query?.userId || null;
    const querySearch = req.query?.search || null;

    const statusFilter = queryStatus || (req.method === 'POST' ? null : null);

    let filters = [];
    if (statusFilter && ['pending', 'approved', 'rejected'].includes(statusFilter)) {
      filters.push({ field: 'status', op: 'EQUAL', value: statusFilter });
    }
    if (queryUserId) {
      filters.push({ field: 'user_id', op: 'EQUAL', value: queryUserId });
    }

    let transfers = [];
    try {
      if (filters.length > 0) {
        transfers = await runQuery(COL_SPONSOR_TRANSFERS, filters, { orderBy: 'created_at', ascending: false, limit: 500 }) || [];
      } else {
        transfers = await runQuery(COL_SPONSOR_TRANSFERS, [], { orderBy: 'created_at', ascending: false, limit: 500 }) || [];
      }
    } catch (queryErr) {
      console.error('[ADMIN-SPONSOR-TRANSFERS] Query failed (table may not exist):', queryErr.message);
    }

    if (transfers.length === 0) {
      res.writeHead(200); res.end(JSON.stringify({ success: true, transfers: [], total: 0 })); return;
    }

    const allUserIds = [...new Set(
      transfers.map(t => t.user_id).concat(
        transfers.map(t => t.new_sponsor_id).concat(
          transfers.map(t => t.old_sponsor_id).filter(Boolean)
        )
      )
    )];

    const allUsers = await runQuery(COL_USERS, [
      { field: 'id', op: 'IN', value: allUserIds },
    ], { limit: 500 }) || [];

    const userMap = {};
    for (const u of allUsers) userMap[u.id] = u;

    let enriched = transfers.map(t => {
      const u = userMap[t.user_id] || {};
      const oldSponsor = userMap[t.old_sponsor_id] || {};
      const newSponsor = userMap[t.new_sponsor_id] || {};

      return {
        id: t.id,
        userId: t.user_id,
        userName: u.name || 'Unknown',
        userEmail: u.email || '',
        userReferralCode: u.referral_code || '',
        oldSponsorId: t.old_sponsor_id,
        oldSponsorName: oldSponsor.name || 'Unknown',
        oldSponsorCode: t.old_sponsor_code,
        newSponsorId: t.new_sponsor_id,
        newSponsorName: newSponsor.name || 'Unknown',
        newSponsorCode: t.new_sponsor_code,
        plan: t.user_plan,
        status: t.status,
        requestedAt: t.requested_at || t.created_at,
        respondedAt: t.responded_at,
        rejectionReason: t.rejection_reason,
        createdAt: t.created_at,
      };
    });

    if (querySearch) {
      const s = querySearch.toLowerCase();
      enriched = enriched.filter(t =>
        (t.userName && t.userName.toLowerCase().includes(s)) ||
        (t.userEmail && t.userEmail.toLowerCase().includes(s)) ||
        (t.newSponsorName && t.newSponsorName.toLowerCase().includes(s)) ||
        (t.oldSponsorName && t.oldSponsorName.toLowerCase().includes(s))
      );
    }

    const counts = { pending: 0, approved: 0, rejected: 0 };
    for (const t of enriched) {
      if (counts[t.status] !== undefined) counts[t.status]++;
    }

    res.writeHead(200); res.end(JSON.stringify({
      success: true,
      transfers: enriched,
      total: enriched.length,
      counts,
    }));
  } catch (err) {
    console.error('[ADMIN-SPONSOR-TRANSFERS] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
