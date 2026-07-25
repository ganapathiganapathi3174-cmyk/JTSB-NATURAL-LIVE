const { COL_USERS, COL_NOTIFICATIONS, COL_AUDIT_LOGS, MAX_REFERRALS } = require('./_shared.js');
const { getDoc, runQuery, updateDoc, addDoc } = require('./_supabase.js');
const { broadcast } = require('./_sse.js');

const COL_CYCLE_HISTORY = 'cycle_history';

const INACTIVE_REASONS = {
  REFERRAL_LIMIT_COMPLETED: 'REFERRAL_LIMIT_COMPLETED',
  TOPUP_CYCLE_COMPLETED: 'TOPUP_CYCLE_COMPLETED',
  ADMIN_DISABLED: 'ADMIN_DISABLED',
  SECURITY_ACTION: 'SECURITY_ACTION',
};

const INACTIVE_MESSAGES = {
  REFERRAL_LIMIT_COMPLETED: 'Two successful referrals completed. Waiting for admin reactivation.',
  TOPUP_CYCLE_COMPLETED: 'Sponsor topup approved. Waiting for admin reactivation.',
  ADMIN_DISABLED: 'Disabled manually by administrator.',
  SECURITY_ACTION: 'Account restricted by security rules.',
};

async function onReferralApproved(sponsorUserId, referralUserId, referralCode, adminEmail) {
  const now = new Date().toISOString();
  const sponsor = await getDoc(COL_USERS, sponsorUserId);
  if (!sponsor) return { deactivated: false };

  const currentCount = (sponsor.current_cycle_referral_count || 0) + 1;
  const totalReferrals = (sponsor.total_referrals || 0) + 1;
  const cycleNumber = sponsor.referral_cycle_number || 1;
  const limitReached = currentCount >= MAX_REFERRALS;

  const updates = {
    current_cycle_referral_count: currentCount,
    total_referrals: totalReferrals,
    referrals_count: currentCount,
    total_referral_count: totalReferrals,
    referral_limit_reached: limitReached,
    referral_active: !limitReached,
    is_qualified: limitReached,
  };

  if (limitReached) {
    updates.account_status = 'inactive';
    updates.inactive_reason = INACTIVE_REASONS.REFERRAL_LIMIT_COMPLETED;
    updates.inactive_at = now;

    try {
      await addDoc(COL_NOTIFICATIONS, {
        receiverId: sponsorUserId, title: 'Referral Cycle Completed',
        message: 'Your referral cycle #' + cycleNumber + ' is complete (' + currentCount + '/' + MAX_REFERRALS + ' referrals). Your account is now inactive pending admin reactivation.',
        type: 'referral_cycle_completed', status: 'unread', createdAt: now, senderId: 'system', senderName: 'System',
      });
    } catch {}

    try {
      await addDoc(COL_NOTIFICATIONS, {
        receiverId: 'admin', title: 'Referral Cycle Completed',
        message: 'User ' + (sponsor.name || sponsorUserId) + ' has completed referral cycle #' + cycleNumber + ' with ' + currentCount + ' referrals. Awaiting reactivation.',
        type: 'referral_cycle_completed_admin', status: 'unread', createdAt: now, senderId: sponsorUserId, senderName: sponsor.name || 'User',
      });
    } catch {}

    try {
      await addDoc(COL_AUDIT_LOGS, {
        action: 'referral_cycle_completed', target_id: sponsorUserId, target_type: 'user',
        admin_id: adminEmail || 'system', details: { cycleNumber, referralCount: currentCount, totalReferrals, deactivatedBy: 'automatic' }, created_at: now,
      });
    } catch {}

    try {
      await addDoc(COL_CYCLE_HISTORY, {
        user_id: sponsorUserId, cycle_type: 'referral', cycle_number: cycleNumber,
        action: 'completed', details: { referralCount: currentCount, totalReferrals, referredUserId: referralUserId },
        admin_id: adminEmail || 'system', created_at: now,
      });
    } catch {}

    try { broadcast('userUpdated', { userId: sponsorUserId, event: 'referral_cycle_completed', cycleNumber }); } catch {}
  }

  await updateDoc(COL_USERS, sponsorUserId, updates);
  return { deactivated: limitReached, currentCount, totalReferrals, cycleNumber };
}

