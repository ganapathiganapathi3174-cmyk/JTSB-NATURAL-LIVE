const { COL_USERS, COL_UPI_PAYMENTS, COL_SPONSOR_TRANSFERS, TEST_MODE, TEST_PAYMENT_AMOUNT } = require('../api/_shared.js');
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

    const body = [];
    for await (const chunk of req) body.push(chunk);
    const { userId } = JSON.parse(Buffer.concat(body).toString());

    if (!userId) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'userId is required' })); return;
    }

    const userPayments = await runQuery(COL_UPI_PAYMENTS, [
      { field: 'user_id', op: 'EQUAL', value: userId },
      { field: 'status', op: 'IN', value: ['verified', 'approved'] },
    ], { orderBy: 'created_at', ascending: false, limit: 1 });

    if (!userPayments || userPayments.length === 0) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'No completed payment found. Complete a payment first.' })); return;
    }

    const planAmount = Number(userPayments[0].amount);
    const allowedPlans = TEST_MODE ? [120, 500, 1000, TEST_PAYMENT_AMOUNT] : [120, 500, 1000];
    if (!allowedPlans.includes(planAmount)) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid plan amount: ' + planAmount })); return;
    }

    const allActiveUsers = await runQuery(COL_USERS, [
      { field: 'account_status', op: 'EQUAL', value: 'active' },
    ], { limit: 1000 }) || [];

    const activeUserIds = allActiveUsers.filter(u => u.id !== userId).map(u => u.id);
    if (activeUserIds.length === 0) {
      res.writeHead(200); res.end(JSON.stringify({ success: true, sponsors: [], plan: planAmount })); return;
    }

    const allVerifiedPayments = await runQuery(COL_UPI_PAYMENTS, [
      { field: 'user_id', op: 'IN', value: activeUserIds },
      { field: 'status', op: 'IN', value: ['verified', 'approved'] },
    ], { limit: 5000 }) || [];

    const userPlanMap = {};
    for (const p of allVerifiedPayments) {
      const pid = p.user_id;
      if (!userPlanMap[pid] || new Date(p.created_at) > new Date(userPlanMap[pid].created_at)) {
        userPlanMap[pid] = { amount: Number(p.amount), created_at: p.created_at, payment_type: p.payment_type };
      }
    }

    const existingRequests = await runQuery(COL_SPONSOR_TRANSFERS, [
      { field: 'user_id', op: 'EQUAL', value: userId },
      { field: 'status', op: 'EQUAL', value: 'pending' },
    ], { limit: 100 }) || [];

    const pendingTargetIds = new Set(existingRequests.map(r => r.new_sponsor_id));

    const sponsors = [];
    for (const sponsor of allActiveUsers) {
      if (sponsor.id === userId) continue;
      if (pendingTargetIds.has(sponsor.id)) continue;

      const planInfo = userPlanMap[sponsor.id];
      if (!planInfo) continue;
      if (planInfo.amount !== planAmount) continue;

      sponsors.push({
        id: sponsor.id,
        name: sponsor.name,
        referralCode: sponsor.referral_code,
        plan: planAmount,
        referralsCount: sponsor.referrals_count || 0,
        totalReferrals: sponsor.total_referral_count || 0,
        status: sponsor.account_status,
        joinedDate: sponsor.joined_date || sponsor.created_at,
        email: sponsor.email,
      });
    }

    res.writeHead(200); res.end(JSON.stringify({
      success: true,
      sponsors,
      plan: planAmount,
    }));
  } catch (err) {
    console.error('[SPONSOR-MARKETPLACE] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
