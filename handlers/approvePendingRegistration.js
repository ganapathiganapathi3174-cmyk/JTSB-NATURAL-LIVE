const { COL_USERS, COL_WALLET_BALANCES, COL_WALLET_TX, COL_PENDING_REGS, randomString, crypto, MAX_REFERRALS, isSystemReferralCode, getReferrerPackage, getPackageByReferral } = require('../api/_shared.js');
const { runQuery, writeDoc, updateDoc, addDoc, deleteDoc } = require('../api/_supabase.js');
const cycleEngine = require('../api/_cycleEngine.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }
  if (!req.admin) { res.writeHead(401); res.end(JSON.stringify({ error: 'Authentication required' })); return; }

  try {
    const { pendingRegId } = req.body || {};
    if (!pendingRegId) { res.writeHead(400); res.end(JSON.stringify({ error: 'pendingRegId is required' })); return; }

    const pendingRegs = await runQuery(COL_PENDING_REGS, [{ field: 'id', op: 'EQUAL', value: pendingRegId }]);
    if (!pendingRegs.length) { res.writeHead(404); res.end(JSON.stringify({ error: 'Pending registration not found' })); return; }

    const pendingReg = pendingRegs[0];
    const now = new Date().toISOString();
    const newUserId = crypto.randomUUID();

    // Find referrer by referral code (store the CODE string, not UUID)
    let referredByUserId = null;
    let referredByCode = null;
    if (pendingReg.referral_code) {
      const refUsers = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: pendingReg.referral_code }]);
      if (refUsers.length) { referredByUserId = refUsers[0].id; referredByCode = pendingReg.referral_code; }
    }

    const userPkg = getReferrerPackage(pendingReg) || getPackageByReferral(pendingReg.referral_code) || '120';

    await writeDoc(COL_USERS, newUserId, {
      id: newUserId,
      email: pendingReg.email,
      name: pendingReg.name,
      phone: pendingReg.phone,
      password_hash: pendingReg.password_hash,
      referral_code: randomString(8),
      referred_by: referredByCode,
      account_status: 'active',
      payment_status: 'success',
      approved: true,
      active: true,
      membership_paid: true,
      membership_type: userPkg,
      joined_date: now,
      approved_date: now,
    });

    await writeDoc(COL_WALLET_BALANCES, newUserId, { balance: 0, total_earned: 0 });

    // Increment referrer's referral count
    if (referredByUserId) {
      try {
        const referrerDoc = await runQuery(COL_USERS, [{ field: 'id', op: 'EQUAL', value: referredByUserId }], { limit: 1 });
        if (referrerDoc && referrerDoc.length) {
          const referrer = referrerDoc[0];
          const currentCount = (referrer.referrals_count || 0) + 1;
          const limitReached = currentCount >= MAX_REFERRALS;
          const updates = {
            referrals_count: currentCount,
            total_referral_count: (referrer.total_referral_count || 0) + 1,
            referral_limit_reached: limitReached,
            referral_active: !limitReached,
            is_qualified: limitReached,
          };
          await updateDoc(COL_USERS, referredByUserId, updates);

          if (limitReached) {
            try { await addDoc('notifications', { receiverId: referredByUserId, title: 'Referral Limit Reached', message: 'Your referral link has reached the maximum of ' + MAX_REFERRALS + ' successful registrations and has been deactivated.', type: 'referral_limit_reached', status: 'unread', createdAt: now, senderId: 'system', senderName: 'System' }); } catch (e) { console.error('[approvePendingRegistration] Referral-limit notification failed: ' + e.message); }
            try { await addDoc('audit_logs', { action: 'referral_limit_reached', target_id: referredByUserId, target_type: 'user', admin_id: req.admin?.email || 'system', details: { referralCode: referredByCode, referralCount: currentCount, reason: 'Auto-deactivated after ' + MAX_REFERRALS + ' referrals', registrationPlan: 'Direct Admin', paymentMethod: 'Admin' }, created_at: now }); } catch (e) { console.error('[approvePendingRegistration] Referral-limit audit failed: ' + e.message); }
          }

          // Cycle engine — track referral cycle progress
          try { await cycleEngine.onReferralApproved(referredByUserId, newUserId, referredByCode, req.admin?.email); } catch (e) { console.error('[approvePendingRegistration] Cycle engine referral error:', e.message); }
        }
      } catch (e) { console.error('[approvePendingRegistration] Referral count increment error:', e.message); }
    }

    // Audit log
    try { await addDoc('audit_logs', { action: 'direct_approve_registration', target_id: pendingRegId, target_type: 'pending_registration', admin_id: req.admin?.email || 'unknown', details: { userId: newUserId, referredBy: referredByCode }, created_at: now }); } catch (e) { console.error('[approvePendingRegistration] Audit log failed: ' + e.message); }

    await deleteDoc(COL_PENDING_REGS, pendingRegId);

    try { await addDoc('notifications', { receiverId: newUserId, title: 'Registration Approved', message: 'Your registration has been approved and your account is now active.', type: 'payment_approved', status: 'unread', createdAt: now, senderId: 'system', senderName: 'System' }); } catch (e) { console.error('[approvePendingRegistration] Notification failed: ' + e.message); }

    res.writeHead(200); res.end(JSON.stringify({ status: 'approved', userId: newUserId }));
  } catch (err) {
    console.error('[approvePendingRegistration] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