async function onTopupApproved(userId, topupId, amount, adminEmail) {
  const now = new Date().toISOString();
  const user = await getDoc(COL_USERS, userId);
  if (!user) return { deactivated: false };

  const referralCode = user.referral_code;
  if (!referralCode) return { deactivated: false };

  const downlines = await runQuery(COL_USERS, [
    { field: 'referred_by', op: 'EQUAL', value: referralCode },
  ], { limit: 100 });

  if (!downlines || downlines.length === 0) return { deactivated: false };

  const downlineIds = downlines.map(d => d.id);
  const downlineTopups = await runQuery('topups', [
    { field: 'user_id', op: 'IN', value: downlineIds },
    { field: 'status', op: 'EQUAL', value: 'approved' },
  ], { limit: 100 });

  const topupByUser = {};
  for (const t of downlineTopups) {
    if (!topupByUser[t.user_id]) topupByUser[t.user_id] = true;
  }
  const downlinesWithTopup = Object.keys(topupByUser).length;
  const allDownlinesToppedUp = downlinesWithTopup >= downlines.length;

  if (allDownlinesToppedUp && !user.sponsor_topup_completed) {
    const cycleNumber = user.topup_cycle_number || 1;

    const updates = {
      account_status: 'inactive',
      inactive_reason: INACTIVE_REASONS.TOPUP_CYCLE_COMPLETED,
      inactive_at: now,
      sponsor_topup_completed: true,
      sponsor_awaiting_credit: true,
    };

    await updateDoc(COL_USERS, userId, updates);

    try {
      await addDoc(COL_NOTIFICATIONS, {
        receiverId: userId, title: 'Topup Cycle Completed',
        message: 'Your topup cycle #' + cycleNumber + ' is complete. All downlines topped up and your topup is approved. Account inactive pending admin reactivation.',
        type: 'topup_cycle_completed', status: 'unread', createdAt: now, senderId: 'system', senderName: 'System',
      });
    } catch {}

    try {
      await addDoc(COL_NOTIFICATIONS, {
        receiverId: 'admin', title: 'Topup Cycle Completed',
        message: 'User ' + (user.name || userId) + ' completed topup cycle #' + cycleNumber + '. All ' + downlines.length + ' downlines topped up. Awaiting reactivation.',
        type: 'topup_cycle_completed_admin', status: 'unread', createdAt: now, senderId: userId, senderName: user.name || 'User',
      });
    } catch {}

    try {
      await addDoc(COL_AUDIT_LOGS, {
        action: 'topup_cycle_completed', target_id: userId, target_type: 'user',
        admin_id: adminEmail || 'system', details: { cycleNumber, downlineCount: downlines.length, downlinesWithTopup, topupId, amount }, created_at: now,
      });
    } catch {}

    try {
      await addDoc(COL_CYCLE_HISTORY, {
        user_id: userId, cycle_type: 'topup', cycle_number: cycleNumber,
        action: 'completed', details: { downlineCount: downlines.length, downlinesWithTopup, topupId, amount },
        admin_id: adminEmail || 'system', created_at: now,
      });
    } catch {}

    try { broadcast('userUpdated', { userId, event: 'topup_cycle_completed', cycleNumber }); } catch {}

    for (const inc of await runQuery('topup_referral_income', [
      { field: 'user_id', op: 'EQUAL', value: userId },
      { field: 'status', op: 'EQUAL', value: 'locked' },
    ], { limit: 100 })) {
      await updateDoc('topup_referral_income', inc.id, { status: 'eligible' }).catch(() => {});
    }

    return { deactivated: true, cycleNumber, downlinesWithTopup, downlineTotal: downlines.length };
  }

  if (!allDownlinesToppedUp && !user.sponsor_topup_pending) {
    await updateDoc(COL_USERS, userId, { sponsor_topup_pending: true });

    try {
      await addDoc(COL_NOTIFICATIONS, {
        receiverId: 'admin', title: 'Sponsor Topup Pending',
        message: (user.name || userId) + ': ' + downlinesWithTopup + '/' + downlines.length + ' downlines have topped up. Sponsor topup is pending.',
        type: 'sponsor_topup_pending', status: 'unread', createdAt: now, senderId: userId, senderName: user.name || 'User',
      });
    } catch {}

    try { broadcast('userUpdated', { userId, event: 'sponsor_topup_pending', downlinesWithTopup, downlineTotal: downlines.length }); } catch {}
  }

  return { deactivated: false, downlinesWithTopup, downlineTotal: downlines.length };
}

