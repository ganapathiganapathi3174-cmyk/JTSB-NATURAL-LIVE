const {
  randomString, crypto, MAX_REFERRALS, COL_TOPUP_INCOME, COL_NOTIFICATIONS,
} = require('../api/_shared.js');
const {
  getDoc, runQuery, writeDoc, updateDoc, addDoc, deleteDoc, conditionalUpdateDoc,
  atomicCreditWallet, runQueryDecrypted,
} = require('../api/_supabase.js');
const { broadcast } = require('../api/_sse.js');
const {
  authenticateRequest, verifyReplay, recordPaymentReceived, recordError,
} = require('../api/_companionAuth.js');

const COL_UPI_PAYMENTS = 'upi_payments';
const COL_USERS = 'users';
const COL_WALLET_BALANCES = 'wallet_balances';
const COL_WALLET_TX = 'wallet_transactions';
const COL_TOPUPS = 'topups';
const COL_PENDING_REGS = 'pending_registrations';
const PAYMENT_WINDOW_MINUTES = 120;

function log(tag, msg) {
  console.log('[' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '] [COMPANION] [' + tag + '] ' + msg);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Companion-Key, X-Companion-Device');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  try {
    const auth = authenticateRequest(req);
    if (!auth.ok) {
      res.writeHead(401); res.end(JSON.stringify({ error: auth.error }));
      return;
    }

    const { utr, amount, date, time, paymentMode } = req.body || {};
    const errors = [];
    if (!utr || typeof utr !== 'string') errors.push('utr is required');
    if (amount == null || isNaN(Number(amount))) errors.push('amount is required');
    if (!date) errors.push('date is required');
    if (errors.length) {
      res.writeHead(400); res.end(JSON.stringify({ error: errors.join('. ') }));
      return;
    }

    const utrStr = utr.trim();
    const amountNum = Number(amount);
    if (utrStr.length < 6) { res.writeHead(400); res.end(JSON.stringify({ error: 'UTR too short' })); return; }
    if (amountNum <= 0) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid amount' })); return; }

    if (!verifyReplay(utrStr, amountNum, date + 'T' + (time || '00:00'))) {
      res.writeHead(429); res.end(JSON.stringify({ error: 'Duplicate submission detected' }));
      return;
    }

    log('RECEIVE', 'payment: utr=' + utrStr + ', amount=' + amountNum + ', date=' + date + (time ? ', time=' + time : ''));
    recordPaymentReceived();

    // ---- Rule 1: UTR must never exist before ----
    const existingUtr = await runQueryDecrypted(COL_UPI_PAYMENTS, [
      { field: 'utr', op: 'EQUAL', value: utrStr },
    ], { limit: 1 });
    if (existingUtr.length > 0) {
      log('RULE1', 'UTR already exists: ' + utrStr);
      res.writeHead(200); res.end(JSON.stringify({
        status: 'duplicate_utr', message: 'UTR already recorded',
      }));
      return;
    }

    // ---- Rules 2-4: Find matching pending payments ----
    // amount match + pending status + created within payment window
    const windowStart = new Date();
    windowStart.setMinutes(windowStart.getMinutes() - PAYMENT_WINDOW_MINUTES);

    const pendingPayments = await runQuery(COL_UPI_PAYMENTS, [
      { field: 'status', op: 'EQUAL', value: 'pending' },
      { field: 'amount', op: 'EQUAL', value: amountNum },
    ], { orderBy: 'created_at', ascending: false, limit: 50 });

    // Filter by time window (created_at within window)
    const windowStartStr = windowStart.toISOString();
    const matched = pendingPayments.filter(function (p) {
      return p.created_at >= windowStartStr;
    });

    log('RULE2-4', 'Found ' + matched.length + ' pending payments matching amount=' + amountNum + ' within window');

    // ---- Rule 5: Exactly one match condition ----
    if (matched.length === 0) {
      log('RULE5', 'No matching payment found — keeping in review queue');
      recordError('No matching pending payment for amount=' + amountNum + ', utr=' + utrStr);
      res.writeHead(200); res.end(JSON.stringify({
        status: 'no_match', message: 'No matching pending payment found',
      }));
      return;
    }

    if (matched.length > 1) {
      log('RULE5', matched.length + ' payments matched — moving all to manual_review');
      for (const p of matched) {
        await updateDoc(COL_UPI_PAYMENTS, p.id, {
          status: 'manual_review',
          rejection_reasons: ['Multiple payments matched companion submission (UTR=' + utrStr + ')'],
        });
      }
      res.writeHead(200); res.end(JSON.stringify({
        status: 'manual_review', message: 'Multiple payments matched — moved to manual review',
      }));
      return;
    }

    // ---- Exactly one match — auto-approve ----
    const payment = matched[0];
    log('APPROVE', 'Auto-approving payment id=' + payment.id + ', type=' + payment.payment_type + ', utr=' + utrStr);

    const now = new Date().toISOString();
    const claimed = await conditionalUpdateDoc(COL_UPI_PAYMENTS, payment.id, [
      { field: 'status', op: 'IN', value: ['pending', 'manual_review'] },
    ], { status: 'verified', utr: utrStr, verified_at: now });

    if (claimed === 0) {
      log('APPROVE', 'Payment ' + payment.id + ' already processed — idempotent');
      const existing = await runQuery(COL_UPI_PAYMENTS, [{ field: 'id', op: 'EQUAL', value: payment.id }]);
      res.writeHead(200); res.end(JSON.stringify({
        status: existing && existing.length ? existing[0].status : 'unknown', idempotent: true,
      }));
      return;
    }

    const payType = payment.payment_type;

    try {
      if (payType === 'registration') {
        const pendingRegId = payment.pending_reg_id || payment.user_id;
        if (!pendingRegId) throw Object.assign(new Error('No registration session linked'), { code: 'NO_SESSION' });

        const pendingRegs = await runQuery(COL_PENDING_REGS, [{ field: 'id', op: 'EQUAL', value: pendingRegId }]);
        if (!pendingRegs.length) throw Object.assign(new Error('Registration session not found'), { code: 'NO_SESSION' });

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
            verified_at: now,
          });
          log('REJECT', 'Invalid registration data for payment ' + payment.id);
          res.writeHead(200); res.end(JSON.stringify({ status: 'rejected', reason: 'Invalid registration data' }));
          return;
        }

        let referredByUserId = null;
        let referredByCode = null;
        if (refCode) {
          const refUsers = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: refCode }]);
          if (refUsers.length) { referredByUserId = refUsers[0].id; referredByCode = refCode; }
        }

        await writeDoc(COL_USERS, newUserId, {
          id: newUserId, email: userEmail, name: userName,
          phone: userPhone, password_hash: pendingReg.password_hash,
          referral_code: randomString(8), referred_by: referredByCode,
          account_status: 'active', payment_status: 'success',
          approved: true, active: true, membership_paid: true,
          joined_date: now, approved_date: now,
        });

        await writeDoc(COL_WALLET_BALANCES, newUserId, { balance: 0, total_earned: amountNum });
        await addDoc(COL_WALLET_TX, {
          user_id: newUserId, type: 'deposit', amount: amountNum,
          description: 'Registration payment (companion auto-verified)',
          reference_id: payment.id, balance_after: amountNum,
        });

        if (referredByUserId) {
          const refAmount = amountNum * 0.1;
          await atomicCreditWallet(referredByUserId, refAmount, payment.id, 'Referral bonus for ' + newUserId, 'referral_bonus');
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
              updates.referral_expires_at = now;
            }
            await updateDoc(COL_USERS, referredByUserId, updates);
            if (limitReached) {
              try { await addDoc('notifications', { receiverId: referredByUserId, title: 'Referral Limit Reached', message: 'Your referral link has reached the maximum of ' + MAX_REFERRALS + ' successful registrations and has been expired.', type: 'referral_limit_reached', status: 'unread', createdAt: now, senderId: 'system', senderName: 'System' }); } catch {}
              try { await addDoc('audit_logs', { action: 'referral_limit_reached', target_id: referredByUserId, target_type: 'user', admin_id: 'companion', details: { referralCode: referredByCode, referralCount: currentCount, reason: 'Auto-inactivated after ' + MAX_REFERRALS + ' referrals' }, created_at: now }); } catch {}
            }
          }
        }

        try { await addDoc('audit_logs', { action: 'companion_approve_registration', target_id: payment.id, target_type: 'upi_payment', admin_id: 'companion', details: { userId: newUserId, amount: amountNum, referredBy: referredByCode, utr: utrStr }, created_at: now }); } catch {}
        try { await deleteDoc(COL_PENDING_REGS, pendingRegId); } catch {}
        try { await addDoc('notifications', { receiverId: newUserId, title: 'Registration Approved (Auto)', message: 'Your registration payment of \u20B9' + amountNum + ' has been auto-approved via SMS verification.', type: 'payment_approved', status: 'unread', createdAt: now, senderId: 'system', senderName: 'System' }); } catch {}
        try { broadcast('paymentUpdated', { id: payment.id, status: 'approved', type: payType, userId: newUserId, source: 'companion' }); } catch {}

        log('SUCCESS', 'Registration approved: userId=' + newUserId + ', amount=' + amountNum + ', utr=' + utrStr);
        res.writeHead(200); res.end(JSON.stringify({ status: 'approved', userId: newUserId, utr: utrStr }));
        return;
      }

      if (payType === 'topup') {
        const userId = payment.user_id;
        if (!userId) throw Object.assign(new Error('No user linked to this payment'), { code: 'NO_USER' });

        const userDocs = await runQuery(COL_USERS, [{ field: 'id', op: 'EQUAL', value: userId }]);
        if (!userDocs.length) throw Object.assign(new Error('User not found'), { code: 'NO_USER' });

        const userDoc = userDocs[0];
        await atomicCreditWallet(userId, amountNum, payment.id, 'Topup via UPI (companion auto-verified)');

        const { id: topupId } = await addDoc(COL_TOPUPS, {
          user_id: userId, amount: amountNum, utr: utrStr,
          screenshot_url: payment.screenshot_url, status: 'approved', verified_at: now,
        });

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
          } catch (e) { log('REFERRAL', 'Topup referral income error: ' + (e && e.message)); }
        }

        try {
          if (userDoc.topup_referral_qualified && !userDoc.sponsor_topup_completed) {
            await updateDoc(COL_USERS, userId, { account_status: 'inactive', inactive_reason: 'Sponsor Claim Pending Admin Approval', sponsor_topup_completed: true, sponsor_awaiting_credit: true });
            const lockedIncome = await runQuery(COL_TOPUP_INCOME, [
              { field: 'user_id', op: 'EQUAL', value: userId },
              { field: 'status', op: 'EQUAL', value: 'locked' },
            ], { limit: 100 });
            for (const inc of lockedIncome) {
              await updateDoc(COL_TOPUP_INCOME, inc.id, { status: 'eligible' });
            }
          }
        } catch (e) { log('SPONSOR', 'Sponsor topup completion error: ' + (e && e.message)); }

        try { await addDoc('audit_logs', { action: 'companion_approve_topup', target_id: payment.id, target_type: 'upi_payment', admin_id: 'companion', details: { userId, amount: amountNum, topupId, utr: utrStr }, created_at: now }); } catch {}
        try { await addDoc('notifications', { receiverId: userId, title: 'Topup Approved (Auto)', message: 'Your topup of \u20B9' + amountNum + ' has been auto-approved via SMS verification.', type: 'payment_approved', status: 'unread', createdAt: now, senderId: 'system', senderName: 'System' }); } catch {}
        try { broadcast('paymentUpdated', { id: payment.id, status: 'approved', type: payType, userId, source: 'companion' }); } catch {}

        log('SUCCESS', 'Topup approved: userId=' + userId + ', amount=' + amountNum + ', utr=' + utrStr);
        res.writeHead(200); res.end(JSON.stringify({ status: 'approved', userId, utr: utrStr }));
        return;
      }

      await updateDoc(COL_UPI_PAYMENTS, payment.id, { status: 'failed', rejection_reasons: ['Unknown payment type: ' + payType] });
      res.writeHead(200); res.end(JSON.stringify({ status: 'failed', reason: 'Unknown payment type' }));
    } catch (innerErr) {
      await conditionalUpdateDoc(COL_UPI_PAYMENTS, payment.id, [
        { field: 'status', op: 'EQUAL', value: 'verified' },
      ], { status: 'failed', rejection_reasons: ['Companion approval failed: ' + innerErr.message] });
      try { await addDoc('audit_logs', { action: 'companion_approve_failed', target_id: payment.id, target_type: 'upi_payment', admin_id: 'companion', details: { error: innerErr.message, payType, utr: utrStr }, created_at: now }); } catch {}
      log('ERROR', 'Approval failed for payment ' + payment.id + ': ' + innerErr.message);
      recordError(innerErr.message);
      res.writeHead(200); res.end(JSON.stringify({ status: 'failed', error: innerErr.message }));
    }
  } catch (err) {
    log('FATAL', err.message);
    recordError(err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
