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

    const { userId } = req.body || {};

    if (!userId) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'userId is required' })); return;
    }

    const userDoc = await runQuery(COL_USERS, [
      { field: 'id', op: 'EQUAL', value: userId },
    ], { limit: 1 });

    if (!userDoc || userDoc.length === 0) {
      res.writeHead(404); res.end(JSON.stringify({ error: 'User not found' })); return;
    }

    const user = userDoc[0];
    let currentSponsor = null;
    if (user.referred_by) {
      const sponsorDocs = await runQuery(COL_USERS, [
        { field: 'referral_code', op: 'EQUAL', value: user.referred_by },
      ], { limit: 1 });
      if (sponsorDocs && sponsorDocs.length > 0) {
        currentSponsor = {
          id: sponsorDocs[0].id,
          name: sponsorDocs[0].name,
          email: sponsorDocs[0].email,
          referralCode: sponsorDocs[0].referral_code,
          plan: null,
        };
      }
    }

    const transferHistory = await runQuery(COL_SPONSOR_TRANSFERS, [
      { field: 'user_id', op: 'EQUAL', value: userId },
    ], { orderBy: 'created_at', ascending: false, limit: 50 }) || [];

    const enrichedHistory = [];
    if (transferHistory.length > 0) {
      const allSponsorIds = [...new Set(transferHistory.map(t => t.new_sponsor_id).concat(
        transferHistory.map(t => t.old_sponsor_id).filter(Boolean)
      ))];
      const allSponsors = await runQuery(COL_USERS, [
        { field: 'id', op: 'IN', value: allSponsorIds },
      ], { limit: 100 }) || [];
      const sponsorMap = {};
      for (const s of allSponsors) sponsorMap[s.id] = s;

      for (const t of transferHistory) {
        enrichedHistory.push({
          id: t.id,
          oldSponsorName: t.old_sponsor_id ? (sponsorMap[t.old_sponsor_id]?.name || 'Unknown') : null,
          oldSponsorCode: t.old_sponsor_code,
          newSponsorName: sponsorMap[t.new_sponsor_id]?.name || 'Unknown',
          newSponsorCode: t.new_sponsor_code,
          plan: t.user_plan,
          status: t.status,
          requestedAt: t.requested_at || t.created_at,
          respondedAt: t.responded_at,
          rejectionReason: t.rejection_reason,
        });
      }
    }

    res.writeHead(200); res.end(JSON.stringify({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        referralCode: user.referral_code,
        referredBy: user.referred_by,
        accountStatus: user.account_status,
      },
      currentSponsor,
      transferHistory: enrichedHistory,
    }));
  } catch (err) {
    console.error('[USER-SPONSOR-INFO] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
