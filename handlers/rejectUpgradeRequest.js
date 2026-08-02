const { COL_AUDIT_LOGS, COL_NOTIFICATIONS } = require('../api/_shared.js');
const { getDoc, addDoc, conditionalUpdateDoc } = require('../api/_supabase.js');
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
    const { upgradeId, reason } = req.body || {};
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
      status: 'rejected',
      rejection_reason: reason || 'No reason provided',
      admin_id: req.admin?.email || req.admin?.id || 'system',
      reviewed_at: new Date().toISOString(),
    });

    if (!updated) {
      res.writeHead(409);
      res.end(JSON.stringify({ error: 'Upgrade request was already processed' }));
      return;
    }

    if (request.user_id) {
      try {
        await addDoc(COL_NOTIFICATIONS, {
          user_id: request.user_id,
          receiverId: request.user_id,
          senderId: req.admin?.email || 'admin',
          senderName: 'Admin',
          title: 'Upgrade Request Rejected',
          message: `Your upgrade request to ₹${request.requested_plan} was rejected. Reason: ${reason || 'Not specified'}`,
          type: 'upgrade_rejected',
          status: 'unread',
          is_read: false,
        });
      } catch (e) { console.error('[rejectUpgradeRequest] Notification failed: ' + e.message); }
    }

    try {
      await addDoc(COL_AUDIT_LOGS, {
        action: 'upgrade_rejected',
        target_id: upgradeId,
        target_type: 'upgrade_request',
        admin_id: req.admin?.email || req.admin?.id || 'system',
        details: {
          user_id: request.user_id,
          user_name: request.user_name,
          from_plan: request.current_plan,
          to_plan: request.requested_plan,
          reason: reason || 'No reason provided',
        },
      });
    } catch (e) { console.error('[rejectUpgradeRequest] Audit log failed: ' + e.message); }

    broadcast('upgradeRequestUpdated', {
      id: upgradeId,
      status: 'rejected',
      userId: request.user_id,
    });

    console.log(`[REJECT-UPGRADE] Request ${upgradeId} rejected: ${request.user_name}`);

    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      message: 'Upgrade request rejected',
    }));
  } catch (err) {
    console.error('[rejectUpgradeRequest] Error:', err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
