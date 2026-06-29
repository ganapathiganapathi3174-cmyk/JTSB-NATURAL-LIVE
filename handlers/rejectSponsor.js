const { COL_USERS, COL_SPONSOR_CLAIMS, COL_TOPUP_INCOME } = require('../api/_shared.js');
const { runQuery, updateDoc, addDoc, getDoc } = require('../api/_supabase.js');
const { broadcast } = require('../api/_sse.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }
  if (!req.admin) { res.writeHead(401); res.end(JSON.stringify({ error: 'Authentication required' })); return; }

  try {
    const { userId, claimId, reason } = req.body || {};
    if (!userId && !claimId) { res.writeHead(400); res.end(JSON.stringify({ error: 'userId or claimId is required' })); return; }

    let claim;
    if (claimId) {
      const claims = await runQuery(COL_SPONSOR_CLAIMS, [{ field: 'id', op: 'EQUAL', value: claimId }], { limit: 1 });
      if (!claims.length) { res.writeHead(404); res.end(JSON.stringify({ error: 'Claim not found' })); return; }
      claim = claims[0];
    } else {
      const claims = await runQuery(COL_SPONSOR_CLAIMS, [
        { field: 'sponsor_id', op: 'EQUAL', value: userId },
        { field: 'status', op: 'EQUAL', value: 'pending' },
      ], { limit: 1 });
      if (!claims.length) { res.writeHead(404); res.end(JSON.stringify({ error: 'No pending claim found for this user' })); return; }
      claim = claims[0];
    }

    const now = new Date().toISOString();

    // Update claim status to rejected
    await updateDoc(COL_SPONSOR_CLAIMS, claim.id, {
      status: 'rejected',
      rejected_at: now,
      rejected_by: req.admin?.email || 'unknown',
      rejection_reason: reason || 'Rejected by admin',
    });

    // Restore income records back to eligible
    const items = claim.items || [];
    for (const item of items) {
      if (item.income_id) {
        await updateDoc(COL_TOPUP_INCOME, item.income_id, { status: 'eligible' });
      }
    }

    // Reactivate the sponsor account
    await updateDoc(COL_USERS, claim.sponsor_id, {
      account_status: 'active',
      inactive_reason: null,
      sponsor_awaiting_credit: false,
    });

    // Audit log
    try {
      await addDoc('audit_logs', {
        action: 'reject_sponsor_claim',
        target_id: claim.id,
        target_type: 'sponsor_claim',
        admin_id: req.admin?.email || 'unknown',
        details: {
          sponsorId: claim.sponsor_id,
          claimAmount: claim.claim_amount,
          itemsCount: claim.items_count,
          rejectionReason: reason || 'No reason provided',
        },
        created_at: now,
      });
    } catch {}

    // Notification to sponsor
    try {
      await addDoc('notifications', {
        receiverId: claim.sponsor_id,
        title: 'Sponsor Claim Rejected',
        message: reason
          ? `Your sponsor claim of ₹${Number(claim.claim_amount || 0).toFixed(2)} was rejected. Reason: ${reason}`
          : `Your sponsor claim of ₹${Number(claim.claim_amount || 0).toFixed(2)} was rejected by admin.`,
        type: 'sponsor_claim_rejected',
        status: 'unread',
        createdAt: now,
        senderId: 'system',
        senderName: 'System',
      });
    } catch {}

    try { broadcast('sponsorClaimRejected', { sponsorId: claim.sponsor_id, claimId: claim.id }); } catch {}

    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'rejected',
      claimId: claim.id,
      message: 'Sponsor claim rejected. Account reactivated.',
    }));
  } catch (err) {
    console.error('[rejectSponsor] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
