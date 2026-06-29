const { COL_USERS, COL_SPONSOR_CLAIMS, COL_TOPUP_INCOME } = require('../api/_shared.js');
const { runQuery, addDoc, updateDoc, getDoc } = require('../api/_supabase.js');
const { broadcast } = require('../api/_sse.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  try {
    const { userId } = req.body || {};
    if (!userId) { res.writeHead(400); res.end(JSON.stringify({ error: 'userId is required' })); return; }

    const users = await runQuery(COL_USERS, [{ field: 'id', op: 'EQUAL', value: userId }], { limit: 1 });
    if (!users.length) { res.writeHead(404); res.end(JSON.stringify({ error: 'User not found' })); return; }

    const user = users[0];
    if (user.account_status !== 'active') {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Account must be active to claim sponsor bonus' })); return;
    }

    // Find all eligible income records for this sponsor
    const eligibleIncome = await runQuery(COL_TOPUP_INCOME, [
      { field: 'user_id', op: 'EQUAL', value: userId },
      { field: 'status', op: 'EQUAL', value: 'eligible' },
    ], { limit: 100 });

    if (!eligibleIncome.length) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'No eligible income to claim. Referred users must complete topups first.' })); return;
    }

    // Check if there's already a pending claim
    const existingClaims = await runQuery(COL_SPONSOR_CLAIMS, [
      { field: 'sponsor_id', op: 'EQUAL', value: userId },
      { field: 'status', op: 'EQUAL', value: 'pending' },
    ], { limit: 1 });
    if (existingClaims.length) {
      res.writeHead(409); res.end(JSON.stringify({ error: 'A claim is already pending admin approval', claimId: existingClaims[0].id })); return;
    }

    // Build items snapshot with all required fields
    const now = new Date().toISOString();
    const items = [];
    let totalAmount = 0;
    for (const inc of eligibleIncome) {
      const referredUser = inc.from_user_id ? await getDoc(COL_USERS, inc.from_user_id).catch(() => null) : null;
      const topupRecord = inc.topup_id ? await getDoc('topups', inc.topup_id).catch(() => null) : null;
      items.push({
        income_id: inc.id,
        referred_user_id: inc.from_user_id || null,
        referred_user_name: referredUser?.name || inc.fromUserName || 'Unknown',
        topup_id: inc.topup_id || null,
        topup_amount: Number(inc.amount || 0),
        transaction_id: topupRecord?.utr || topupRecord?.transactionId || null,
        payment_method: 'UPI',
        payment_status: topupRecord?.status || 'approved',
        topup_date: topupRecord?.created_at || inc.createdAt || inc.created_at || now,
      });
      totalAmount += Number(inc.amount || 0);
    }

    const claimData = {
      sponsor_id: userId,
      claim_amount: totalAmount,
      items_count: items.length,
      items: items,
      status: 'pending',
      claim_date: now,
    };

    const claim = await addDoc(COL_SPONSOR_CLAIMS, claimData);
    if (!claim || !claim.id) {
      res.writeHead(500); res.end(JSON.stringify({ error: 'Failed to create claim record' })); return;
    }

    // Mark all eligible income as claimed
    for (const inc of eligibleIncome) {
      await updateDoc(COL_TOPUP_INCOME, inc.id, { status: 'sponsor_claim_pending', claimedAt: now });
    }

    // Set sponsor account to inactive with proper reason
    await updateDoc(COL_USERS, userId, {
      account_status: 'inactive',
      inactive_reason: 'Sponsor Claim Pending Admin Approval',
      sponsor_awaiting_credit: true,
    });

    // Audit log
    try {
      await addDoc('audit_logs', {
        action: 'sponsor_claim_created',
        target_id: claim.id,
        target_type: 'sponsor_claim',
        admin_id: 'system',
        details: {
          sponsorId: userId,
          sponsorName: user.name,
          referralCode: user.referral_code,
          claimAmount: totalAmount,
          itemsCount: items.length,
          items,
        },
        created_at: now,
      });
    } catch {}

    // Notification
    try {
      await addDoc('notifications', {
        receiverId: userId,
        title: 'Sponsor Bonus Claimed',
        message: `You have claimed ₹${totalAmount.toFixed(2)} in sponsor bonus from ${items.length} referred user topups. Your account is now inactive pending admin approval.`,
        type: 'sponsor_claim_created',
        status: 'unread',
        createdAt: now,
        senderId: 'system',
        senderName: 'System',
      });
    } catch {}

    try { broadcast('sponsorClaimCreated', { sponsorId: userId, claimAmount: totalAmount, itemsCount: items.length }); } catch {}

    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'claimed',
      claimId: claim.id,
      claimAmount: totalAmount,
      itemsCount: items.length,
      message: 'Sponsor bonus claimed successfully. Account set to inactive pending admin approval.',
    }));
  } catch (err) {
    console.error('[sponsorClaim] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
