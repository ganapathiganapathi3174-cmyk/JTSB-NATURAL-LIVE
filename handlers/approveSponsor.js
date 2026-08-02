const { COL_USERS, COL_SPONSOR_CLAIMS } = require('../api/_shared.js');
const { runQuery, updateDoc, addDoc, atomicCreditWallet } = require('../api/_supabase.js');
const { broadcast } = require('../api/_sse.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }
  if (!req.admin) { res.writeHead(401); res.end(JSON.stringify({ error: 'Authentication required' })); return; }

  try {
    const { userId, claimId } = req.body || {};
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

    const users = await runQuery(COL_USERS, [{ field: 'id', op: 'EQUAL', value: claim.sponsor_id }], { limit: 1 });
    if (!users.length) { res.writeHead(404); res.end(JSON.stringify({ error: 'Sponsor user not found' })); return; }
    const user = users[0];
    const now = new Date().toISOString();

    // Update claim status to approved
    await updateDoc(COL_SPONSOR_CLAIMS, claim.id, {
      status: 'approved',
      approved_at: now,
      approved_by: req.admin?.email || 'unknown',
    });

    // Credit wallet with the claim amount (atomic to prevent duplicates)
    const claimAmount = Number(claim.claim_amount || 0);
    if (claimAmount > 0) {
      await atomicCreditWallet(claim.sponsor_id, claimAmount, claim.id, 'Sponsor bonus claim approved by admin', 'sponsor_bonus');
    }

    // Reactivate account
    // Keep existing referral data intact: referrals_count, total_referral_count, referral_code
    await updateDoc(COL_USERS, claim.sponsor_id, {
      account_status: 'active',
      inactive_reason: null,
      sponsor_awaiting_credit: false,
      sponsor_topup_completed: false,
      sponsor_credited: true,
      sponsor_credited_amount: claimAmount,
      sponsor_credited_at: now,
      sponsor_credited_by: req.admin?.email || 'unknown',
      activated_at: now,
      activated_by: req.admin?.email || 'unknown',
      activation_reason: 'Admin approved sponsor claim',
    });

    // Audit log
    try {
      await addDoc('audit_logs', {
        action: 'approve_sponsor_claim',
        target_id: claim.id,
        target_type: 'sponsor_claim',
        admin_id: req.admin?.email || 'unknown',
        details: {
          sponsorId: claim.sponsor_id,
          sponsorName: user.name,
          referralCode: user.referral_code,
          claimAmount: claimAmount,
          itemsCount: claim.items_count,
          items: claim.items,
        },
        created_at: now,
      });
    } catch (e) { console.error('[approveSponsor] Audit log failed: ' + e.message); }

    // Notification to sponsor
    try {
      await addDoc('notifications', {
        receiverId: claim.sponsor_id,
        title: 'Sponsor Claim Approved',
        message: claimAmount > 0
          ? `Your sponsor claim of ₹${claimAmount.toFixed(2)} has been approved and credited to your wallet. Your account is now active.`
          : 'Your sponsor claim has been approved. Your account is now active.',
        type: 'sponsor_claim_approved',
        status: 'unread',
        createdAt: now,
        senderId: 'system',
        senderName: 'System',
      });
    } catch (e) { console.error('[approveSponsor] Notification failed: ' + e.message); }

    try { broadcast('sponsorClaimApproved', { sponsorId: claim.sponsor_id, claimId: claim.id, amount: claimAmount }); } catch (e) { console.error('[approveSponsor] Broadcast failed: ' + e.message); }

    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'approved',
      userId: claim.sponsor_id,
      claimId: claim.id,
      claimAmount: claimAmount,
      message: 'Sponsor claim approved. Wallet credited and account reactivated.',
    }));
  } catch (err) {
    console.error('[approveSponsor] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
