const {
  COL_USERS, COL_UPI_PAYMENTS, COL_TOPUPS, COL_VERIFICATION_LOGS,
  COL_WALLET_BALANCES, COL_WALLET_TX, COL_TOPUP_INCOME, COL_REFERRALS,
  COL_NOTIFICATIONS, COL_CHAT_MESSAGES, COL_CHAT_CONVOS, COL_UNIQUES,
  COL_PENDING_REGS, COL_SPONSOR_DATA, COL_PROCESSED_PAYMENTS, COL_SESSIONS,
  COL_AUDIT_LOGS, COL_SPONSOR_CLAIMS, COL_TOPUP_AUDIT_LOG, COL_SPONSOR_TRANSFERS,
  COL_DELETION_AUDIT_LOGS, SYSTEM_REFERRAL_CODES,
} = require('../api/_shared.js');
const { getDoc, runQuery, deleteDoc, addDoc, updateDoc } = require('../api/_supabase.js');
const r2 = require('../api/_r2.js');

const COL_UPGRADE_REQUESTS = 'upgrade_requests';
const COL_PAYMENT_AI_LOGS = 'payment_ai_logs';

function log(msg) {
  console.log(`[CASCADE-DELETE] ${msg}`);
}

function now() {
  return new Date().toISOString();
}

async function deleteByField(table, field, value) {
  try {
    const docs = await runQuery(table, [{ field, op: 'EQUAL', value }], { limit: 1000 });
    const ids = [];
    for (const d of docs) {
      try { await deleteDoc(table, d.id); ids.push(d.id); } catch (e) { log(`deleteByField ${table}.${field}=${value} id=${d.id}: ${e.message}`); }
    }
    return ids;
  } catch (e) {
    log(`deleteByField query ${table} ${field}=${value}: ${e.message}`);
    return [];
  }
}

async function deleteR2Files(urls) {
  const deleted = [];
  const r2Domain = process.env.R2_PUBLIC_DOMAIN;
  if (!r2Domain) return deleted;
  for (const url of urls) {
    if (!url || !url.includes(r2Domain)) continue;
    try {
      const key = url.split('/').slice(3).join('/').split('?')[0];
      if (key) { await r2.deleteFile(key); deleted.push(key); }
    } catch {}
  }
  return deleted;
}