async function reactivateUser(userId, adminEmail, reason) {
  const now = new Date().toISOString();
  const user = await getDoc(COL_USERS, userId);
  if (!user) throw new Error('User not found');
  if (user.account_status === 'active') throw new Error('User is already active');

  const prevReason = user.inactive_reason || 'unknown';
  const prevCycleType = prevReason === INACTIVE_REASONS.REFERRAL_LIMIT_COMPLETED ? 'referral' :
    prevReason === INACTIVE_REASONS.TOPUP_CYCLE_COMPLETED ? 'topup' : 'unknown';

  const updates = {
    account_status: 'active',
    inactive_reason: null,
    inactive_at: null,
    reactivated_at: now,
    sponsor_topup_completed: false,
    sponsor_awaiting_credit: false,
    sponsor_topup_pending: false,
    sponsor_credited: false,
    sponsor_credited_amount: 0,
    sponsor_topup_id: null,
    sponsor_topup_amount: 0,
  };

  if (prevCycleType === 'referral') {
    updates.referral_cycle_number = (user.referral_cycle_number || 1) + 1;
    updates.current_cycle_referral_count = 0;
    updates.referrals_count = 0;
    updates.referral_limit_reached = false;
    updates.referral_active = true;
    updates.is_qualified = false;
  } else if (prevCycleType === 'topup') {
    updates.topup_cycle_number = (user.topup_cycle_number || 1) + 1;
    updates.topup_status = 'active';
  } else {
    updates.referral_cycle_number = (user.referral_cycle_number || 1) + 1;
    updates.current_cycle_referral_count = 0;
    updates.referrals_count = 0;
    updates.referral_limit_reached = false;
    updates.referral_active = true;
    updates.is_qualified = false;
  }

  await updateDoc(COL_USERS, userId, updates);

  try {
    await addDoc(COL_NOTIFICATIONS, {
      receiverId: userId, title: 'Account Reactivated',
      message: 'Your account has been reactivated by an administrator. ' + (reason || ''),
      type: 'account_reactivated', status: 'unread', createdAt: now, senderId: adminEmail || 'admin', senderName: adminEmail || 'Admin',
    });
  } catch {}

  try {
    await addDoc(COL_AUDIT_LOGS, {
      action: 'user_reactivated', target_id: userId, target_type: 'user',
      admin_id: adminEmail || 'unknown', details: { previousReason: prevReason, cycleType: prevCycleType, reason: reason || 'Admin reactivation' }, created_at: now,
    });
  } catch {}

  try {
    await addDoc(COL_CYCLE_HISTORY, {
      user_id: userId, cycle_type: prevCycleType, cycle_number: prevCycleType === 'referral' ? (user.referral_cycle_number || 1) : (user.topup_cycle_number || 1),
      action: 'reactivated', details: { previousReason: prevReason, reason: reason || 'Admin reactivation' },
      admin_id: adminEmail || 'unknown', created_at: now,
    });
  } catch {}

  try { broadcast('userUpdated', { userId, event: 'user_reactivated' }); } catch {}

  return { userId, reactivated: true, prevReason, cycleType: prevCycleType };
}

