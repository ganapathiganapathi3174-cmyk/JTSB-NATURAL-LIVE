const { COL_USERS, COL_UPI_PAYMENTS, COL_TOPUPS, COL_VERIFICATION_LOGS, COL_WALLET_BALANCES, COL_WALLET_TX, COL_TOPUP_INCOME, COL_REFERRALS, COL_NOTIFICATIONS, COL_CHAT_MESSAGES, COL_CHAT_CONVOS, COL_UNIQUES, COL_PENDING_REGS, COL_SPONSOR_DATA, COL_PROCESSED_PAYMENTS, COL_SESSIONS, COL_AUDIT_LOGS, COL_SPONSOR_CLAIMS, COL_TOPUP_AUDIT_LOG, COL_SPONSOR_TRANSFERS, COL_DELETION_AUDIT_LOGS, isSystemReferralCode, SYSTEM_REFERRAL_CODES } = require('../api/_shared.js');
const { getDoc, runQuery, deleteDoc, addDoc, updateDoc } = require('../api/_supabase.js');
const r2 = require('../api/_r2.js');

const COL_UPGRADE_REQUESTS = 'upgrade_requests';
const COL_PAYMENT_AI_LOGS = 'payment_ai_logs';

async function deleteFilesFromStorage(urls) {
  const deleted = [];
  for (const url of urls) {
    if (!url) continue;
    try {
      const r2Domain = process.env.R2_PUBLIC_DOMAIN;
      if (r2Domain && url.includes(r2Domain)) {
        const key = url.split('/').slice(3).join('/').split('?')[0];
        if (key) { await r2.deleteFile(key); deleted.push('r2:' + key); }
      }
    } catch {}
  }
  return deleted;
}

