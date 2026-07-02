const { COL_USERS, COL_UPI_PAYMENTS, COL_SPONSOR_TRANSFERS, COL_NOTIFICATIONS } = require('../api/_shared.js');
const { runQuery, addDoc } = require('../api/_supabase.js');

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
    const { userId, newSponsorId } = JSON.parse(Buffer.concat(body).toString());

    if (!userId || !newSponsorId) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'userId and newSponsorId are required' })); return;
    }

    if (userId === newSponsorId) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Cannot transfer to yourself' })); return;
    }

    const userDoc = await runQuery(COL_USERS, [
      { field: 'id', op: 'EQUAL', value: userId },
    ], { limit: 1 });

    if (!userDoc || userDoc.length === 0) {
      res.writeHead(404); res.end(JSON.stringify({ error: 'User not found' })); return;
    }

    const newSponsorDoc = await runQuery(COL_USERS, [
      { field: 'id', op: 'EQUAL', value: newSponsorId },
    ], { limit: 1 });

    if (!newSponsorDoc || newSponsorDoc.length === 0) {
      res.writeHead(404); res.end(JSON.stringify({ error: 'Sponsor not found' })); return;
    }

    const sponsor = newSponsorDoc[0];

    if (sponsor.account_status !== 'active') {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Sponsor is not active' })); return;
    }

    const duplicateRequests = await runQuery(COL_SPONSOR_TRANSFERS, [
      { field: 'user_id', op: 'EQUAL', value: userId },
      { field: 'new_sponsor_id', op: 'EQUAL', value: newSponsorId },
      { field: 'status', op: 'EQUAL', value: 'pending' },
    ], { limit: 1 });

    if (duplicateRequests && duplicateRequests.length > 0) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'A pending transfer request already exists for this sponsor' })); return;
    }

    const userRefCode = userDoc[0].referral_code;
    const sponsorRefBy = sponsor.referred_by;
    if (sponsorRefBy && sponsorRefBy === userRefCode) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Circular sponsorship not allowed' })); return;
    }

    let currentSponsorCode = userDoc[0].referred_by;
    let currentSponsorId = null;
    if (currentSponsorCode) {
      const currentSponsorDocs = await runQuery(COL_USERS, [
        { field: 'referral_code', op: 'EQUAL', value: currentSponsorCode },
      ], { limit: 1 });
      if (currentSponsorDocs && currentSponsorDocs.length > 0) {
        currentSponsorId = currentSponsorDocs[0].id;
      }
    }

    const userPayments = await runQuery(COL_UPI_PAYMENTS, [
      { field: 'user_id', op: 'EQUAL', value: userId },
      { field: 'status', op: 'IN', value: ['verified', 'approved'] },
    ], { orderBy: 'created_at', ascending: false, limit: 1 });

    const planAmount = userPayments && userPayments.length > 0 ? Number(userPayments[0].amount) : 0;

    const newSponsorPayments = await runQuery(COL_UPI_PAYMENTS, [
      { field: 'user_id', op: 'EQUAL', value: newSponsorId },
      { field: 'status', op: 'IN', value: ['verified', 'approved'] },
    ], { orderBy: 'created_at', ascending: false, limit: 1 });

    const sponsorPlanAmount = newSponsorPayments && newSponsorPayments.length > 0 ? Number(newSponsorPayments[0].amount) : 0;

    if (Number(planAmount) !== Number(sponsorPlanAmount)) {
      res.writeHead(400); res.end(JSON.stringify({
        error: 'Sponsor plan mismatch. Your plan: ' + planAmount + ', Sponsor plan: ' + sponsorPlanAmount,
      })); return;
    }

    const now = new Date().toISOString();

    const transfer = {
      user_id: userId,
      old_sponsor_id: currentSponsorId,
      old_sponsor_code: currentSponsorCode,
      new_sponsor_id: newSponsorId,
      new_sponsor_code: sponsor.referral_code,
      user_plan: planAmount,
      status: 'pending',
      requested_at: now,
      created_at: now,
      updated_at: now,
    };

    const transferResult = await addDoc(COL_SPONSOR_TRANSFERS, transfer);

    const transferId = transferResult?.id || transferResult?.data?.[0]?.id || null;

    try {
      await addDoc(COL_NOTIFICATIONS, {
        receiverId: newSponsorId,
        title: 'Sponsor Transfer Request',
        message: userDoc[0].name + ' (' + userDoc[0].email + ') has requested to be transferred under your sponsorship. Plan: ₹' + planAmount,
        type: 'sponsor_transfer_request',
        status: 'unread',
        senderId: userId,
        senderName: userDoc[0].name || 'User',
        createdAt: now,
      });
    } catch (notifErr) {
      console.error('[SPONSOR-TRANSFER] Notification error:', notifErr.message);
    }

    res.writeHead(200); res.end(JSON.stringify({
      success: true,
      transfer: {
        id: transferId,
        userId,
        newSponsorId,
        status: 'pending',
        requestedAt: now,
        newSponsorName: sponsor.name,
        plan: planAmount,
      },
    }));
  } catch (err) {
    console.error('[SPONSOR-TRANSFER] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
