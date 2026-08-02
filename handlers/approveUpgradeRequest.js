const { COL_USERS, COL_AUDIT_LOGS, COL_NOTIFICATIONS } = require('../api/_shared.js');
const { getDoc, updateDoc, addDoc, conditionalUpdateDoc, runQuery } = require('../api/_supabase.js');
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
    const { upgradeId } = req.body || {};
    if (!upgradeId) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing upgradeId' }));
      return;
    }

    const request = await getDoc('upgrade_requests', upgradeId);
    if (!request) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Upgrade request not found' }));
      return;
    }

    if (request.status !== 'pending') {
      res.writeHead(409);
      res.end(JSON.stringify({ error: `Upgrade request already ${request.status}` }));
      return;
    }

    const updated = await conditionalUpdateDoc('upgrade_requests', upgradeId, [
      { field: 'status', op: 'EQUAL', value: 'pending' },
    ], {
      status: 'approved',
      admin_id: req.admin?.email || req.admin?.id || 'system',
      reviewed_at: new Date().toISOString(),
    });

    if (!updated) {
      res.writeHead(409);
      res.end(JSON.stringify({ error: 'Upgrade request was already processed' }));
      return;
    }

    const user = await getDoc(COL_USERS, request.user_id);
    if (user) {
      await updateDoc(COL_USERS, request.user_id, {
        membership_type: request.requested_plan,
        membership_paid: parseFloat(request.requested_plan),
      });
    }

    if (user && user.id) {
      try {
        await addDoc(COL_NOTIFICATIONS, {
          user_id: user.id,
          receiverId: user.id,
          senderId: req.admin?.email || 'admin',
          senderName: 'Admin',
          title: 'Membership Upgraded',
          message: `Your membership has been upgraded to ₹${request.requested_plan} plan`,
          type: 'upgrade_approved',
          status: 'unread',
          is_read: false,
        });
      } catch (e) { console.error('[approveUpgradeRequest] Notification failed: ' + e.message); }
    }

    try {
      await addDoc(COL_AUDIT_LOGS, {
        action: 'upgrade_approved',
        target_id: upgradeId,
        target_type: 'upgrade_request',
        admin_id: req.admin?.email || req.admin?.id || 'system',
        details: {
          user_id: request.user_id,
          user_name: request.user_name,
          from_plan: request.current_plan,
          to_plan: request.requested_plan,
          amount: request.amount,
        },
      });
    } catch (e) { console.error('[approveUpgradeRequest] Audit log failed: ' + e.message); }

    broadcast('upgradeRequestUpdated', {
      id: upgradeId,
      status: 'approved',
      userId: request.user_id,
      fromPlan: request.current_plan,
      toPlan: request.requested_plan,
    });

    console.log(`[APPROVE-UPGRADE] Request ${upgradeId} approved: ${request.user_name} -> ₹${request.requested_plan}`);

    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      message: 'Upgrade request approved',
      user: { id: request.user_id, name: request.user_name },
      fromPlan: request.current_plan,
      toPlan: request.requested_plan,
    }));
  } catch (err) {
    console.error('[approveUpgradeRequest] Error:', err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