async function getCycleDashboardData() {
  const allUsers = await runQuery(COL_USERS, [], { limit: 10000 });

  const referralMonitor = allUsers
    .filter(u => u.account_status === 'active' && (u.referrals_count > 0 || u.total_referrals > 0))
    .map(u => ({
      id: u.id, name: u.name, email: u.email,
      referral_cycle_number: u.referral_cycle_number || 1,
      current_cycle_referral_count: u.current_cycle_referral_count || 0,
      remaining_slots: Math.max(0, MAX_REFERRALS - (u.current_cycle_referral_count || 0)),
      status: u.account_status,
      total_referrals: u.total_referrals || 0,
      referral_active: u.referral_active !== false,
    }));

  const sponsorTopupPending = allUsers
    .filter(u => u.sponsor_topup_pending && u.account_status === 'active')
    .map(u => ({
      id: u.id, name: u.name, email: u.email,
      sponsor_topup_completed: u.sponsor_topup_completed || false,
      topup_cycle_number: u.topup_cycle_number || 1,
      inactive_reason: u.inactive_reason,
    }));

  const inactiveUsers = allUsers
    .filter(u => u.account_status === 'inactive')
    .map(u => ({
      id: u.id, name: u.name, email: u.email,
      inactive_reason: u.inactive_reason || 'Unknown',
      inactive_at: u.inactive_at,
      referral_cycle_number: u.referral_cycle_number || 1,
      topup_cycle_number: u.topup_cycle_number || 1,
      reactivated_at: u.reactivated_at,
    }));

  const history = await runQuery(COL_CYCLE_HISTORY, [], { limit: 500 });

  const totalActive = allUsers.filter(u => u.account_status === 'active').length;
  const totalInactive = allUsers.filter(u => u.account_status === 'inactive').length;
  const totalReferralCyclesCompleted = history.filter(h => h.cycle_type === 'referral' && h.action === 'completed').length;
  const totalTopupCyclesCompleted = history.filter(h => h.cycle_type === 'topup' && h.action === 'completed').length;

  return {
    referralMonitor,
    sponsorTopupPending,
    inactiveUsers,
    history,
    summary: { totalActive, totalInactive, totalReferralCyclesCompleted, totalTopupCyclesCompleted },
  };
}

async function getUserCycleData(userId) {
  const user = await getDoc(COL_USERS, userId);
  if (!user) return null;

  const referralCode = user.referral_code;
  let downlinesWithTopup = 0;
  let downlineTotal = 0;
  if (referralCode) {
    const downlines = await runQuery(COL_USERS, [
      { field: 'referred_by', op: 'EQUAL', value: referralCode },
    ], { limit: 100 });
    downlineTotal = downlines.length;
    if (downlineTotal > 0) {
      const downlineIds = downlines.map(d => d.id);
      const topups = await runQuery('topups', [
        { field: 'user_id', op: 'IN', value: downlineIds },
        { field: 'status', op: 'EQUAL', value: 'approved' },
      ], { limit: 100 });
      const topupSet = new Set(topups.map(t => t.user_id));
      downlinesWithTopup = topupSet.size;
    }
  }

  const history = await runQuery(COL_CYCLE_HISTORY, [
    { field: 'user_id', op: 'EQUAL', value: userId },
  ], { limit: 50 });

  return {
    account_status: user.account_status,
    inactive_reason: user.inactive_reason,
    inactive_at: user.inactive_at,
    reactivated_at: user.reactivated_at,
    referral_cycle_number: user.referral_cycle_number || 1,
    current_cycle_referral_count: user.current_cycle_referral_count || 0,
    remaining_referral_slots: Math.max(0, MAX_REFERRALS - (user.current_cycle_referral_count || 0)),
    total_referrals: user.total_referrals || 0,
    topup_cycle_number: user.topup_cycle_number || 1,
    topup_status: user.topup_status || 'active',
    sponsor_topup_pending: user.sponsor_topup_pending || false,
    sponsor_topup_completed: user.sponsor_topup_completed || false,
    downlinesWithTopup,
    downlineTotal,
    history,
  };
}

module.exports = {
  INACTIVE_REASONS,
  INACTIVE_MESSAGES,
  onReferralApproved,
  onTopupApproved,
  reactivateUser,
  getCycleDashboardData,
  getUserCycleData,
};