async function cascadeDeleteUser(userId, reason, adminInfo) {
  const phases = [];
  const errors = [];
  let user = null;

  function phase(name, fn) {
    return async () => {
      const start = Date.now();
      try {
        const result = await fn();
        phases.push({ phase: name, duration: Date.now() - start, status: 'ok', count: result?.count ?? 0, detail: result?.detail || null });
        return result;
      } catch (e) {
        phases.push({ phase: name, duration: Date.now() - start, status: 'error', error: e.message });
        errors.push({ phase: name, error: e.message });
        return null;
      }
    };
  }

  const execPhases = async (phaseList) => {
    for (const fn of phaseList) {
      await fn();
    }
  };

  let allScreenshotUrls = [];
  let deletedCounts = {};

  const p1 = phase('1-lookup-user', async () => {
    user = await getDoc(COL_USERS, userId);
    if (!user) { throw new Error('User not found'); }
    if (SYSTEM_REFERRAL_CODES.includes((user.referral_code || '').toUpperCase())) {
      throw new Error('Cannot delete system user');
    }
    return { detail: `${user.name || ''} (${user.email || ''})` };
  });

  const p2 = phase('2-collect-screenshots', async () => {
    let urls = [];
    const payments = await runQuery(COL_UPI_PAYMENTS, [{ field: 'user_id', op: 'EQUAL', value: userId }], { limit: 500 });
    for (const p of payments) { if (p.screenshot_url) urls.push(p.screenshot_url); }
    const topups = await runQuery(COL_TOPUPS, [{ field: 'user_id', op: 'EQUAL', value: userId }], { limit: 500 });
    for (const t of topups) { if (t.screenshot_url) urls.push(t.screenshot_url); }
    allScreenshotUrls = urls;
    return { count: urls.length };
  });

  const p3 = phase('3-delete-referrals', async () => {
    const ids = await deleteByField(COL_REFERRALS, 'user_id', userId);
    deletedCounts.referrals = ids.length;
    return { count: ids.length };
  });

  const p4 = phase('4-delete-topups', async () => {
    const ids = await deleteByField(COL_TOPUPS, 'user_id', userId);
    deletedCounts.topups = ids.length;
    return { count: ids.length, topupIds: ids };
  });

  const p5 = phase('5-delete-topup-income', async () => {
    const ids = await deleteByField(COL_TOPUP_INCOME, 'user_id', userId);
    const idsFrom = await deleteByField(COL_TOPUP_INCOME, 'from_user_id', userId);
    deletedCounts.topupIncome = ids.length + idsFrom.length;
    return { count: ids.length + idsFrom.length };
  });

  const p6 = phase('6-delete-notifications', async () => {
    const idsByUser = await deleteByField(COL_NOTIFICATIONS, 'user_id', userId);
    const idsByReceiver = await deleteByField(COL_NOTIFICATIONS, 'receiverId', userId);
    const idsBySender = await deleteByField(COL_NOTIFICATIONS, 'senderId', userId);
    deletedCounts.notifications = idsByUser.length + idsByReceiver.length + idsBySender.length;
    return { count: idsByUser.length + idsByReceiver.length + idsBySender.length };
  });

  const p7 = phase('7-delete-wallet-tx', async () => {
    const ids = await deleteByField(COL_WALLET_TX, 'user_id', userId);
    deletedCounts.walletTransactions = ids.length;
    return { count: ids.length };
  });

  const p8 = phase('8-delete-upi-payments', async () => {
    const ids = await deleteByField(COL_UPI_PAYMENTS, 'user_id', userId);
    deletedCounts.upiPayments = ids.length;
    return { count: ids.length };
  });

  const p9 = phase('9-delete-processed-payments', async () => {
    const ids = await deleteByField(COL_PROCESSED_PAYMENTS, 'user_id', userId);
    deletedCounts.processedPayments = ids.length;
    return { count: ids.length };
  });

  const p10 = phase('10-delete-verification-logs', async () => {
    const ids = await deleteByField(COL_VERIFICATION_LOGS, 'user_id', userId);
    deletedCounts.verificationLogs = ids.length;
    return { count: ids.length };
  });

  const p11 = phase('11-delete-payment-ai-logs', async () => {
    const ids = await deleteByField(COL_PAYMENT_AI_LOGS, 'user_id', userId);
    deletedCounts.paymentAiLogs = ids.length;
    return { count: ids.length };
  });

  const p12 = phase('12-delete-upgrade-requests', async () => {
    const ids = await deleteByField(COL_UPGRADE_REQUESTS, 'user_id', userId);
    deletedCounts.upgradeRequests = ids.length;
    return { count: ids.length };
  });

  const p13 = phase('13-delete-sponsor-data', async () => {
    const ids = await deleteByField(COL_SPONSOR_DATA, 'user_id', userId);
    deletedCounts.sponsorData = ids.length;
    return { count: ids.length };
  });

  const p14 = phase('14-delete-pending-registrations', async () => {
    const idsByUser = await deleteByField(COL_PENDING_REGS, 'user_id', userId);
    const idsByEmail = user?.email ? await deleteByField(COL_PENDING_REGS, 'email', user.email.toLowerCase().trim()) : [];
    const idsByPhone = user?.phone ? await deleteByField(COL_PENDING_REGS, 'phone', user.phone.trim()) : [];
    const all = new Set([...idsByUser, ...idsByEmail, ...idsByPhone]);
    deletedCounts.pendingRegistrations = all.size;
    return { count: all.size };
  });

  const p15 = phase('15-delete-payment-sessions', async () => {
    const ids = await deleteByField(COL_SESSIONS, 'user_id', userId);
    deletedCounts.paymentSessions = ids.length;
    return { count: ids.length };
  });

  const p16 = phase('16-delete-audit-logs', async () => {
    const ids = await deleteByField(COL_AUDIT_LOGS, 'target_id', userId);
    deletedCounts.auditLogs = ids.length;
    return { count: ids.length };
  });

  const p17 = phase('17-delete-deletion-audit-logs', async () => {
    const ids = await deleteByField(COL_DELETION_AUDIT_LOGS, 'deleted_record_id', userId);
    deletedCounts.deletionAuditLogs = ids.length;
    return { count: ids.length };
  });

  const p18 = phase('18-delete-sponsor-claims', async () => {
    const ids = await deleteByField(COL_SPONSOR_CLAIMS, 'sponsor_id', userId);
    deletedCounts.sponsorClaims = ids.length;
    return { count: ids.length };
  });

  const p19 = phase('19-delete-sponsor-transfers', async () => {
    const ids = await deleteByField(COL_SPONSOR_TRANSFERS, 'user_id', userId);
    const idsOld = await deleteByField(COL_SPONSOR_TRANSFERS, 'old_sponsor_id', userId);
    const idsNew = await deleteByField(COL_SPONSOR_TRANSFERS, 'new_sponsor_id', userId);
    deletedCounts.sponsorTransfers = ids.length + idsOld.length + idsNew.length;
    return { count: ids.length + idsOld.length + idsNew.length };
  });

  const p20 = phase('20-delete-topup-audit-logs', async () => {
    const p4Result = phases.find(p => p.phase === '4-delete-topups');
    const topupIds = p4Result?.detail?.topupIds || [];
    let count = 0;
    for (const tid of topupIds) {
      const entries = await runQuery(COL_TOPUP_AUDIT_LOG, [{ field: 'topupId', op: 'EQUAL', value: tid }], { limit: 100 });
      for (const e of entries) {
        try { await deleteDoc(COL_TOPUP_AUDIT_LOG, e.id); count++; } catch {}
      }
    }
    deletedCounts.topupAuditLogs = count;
    return { count };
  });

  const p21 = phase('21-delete-wallet-balance', async () => {
    try { await deleteDoc(COL_WALLET_BALANCES, userId); deletedCounts.walletBalance = 1; return { count: 1 }; }
    catch { return { count: 0 }; }
  });

  const p22 = phase('22-delete-chat', async () => {
    const convoId = 'admin_' + userId;
    let msgCount = 0;
    try {
      const msgs = await runQuery(COL_CHAT_MESSAGES, [{ field: 'convo_id', op: 'EQUAL', value: convoId }]);
      for (const m of msgs) { try { await deleteDoc(COL_CHAT_MESSAGES, m.id); msgCount++; } catch {} }
    } catch {}
    try { await deleteDoc(COL_CHAT_CONVOS, convoId); } catch {}
    deletedCounts.chatMessages = msgCount;
    return { count: msgCount };
  });

  const p23 = phase('23-delete-uniques', async () => {
    let count = 0;
    if (user?.email) { try { await deleteDoc(COL_UNIQUES, 'email:' + user.email.toLowerCase().trim()); count++; } catch {} }
    if (user?.phone) { try { await deleteDoc(COL_UNIQUES, 'phone:' + user.phone.trim()); count++; } catch {} }
    deletedCounts.uniques = count;
    return { count };
  });

  const p24 = phase('24-cleanup-storage', async () => {
    const keys = await deleteR2Files(allScreenshotUrls);
    deletedCounts.storageFiles = keys.length;
    return { count: keys.length, detail: keys };
  });

  const p25 = phase('25-delete-user', async () => {
    await deleteDoc(COL_USERS, userId);
    deletedCounts.user = 1;
    return { count: 1 };
  });

  const p26 = phase('26-decrement-referrer', async () => {
    if (!user?.referred_by) return { count: 0 };
    const refs = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: user.referred_by }]);
    for (const r of refs) {
      const count = Math.max(0, (r.referrals_count || 0) - 1);
      await updateDoc(COL_USERS, r.id, { referrals_count: count });
    }
    return { count: refs.length };
  });

  const p27 = phase('27-write-audit-log', async () => {
    const totalDeleted = Object.values(deletedCounts).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);
    await addDoc(COL_DELETION_AUDIT_LOGS, {
      admin_id: adminInfo.adminId,
      admin_name: adminInfo.adminName,
      admin_email: adminInfo.adminEmail,
      deleted_record_id: userId,
      record_type: 'user',
      reason: reason.trim(),
      collection: COL_USERS,
      deleted_count: totalDeleted,
      deleted_records: JSON.stringify(deletedCounts),
      user_name: user?.name || 'Unknown',
      user_email: user?.email || '',
      user_phone: user?.phone || '',
      user_plan: user?.membership_type || user?.membership_paid || '',
      deleted_at: now(),
    });
    return { count: 1, detail: { totalDeleted } };
  });

  await execPhases([p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14, p15, p16, p17, p18, p19, p20, p21, p22, p23, p24, p25, p26, p27]);

  return { phases, errors, deletedCounts, user };
}