async function deleteMatching(table, field, value) {
  try {
    const docs = await runQuery(table, [{ field, op: 'EQUAL', value }]);
    const ids = [];
    for (const d of docs) {
      try { await deleteDoc(table, d.id); ids.push(d.id); } catch (e) { console.error(`[permanentDelete] ${table}/${field} delete failed:`, e.message); }
    }
    return ids;
  } catch { return []; }
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

    const user = await getDoc(COL_USERS, userId);
    if (!user) {
      res.writeHead(404); res.end(JSON.stringify({ error: 'User not found' }));
      return;
    }

    const referralCode = (user.referral_code || '').toUpperCase();
    if (referralCode && SYSTEM_REFERRAL_CODES.includes(referralCode)) {
      res.writeHead(403); res.end(JSON.stringify({
        error: 'Cannot delete system user',
        detail: `User ${user.email} is a system account (${referralCode}) and is protected from deletion.`,
      }));
      return;
    }

    const adminIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const adminInfo = {
      adminId: req.admin.adminId || req.admin.email || 'admin',
      adminName: req.admin.adminName || req.admin.name || 'Admin',
      adminEmail: req.admin.email || '',
      adminIp,
    };

    const result = {
      deleted: {},
      storageCleaned: [],
      errors: [],
    };

    const allScreenshotUrls = [];
    try {
      const payments = await runQuery(COL_UPI_PAYMENTS, [{ field: 'user_id', op: 'EQUAL', value: userId }], { limit: 500 });
      for (const p of payments) { if (p.screenshot_url) allScreenshotUrls.push(p.screenshot_url); }
    } catch {}
    try {
      const topups = await runQuery(COL_TOPUPS, [{ field: 'user_id', op: 'EQUAL', value: userId }], { limit: 500 });
      for (const t of topups) { if (t.screenshot_url) allScreenshotUrls.push(t.screenshot_url); }
    } catch {}

    const referrals = await deleteMatching(COL_REFERRALS, 'user_id', userId);
    if (referrals.length) result.deleted.referrals = referrals.length;

    const topups = await deleteMatching(COL_TOPUPS, 'user_id', userId);
    if (topups.length) result.deleted.topups = topups.length;

    const topupIncome = await deleteMatching(COL_TOPUP_INCOME, 'user_id', userId);
    if (topupIncome.length) result.deleted.topupIncome = topupIncome.length;

    const topupIncomeFrom = await deleteMatching(COL_TOPUP_INCOME, 'from_user_id', userId);
    if (topupIncomeFrom.length) result.deleted.topupIncomeFrom = topupIncomeFrom.length;

    const notificationsByUser = await deleteMatching(COL_NOTIFICATIONS, 'user_id', userId);
    const notificationsByReceiver = await deleteMatching(COL_NOTIFICATIONS, 'receiverId', userId);
    const notificationsBySender = await deleteMatching(COL_NOTIFICATIONS, 'senderId', userId);
    const totalNotifs = notificationsByUser.length + notificationsByReceiver.length + notificationsBySender.length;
    if (totalNotifs) result.deleted.notifications = totalNotifs;

    const walletTx = await deleteMatching(COL_WALLET_TX, 'user_id', userId);
    if (walletTx.length) result.deleted.walletTransactions = walletTx.length;

    const upiPayments = await deleteMatching(COL_UPI_PAYMENTS, 'user_id', userId);
    if (upiPayments.length) result.deleted.upiPayments = upiPayments.length;

    const processedPayments = await deleteMatching(COL_PROCESSED_PAYMENTS, 'user_id', userId);
    if (processedPayments.length) result.deleted.processedPayments = processedPayments.length;

    const verificationLogs = await deleteMatching(COL_VERIFICATION_LOGS, 'user_id', userId);
    if (verificationLogs.length) result.deleted.verificationLogs = verificationLogs.length;

    const paymentAiLogs = await deleteMatching(COL_PAYMENT_AI_LOGS, 'user_id', userId);
    if (paymentAiLogs.length) result.deleted.paymentAiLogs = paymentAiLogs.length;

    const upgradeRequests = await deleteMatching(COL_UPGRADE_REQUESTS, 'user_id', userId);
    if (upgradeRequests.length) result.deleted.upgradeRequests = upgradeRequests.length;

    const sponsorData = await deleteMatching(COL_SPONSOR_DATA, 'user_id', userId);
    if (sponsorData.length) result.deleted.sponsorData = sponsorData.length;

    const pendingRegs = await deleteMatching(COL_PENDING_REGS, 'user_id', userId);
    if (pendingRegs.length) result.deleted.pendingRegistrations = pendingRegs.length;

    const paymentSessions = await deleteMatching(COL_SESSIONS, 'user_id', userId);
    if (paymentSessions.length) result.deleted.paymentSessions = paymentSessions.length;

    const auditLogsTarget = await deleteMatching(COL_AUDIT_LOGS, 'target_id', userId);
    if (auditLogsTarget.length) result.deleted.auditLogs = auditLogsTarget.length;

    const deletionAuditLogs = await deleteMatching(COL_DELETION_AUDIT_LOGS, 'deleted_record_id', userId);
    if (deletionAuditLogs.length) result.deleted.deletionAuditLogs = deletionAuditLogs.length;

    const sponsorClaims = await deleteMatching(COL_SPONSOR_CLAIMS, 'sponsor_id', userId);
    if (sponsorClaims.length) result.deleted.sponsorClaims = sponsorClaims.length;

    const sponsorTransfers = await deleteMatching(COL_SPONSOR_TRANSFERS, 'user_id', userId);
    if (sponsorTransfers.length) result.deleted.sponsorTransfers = sponsorTransfers.length;

    if (topups.length) {
      try {
        let topupAuditCount = 0;
        for (const tid of topups) {
          const entries = await runQuery(COL_TOPUP_AUDIT_LOG, [{ field: 'topupId', op: 'EQUAL', value: tid }], { limit: 100 });
          for (const e of entries) {
            try { await deleteDoc(COL_TOPUP_AUDIT_LOG, e.id); topupAuditCount++; } catch {}
          }
        }
        if (topupAuditCount) result.deleted.topupAuditLogs = topupAuditCount;
      } catch {}
    }

    try {
      await deleteDoc(COL_WALLET_BALANCES, userId);
      result.deleted.walletBalance = 1;
    } catch {}

    const convoId = 'admin_' + userId;
    try {
      const msgs = await runQuery(COL_CHAT_MESSAGES, [{ field: 'convo_id', op: 'EQUAL', value: convoId }]);
      let msgCount = 0;
      for (const m of msgs) { try { await deleteDoc(COL_CHAT_MESSAGES, m.id); msgCount++; } catch {} }
      if (msgCount) result.deleted.chatMessages = msgCount;
    } catch {}
    try {
      await deleteDoc(COL_CHAT_CONVOS, convoId);
      result.deleted.chatConversation = 1;
    } catch {}

    const email = user.email || '';
    const phone = user.phone || '';
    if (email) {
      try { await deleteDoc(COL_UNIQUES, 'email:' + email.toLowerCase().trim()); result.deleted.emailUnique = 1; } catch {}
    }
    if (phone) {
      try { await deleteDoc(COL_UNIQUES, 'phone:' + phone.trim()); result.deleted.phoneUnique = 1; } catch {}
    }

    const storageDeleted = await deleteFilesFromStorage(allScreenshotUrls);
    if (storageDeleted.length) result.storageCleaned = storageDeleted;

    try {
      await deleteDoc(COL_USERS, userId);
      result.deleted.user = 1;
    } catch (e) {
      result.errors.push('Failed to delete user record: ' + e.message);
      res.writeHead(500); res.end(JSON.stringify({
        error: 'Partial deletion failure. Some records may have been deleted.',
        result,
      }));
      return;
    }

    if (user.referred_by) {
      try {
        const refs = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: user.referred_by }]);
        for (const r of refs) {
          const count = Math.max(0, (r.referrals_count || 0) - 1);
          try { await updateDoc(COL_USERS, r.id, { referrals_count: count }); } catch {}
        }
      } catch {}
    }

    const totalDeleted = Object.values(result.deleted).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);

    try {
      await addDoc(COL_DELETION_AUDIT_LOGS, {
        admin_id: adminInfo.adminId,
        admin_name: adminInfo.adminName,
        admin_email: adminInfo.adminEmail,
        admin_ip: adminInfo.adminIp,
        deleted_record_id: userId,
        record_type: 'user',
        reason: reason.trim(),
        collection: COL_USERS,
        deleted_count: totalDeleted,
        deleted_records: JSON.stringify(result.deleted),
        user_name: user.name || 'Unknown',
        user_email: user.email || '',
        user_phone: user.phone || '',
        user_plan: user.membership_type || user.membership_paid || '',
        deleted_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      });
    } catch (e) {
      console.error('[permanentDelete] Audit log write failed:', e.message);
    }

    console.log(`[permanentDelete] User ${userId} (${user.email}) deleted by ${adminInfo.adminName}. Total records: ${totalDeleted}`);

    res.writeHead(200); res.end(JSON.stringify({
      success: true,
      message: `User permanently deleted. Removed ${totalDeleted} records across ${Object.keys(result.deleted).length} tables.`,
      result,
      deletedUser: {
        id: userId,
        name: user.name,
        email: user.email,
      },
      duration: Date.now() - startTime,
    }));
  } catch (err) {
    console.error('[permanentDelete] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
