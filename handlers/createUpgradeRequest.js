const { COL_USERS, COL_NOTIFICATIONS } = require('../api/_shared.js');
const { getDoc, addDoc, runQuery } = require('../api/_supabase.js');
const { broadcast } = require('../api/_sse.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  try {
    const { userId, requestedPlan } = req.body || {};
    if (!userId || !requestedPlan) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing userId or requestedPlan' }));
      return;
    }

    const user = await getDoc(COL_USERS, userId);
    if (!user) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'User not found' }));
      return;
    }

    const currentPlan = parseInt(user.membership_type || user.membership_paid || 0, 10);
    const requestedAmount = parseInt(requestedPlan, 10);

    const validPlans = [120, 500, 1000];
    if (!validPlans.includes(requestedAmount)) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Invalid plan amount' }));
      return;
    }

    if (requestedAmount <= currentPlan) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Requested plan must be higher than current plan' }));
      return;
    }

    const existing = await runQuery('upgrade_requests', [
      { field: 'user_id', op: 'EQUAL', value: userId },
      { field: 'status', op: 'EQUAL', value: 'pending' },
    ], { limit: 1 });
    if (existing.length > 0) {
      res.writeHead(409);
      res.end(JSON.stringify({ error: 'You already have a pending upgrade request' }));
      return;
    }

    const upgradeData = {
      user_id: userId,
      user_name: user.name || 'Unknown',
      user_email: user.email || '',
      user_phone: user.phone || '',
      current_plan: String(currentPlan),
      requested_plan: String(requestedAmount),
      amount: requestedAmount,
      referral_code: user.referral_code || '',
      status: 'pending',
    };

    const doc = await addDoc('upgrade_requests', upgradeData);

    const admins = await runQuery('admins', [], { limit: 10 });
    for (const admin of admins) {
      try {
        await addDoc(COL_NOTIFICATIONS, {
          user_id: admin.id,
          receiverId: admin.id,
          senderId: userId,
          senderName: user.name || 'User',
          title: 'Membership Upgrade Request',
          message: `${user.name || 'A user'} (${user.email || userId}) requested upgrade from ₹${currentPlan} to ₹${requestedAmount}`,
          type: 'upgrade_request',
          status: 'unread',
          is_read: false,
        });
      } catch (_) {}
    }

    broadcast('upgradeRequestCreated', {
      id: doc.id || doc,
      userId,
      userName: user.name,
      currentPlan: String(currentPlan),
      requestedPlan: String(requestedAmount),
    });

    console.log(`[CREATE-UPGRADE] User ${userId} requested upgrade to ₹${requestedAmount}`);

    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      upgradeId: doc.id || doc,
      message: 'Upgrade request submitted for admin review',
    }));
  } catch (err) {
    console.error('[createUpgradeRequest] Error:', err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