module.exports = async (req, res) => {
  const startTime = Date.now();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(200).end(); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  try {
    if (!req.admin) {
      res.writeHead(401); res.end(JSON.stringify({ error: 'Authentication required' }));
      return;
    }

    const { userId, reason } = req.body || {};
    if (!userId) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'userId is required' }));
      return;
    }
    if (!reason || !reason.trim()) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Deletion reason is required' }));
      return;
    }

    const adminInfo = {
      adminId: req.admin.adminId || req.admin.email || 'admin',
      adminName: req.admin.adminName || req.admin.name || 'Admin',
      adminEmail: req.admin.email || '',
    };

    log(`Starting cascade delete for user ${userId} by ${adminInfo.adminName}`);

    const result = await cascadeDeleteUser(userId.trim(), reason.trim(), adminInfo);

    if (result.errors.length > 0) {
      log(`Completed with ${result.errors.length} error(s): ${result.errors.map(e => e.error).join('; ')}`);
    } else {
      log(`Completed successfully — all 27 phases passed`);
    }

    const totalDeleted = Object.values(result.deletedCounts).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);
    const hasCriticalError = result.errors.some(e =>
      ['1-lookup-user', '25-delete-user'].includes(e.phase)
    );

    if (hasCriticalError) {
      res.writeHead(500); res.end(JSON.stringify({
        success: false,
        error: result.errors.find(e => e.phase === '1-lookup-user')?.error || 'Failed to delete user record',
        phases: result.phases,
        errors: result.errors,
        deletedCounts: result.deletedCounts,
        duration: Date.now() - startTime,
      }));
      return;
    }

    res.writeHead(200); res.end(JSON.stringify({
      success: true,
      message: `User permanently deleted. Removed ${totalDeleted} records across ${Object.keys(result.deletedCounts).length} tables.`,
      deletedCounts: result.deletedCounts,
      phases: result.phases,
      errors: result.errors.length ? result.errors : undefined,
      deletedUser: result.user ? { id: result.user.id, name: result.user.name, email: result.user.email } : null,
      duration: Date.now() - startTime,
    }));
  } catch (err) {
    console.error('[cascadeDeleteUser] Unhandled error:', err.message, err.stack);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
