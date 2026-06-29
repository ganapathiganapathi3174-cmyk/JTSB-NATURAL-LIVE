const { randomString, crypto, MAX_REFERRALS, COL_TOPUP_INCOME, generateIdempotencyKey } = require('../api/_shared.js');
const { getDoc, runQuery, writeDoc, updateDoc, addDoc, deleteDoc, conditionalUpdateDoc, atomicCreditWallet } = require('../api/_supabase.js');
const { broadcast } = require('../api/_sse.js');

const COL_UPI_PAYMENTS = 'upi_payments';
const COL_USERS = 'users';
const COL_WALLET_BALANCES = 'wallet_balances';
const COL_WALLET_TX = 'wallet_transactions';
const COL_TOPUPS = 'topups';
const COL_PENDING_REGS = 'pending_registrations';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }
  if (!req.admin) { res.writeHead(401); res.end(JSON.stringify({ error: 'Authentication required' })); return; }

  const idempotencyKey = generateIdempotencyKey();

  try {
    const { paymentId } = req.body || {};
    if (!paymentId) { res.writeHead(400); res.end(JSON.stringify({ error: 'Payment ID is required' })); return; }

    // ATOMIC: Claim payment — only succeeds if status is processable
    const now = new Date().toISOString();
    const claimed = await conditionalUpdateDoc(COL_UPI_PAYMENTS, paymentId, [
      { field: 'status', op: 'IN', value: ['pending', 'manual_review'] },
    ], { status: 'verified', verified_at: now });

    if (claimed === 0) {
      // Payment already processed — return current status (idempotent)
      const existing = await runQuery(COL_UPI_PAYMENTS, [{ field: 'id', op: 'EQUAL', value: paymentId }]);
      if (existing && existing.length) {
        res.writeHead(200); res.end(JSON.stringify({ status: existing[0].status, idempotent: true }));
        return;
      }
      res.writeHead(404); res.end(JSON.stringify({ error: 'Payment not found' }));
      return;
    }

    const payments = await runQuery(COL_UPI_PAYMENTS, [{ field: 'id', op: 'EQUAL', value: paymentId }]);
    if (!payments.length) {
      await conditionalUpdateDoc(COL_UPI_PAYMENTS, paymentId, [], { status: 'failed', rejection_reasons: ['Payment record vanished'] });
      res.writeHead(404); res.end(JSON.stringify({ error: 'Payment record not found' }));
      return;
    }

    const payment = payments[0];
    const payType = payment.payment_type;
    const amountNum = payment.amount;

    try {
      if (payType === 'registration') {
        const pendingRegId = payment.pending_reg_id || payment.user_id;
        if (!pendingRegId) { throw Object.assign(new Error('No registration session linked'), { code: 'NO_SESSION' }); }

        const pendingRegs = await runQuery(COL_PENDING_REGS, [{ field: 'id', op: 'EQUAL', value: pendingRegId }]);
        if (!pendingRegs.length) { throw Object.assign(new Error('Registration session not found'), { code: 'NO_SESSION' }); }

        const pendingReg = pendingRegs[0];
        const newUserId = crypto.randomUUID();
        const refCode = pendingReg.referral_code;

        const userName = pendingReg.name || '';
        const userEmail = pendingReg.email || '';
        const userPhone = pendingReg.phone || '';
        const missingFields = [];
        if (!userName) missingFields.push('name');
        if (!userEmail) missingFields.push('email');
        if (!userPhone) missingFields.push('phone');
        if (['unknown', 'undefined', 'null'].includes(userName.toLowerCase())) missingFields.push('name=unknown');
        if (['unknown', 'undefined', 'null'].includes(userEmail.toLowerCase())) missingFields.push('email=unknown');
        if (['unknown', 'undefined', 'null'].includes(userPhone.toLowerCase())) missingFields.push('phone=unknown');
        if (missingFields.length) {
          await updateDoc(COL_UPI_PAYMENTS, payment.id, {
            status: 'rejected', rejection_reasons: ['Invalid registration data: ' + missingFields.join(', ')],
            verified_at: new Date().toISOString(),
          });
          res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid registration data' })); return;
        }

        let referredByUserId = null;
        let referredByCode = null;
        if (refCode) {
          const refUsers = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: refCode }]);
          if (refUsers.length) { referredByUserId = refUsers[0].id; referredByCode = refCode; }
        }

        const userData = {
          id: newUserId, email: userEmail, name: userName,
          phone: userPhone, password_hash: pendingReg.password_hash,
          referral_code: randomString(8), referred_by: referredByCode,
          account_status: 'active', payment_status: 'success',
          approved: true, active: true, membership_paid: true,
          joined_date: now, approved_date: now,
        };
        await writeDoc(COL_USERS, newUserId, userData);

        // New wallet — no race possible (fresh id)
        await writeDoc(COL_WALLET_BALANCES, newUserId, { balance: 0, total_earned: amountNum });
        await addDoc(COL_WALLET_TX, {
          user_id: newUserId, type: 'deposit', amount: amountNum,
          description: 'Registration payment (admin approved)', reference_id: payment.id, balance_after: amountNum,
        });

        // Referral bonus — atomic credit (use user ID, not referral code)
        if (referredByUserId) {
          const refAmount = amountNum * 0.1;
          await atomicCreditWallet(referredByUserId, refAmount, payment.id, 'Referral bonus for ' + newUserId, 'referral_bonus');

          // Increment referrer's referral count
          const referrerDoc = await getDoc(COL_USERS, referredByUserId);
          if (referrerDoc) {
            const currentCount = (referrerDoc.referrals_count || 0) + 1;
            const limitReached = currentCount >= MAX_REFERRALS;
            const updates = {
              referrals_count: currentCount,
              total_referral_count: (referrerDoc.total_referral_count || 0) + 1,
              referral_limit_reached: limitReached,
              referral_active: !limitReached,
              is_qualified: limitReached,
            };
            if (limitReached) {
              updates.account_status = 'inactive';
              updates.inactive_reason = 'Referral Limit Reached (2 Successful Referrals)';
              updates.referral_expires_at = new Date().toISOString();
            }
            await updateDoc(COL_USERS, referredByUserId, updates);

            // Admin notification when limit reached
            if (limitReached) {
              try { await addDoc('notifications', { receiverId: referredByUserId, title: 'Referral Limit Reached', message: 'Your referral link has reached the maximum of ' + MAX_REFERRALS + ' successful registrations and has been expired. Your account has been set to inactive pending admin approval.', type: 'referral_limit_reached', status: 'unread', createdAt: now, senderId: 'system', senderName: 'System' }); } catch {}
              try { await addDoc('audit_logs', { action: 'referral_limit_reached', target_id: referredByUserId, target_type: 'user', admin_id: req.admin?.email || 'system', details: { referralCode: referredByCode, referralCount: currentCount, reason: 'Auto-inactivated after ' + MAX_REFERRALS + ' referrals', registrationPlan: 'UPI', paymentMethod: 'UPI' }, created_at: now }); } catch {}
            }
          }
        }

        // Audit log
        try { await addDoc('audit_logs', { action: 'approve_registration_payment', target_id: payment.id, target_type: 'upi_payment', admin_id: req.admin?.email || 'unknown', details: { userId: newUserId, amount: amountNum, referredBy: referredByCode }, created_at: now }); } catch {}

        try { await deleteDoc(COL_PENDING_REGS, pendingRegId); } catch {}

        try { await addDoc('notifications', { receiverId: newUserId, title: 'Registration Approved', message: 'Your registration payment of ₹' + amountNum + ' has been approved and your account is now active.', type: 'payment_approved', status: 'unread', createdAt: now, senderId: 'system', senderName: 'System' }); } catch {}

        try { broadcast('paymentUpdated', { id: payment.id, status: 'approved', type: payType, userId: newUserId }); } catch {}
        res.writeHead(200); res.end(JSON.stringify({ status: 'approved', userId: newUserId }));
        return;
      }

      if (payType === 'topup') {
        const userId = payment.user_id;
        if (!userId) { throw Object.assign(new Error('No user linked to this payment'), { code: 'NO_USER' }); }

        const userDocs = await runQuery(COL_USERS, [{ field: 'id', op: 'EQUAL', value: userId }]);
        if (!userDocs.length) { throw Object.assign(new Error('User not found'), { code: 'NO_USER' }); }

        const userDoc = userDocs[0];

        // Atomic wallet credit
        await atomicCreditWallet(userId, amountNum, payment.id, 'Topup via UPI (admin approved)');

        const { id: topupId } = await addDoc(COL_TOPUPS, {
          user_id: userId, amount: amountNum, utr: payment.utr,
          screenshot_url: payment.screenshot_url, status: 'approved', verified_at: now,
        });

        // Referral income for topup
        const referredByCode = userDoc.referred_by || null;
        if (referredByCode) {
          try {
            const refUsers = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: referredByCode }], { limit: 1 });
            const referrer = refUsers.length ? refUsers[0] : null;
            if (referrer) {
              const sponsorTopups = await runQuery(COL_TOPUPS, [
                { field: 'user_id', op: 'EQUAL', value: referrer.id },
                { field: 'status', op: 'EQUAL', value: 'approved' },
              ], { limit: 1 });
              const incomeStatus = sponsorTopups.length > 0 ? 'eligible' : 'locked';

              await addDoc(COL_TOPUP_INCOME, {
                user_id: referrer.id, from_user_id: userId, topup_id: topupId,
                amount: amountNum, level: 1, status: incomeStatus,
              });

              const currentCount = referrer.topup_referral_qualified_count || 0;
              const newCount = currentCount + 1;
              const topupQualified = (referrer.referrals_count || 0) + newCount >= MAX_REFERRALS;
              await updateDoc(COL_USERS, referrer.id, { topup_referral_qualified_count: newCount, topup_referral_qualified: topupQualified });

              if (userDoc.referred_by_status !== 'approved') {
                await updateDoc(COL_USERS, userId, { referred_by_status: 'approved' });
              }
            }
          } catch (e) { console.error('[MANUAL-APPROVE] Topup referral income error:', e?.message); }
        }

        // Audit log
        try { await addDoc('audit_logs', { action: 'approve_topup_payment', target_id: payment.id, target_type: 'upi_payment', admin_id: req.admin?.email || 'unknown', details: { userId, amount: amountNum, topupId, referredBy: referredByCode }, created_at: now }); } catch {}

        // Sponsor topup completion — unlock locked incomes
        try {
          if (userDoc.topup_referral_qualified && !userDoc.sponsor_topup_completed) {
            await updateDoc(COL_USERS, userId, { account_status: 'inactive', sponsor_topup_completed: true });
            const lockedIncome = await runQuery(COL_TOPUP_INCOME, [
              { field: 'user_id', op: 'EQUAL', value: userId },
              { field: 'status', op: 'EQUAL', value: 'locked' },
            ], { limit: 100 });
            for (const inc of lockedIncome) {
              await updateDoc(COL_TOPUP_INCOME, inc.id, { status: 'eligible' });
            }
          }
        } catch (e) { console.error('[MANUAL-APPROVE] Sponsor topup completion error:', e?.message); }

        try { await addDoc('notifications', { receiverId: userId, title: 'Topup Approved', message: 'Your topup of ₹' + amountNum + ' has been approved and added to your wallet.', type: 'payment_approved', status: 'unread', createdAt: now, senderId: 'system', senderName: 'System' }); } catch {}

        try { broadcast('paymentUpdated', { id: payment.id, status: 'approved', type: payType, userId }); } catch {}
        res.writeHead(200); res.end(JSON.stringify({ status: 'approved', userId }));
        return;
      }

      await updateDoc(COL_UPI_PAYMENTS, payment.id, { status: 'failed', rejection_reasons: ['Unknown payment type: ' + payType] });
      res.writeHead(400); res.end(JSON.stringify({ error: 'Unknown payment type' }));
    } catch (innerErr) {
      // ROLLBACK: revert payment status
      await conditionalUpdateDoc(COL_UPI_PAYMENTS, payment.id, [
        { field: 'status', op: 'EQUAL', value: 'verified' },
      ], { status: 'failed', rejection_reasons: ['Approval failed: ' + innerErr.message] });
      try { await addDoc('audit_logs', { action: 'approve_payment_failed', target_id: payment.id, target_type: 'upi_payment', admin_id: req.admin?.email || 'unknown', details: { error: innerErr.message, payType }, created_at: new Date().toISOString() }); } catch {}
      console.error('[approveUPIPayment] Inner error:', innerErr.message);
      res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  } catch (err) {
    console.error('[approveUPIPayment] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
