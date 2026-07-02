const { COL_USERS, COL_SPONSOR_TRANSFERS, COL_NOTIFICATIONS, COL_REFERRALS, MAX_REFERRALS } = require('../api/_shared.js');
const { runQuery, updateDoc, addDoc } = require('../api/_supabase.js');

module.exports = async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
    if (req.method !== 'POST') {
      res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return;
    }

    const body = [];
    for await (const chunk of req) body.push(chunk);
    const { requestId, action, rejectionReason } = JSON.parse(Buffer.concat(body).toString());

    if (!requestId || !action) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'requestId and action (accept/reject) are required' })); return;
    }

    if (action !== 'accept' && action !== 'reject') {
      res.writeHead(400); res.end(JSON.stringify({ error: 'action must be "accept" or "reject"' })); return;
    }

    const transfers = await runQuery(COL_SPONSOR_TRANSFERS, [
      { field: 'id', op: 'EQUAL', value: requestId },
    ], { limit: 1 });

    if (!transfers || transfers.length === 0) {
      res.writeHead(404); res.end(JSON.stringify({ error: 'Transfer request not found' })); return;
    }

    const transfer = transfers[0];

    if (transfer.status !== 'pending') {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Transfer request is already ' + transfer.status })); return;
    }

    const now = new Date().toISOString();

    if (action === 'reject') {
      await updateDoc(COL_SPONSOR_TRANSFERS, requestId, {
        status: 'rejected',
        responded_at: now,
        rejection_reason: rejectionReason || 'Declined by sponsor',
        updated_at: now,
      });

      try {
        await addDoc(COL_NOTIFICATIONS, {
          receiverId: transfer.user_id,
          title: 'Sponsor Transfer Rejected',
          message: 'Your sponsor transfer request has been declined.',
          type: 'sponsor_transfer_rejected',
          status: 'unread',
          senderId: transfer.new_sponsor_id,
          senderName: 'Sponsor',
          createdAt: now,
        });
      } catch (e) { console.error('[SPONSOR-TRANSFER-HANDLE] Notification error:', e.message); }

      try {
        await addDoc('audit_logs', {
          action: 'reject_sponsor_transfer',
          target_id: requestId,
          target_type: 'sponsor_transfer',
          admin_id: 'system',
          details: {
            userId: transfer.user_id,
            newSponsorId: transfer.new_sponsor_id,
            reason: rejectionReason || 'Declined by sponsor',
          },
          created_at: now,
        });
      } catch (e) { console.error('[SPONSOR-TRANSFER-HANDLE] Audit log error:', e.message); }

      res.writeHead(200); res.end(JSON.stringify({ success: true, status: 'rejected' })); return;
    }

    const userDoc = await runQuery(COL_USERS, [
      { field: 'id', op: 'EQUAL', value: transfer.user_id },
    ], { limit: 1 });

    if (!userDoc || userDoc.length === 0) {
      res.writeHead(404); res.end(JSON.stringify({ error: 'User not found' })); return;
    }

    const newSponsorDoc = await runQuery(COL_USERS, [
      { field: 'id', op: 'EQUAL', value: transfer.new_sponsor_id },
    ], { limit: 1 });

    if (!newSponsorDoc || newSponsorDoc.length === 0) {
      res.writeHead(404); res.end(JSON.stringify({ error: 'New sponsor not found' })); return;
    }

    const user = userDoc[0];
    const newSponsor = newSponsorDoc[0];

    let oldSponsorDoc = null;
    let oldSponsorId = null;
    if (transfer.old_sponsor_id) {
      const oldDocs = await runQuery(COL_USERS, [
        { field: 'id', op: 'EQUAL', value: transfer.old_sponsor_id },
      ], { limit: 1 });
      if (oldDocs && oldDocs.length > 0) {
        oldSponsorDoc = oldDocs[0];
        oldSponsorId = oldSponsorDoc.id;
      }
    }

    const oldReferralsCount = oldSponsorDoc ? (oldSponsorDoc.referrals_count || 0) : 0;
    const newReferralsCount = newSponsor.referrals_count || 0;

    if (oldSponsorDoc) {
      const newOldCount = Math.max(0, oldReferralsCount - 1);
      const oldLimitReached = newOldCount >= MAX_REFERRALS;
      const oldUpdates = {
        referrals_count: newOldCount,
        total_referral_count: Math.max(0, (oldSponsorDoc.total_referral_count || 0) - 1),
        referral_limit_reached: oldLimitReached,
        referral_active: !oldLimitReached,
        is_qualified: oldLimitReached,
        updated_at: now,
      };

      if (oldSponsorDoc.account_status === 'inactive' &&
          oldSponsorDoc.inactive_reason === 'Referral Limit Reached (2 Successful Referrals)') {
        oldUpdates.account_status = 'active';
        oldUpdates.inactive_reason = null;
      }

      await updateDoc(COL_USERS, oldSponsorId, oldUpdates);
    }

    const newNewCount = newReferralsCount + 1;
    const newLimitReached = newNewCount >= MAX_REFERRALS;
    const newSponsorUpdates = {
      referrals_count: newNewCount,
      total_referral_count: (newSponsor.total_referral_count || 0) + 1,
      referral_limit_reached: newLimitReached,
      referral_active: !newLimitReached,
      is_qualified: newLimitReached,
      updated_at: now,
    };

    if (newLimitReached) {
      newSponsorUpdates.account_status = 'inactive';
      newSponsorUpdates.inactive_reason = 'Referral Limit Reached (2 Successful Referrals)';
    }

    await updateDoc(COL_USERS, newSponsor.id, newSponsorUpdates);

    await updateDoc(COL_USERS, transfer.user_id, {
      referred_by: transfer.new_sponsor_code,
      referred_by_status: 'approved',
      updated_at: now,
    });

    await updateDoc(COL_SPONSOR_TRANSFERS, requestId, {
      status: 'approved',
      responded_at: now,
      old_sponsor_id: oldSponsorId,
      updated_at: now,
    });

    try {
      await addDoc(COL_NOTIFICATIONS, {
        receiverId: transfer.user_id,
        title: 'Sponsor Transfer Approved',
        message: 'Your sponsor transfer to ' + newSponsor.name + ' has been approved.',
        type: 'sponsor_transfer_approved',
        status: 'unread',
        senderId: newSponsor.id,
        senderName: newSponsor.name || 'Sponsor',
        createdAt: now,
      });
    } catch (e) { console.error('[SPONSOR-TRANSFER-HANDLE] Notification error:', e.message); }

    if (oldSponsorId) {
      try {
        await addDoc(COL_NOTIFICATIONS, {
          receiverId: oldSponsorId,
          title: 'Sponsor Transfer Completed',
          message: user.name + ' has been transferred to ' + newSponsor.name + '. Transfer date: ' + now.split('T')[0],
          type: 'sponsor_transferred_away',
          status: 'unread',
          senderId: 'system',
          senderName: 'System',
          createdAt: now,
        });
      } catch (e) { console.error('[SPONSOR-TRANSFER-HANDLE] Notification error:', e.message); }
    }

    try {
      await addDoc('audit_logs', {
        action: 'approve_sponsor_transfer',
        target_id: requestId,
        target_type: 'sponsor_transfer',
        admin_id: 'system',
        details: {
          userId: transfer.user_id,
          userName: user.name,
          userEmail: user.email,
          oldSponsorId: oldSponsorId,
          oldSponsorCode: transfer.old_sponsor_code,
          oldSponsorName: oldSponsorDoc ? oldSponsorDoc.name : null,
          newSponsorId: newSponsor.id,
          newSponsorCode: newSponsor.referral_code,
          newSponsorName: newSponsor.name,
          plan: transfer.user_plan,
          transferDate: now,
          oldSponsorReferralsCount: oldReferralsCount,
          newSponsorReferralsCount: newReferralsCount,
        },
        created_at: now,
      });
    } catch (e) { console.error('[SPONSOR-TRANSFER-HANDLE] Audit log error:', e.message); }

    res.writeHead(200); res.end(JSON.stringify({
      success: true,
      status: 'approved',
      transfer: {
        id: requestId,
        userId: transfer.user_id,
        oldSponsorId: oldSponsorId,
        oldSponsorName: oldSponsorDoc ? oldSponsorDoc.name : null,
        newSponsorId: newSponsor.id,
        newSponsorName: newSponsor.name,
        plan: transfer.user_plan,
        approvedAt: now,
      },
    }));
  } catch (err) {
    console.error('[SPONSOR-TRANSFER-HANDLE] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
