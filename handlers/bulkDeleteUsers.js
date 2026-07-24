const { COL_DELETION_AUDIT_LOGS, COL_USERS, COL_UPI_PAYMENTS, COL_TOPUPS, COL_VERIFICATION_LOGS, COL_WALLET_BALANCES, COL_WALLET_TX, COL_TOPUP_INCOME, COL_REFERRALS, COL_NOTIFICATIONS, COL_CHAT_MESSAGES, COL_CHAT_CONVOS, COL_UNIQUES, COL_PENDING_REGS, COL_SPONSOR_DATA, COL_PROCESSED_PAYMENTS, COL_SESSIONS, COL_AUDIT_LOGS, COL_SPONSOR_CLAIMS, COL_TOPUP_AUDIT_LOG, COL_SPONSOR_TRANSFERS, COL_UPGRADE_REQUESTS, COL_PAYMENT_AI_LOGS } = require('../api/_shared.js');
const { deleteDoc, getDoc, runQuery, addDoc, updateDoc } = require('../api/_supabase.js');
const r2 = require('../api/_r2.js');

async function deleteFilesFromStorage(urls) {
  const storageFiles = [];
  for (const url of urls) {
    if (!url) continue;
    try {
      const r2Domain = process.env.R2_PUBLIC_DOMAIN;
      if (r2Domain && url.includes(r2Domain)) {
        const key = url.split('/').slice(3).join('/').split('?')[0];
        if (key) { await r2.deleteFile(key); storageFiles.push('r2:' + key); }
        continue;
      }
    } catch {}
  }
  return storageFiles;
}

async function deleteMatching(table, field, value) {
  try {
    const docs = await runQuery(table, [{ field, op: 'EQUAL', value }]);
    const ids = [];
    for (const d of docs) { try { await deleteDoc(table, d.id); ids.push(d.id); } catch {} }
    return ids;
  } catch { return []; }
}

async function deleteUserCascade(userId, reason, adminInfo) {
  const result = { deletedRecords: [], deletedStorage: [], errors: [], totalCount: 0 };
  const user = await getDoc(COL_USERS, userId);
  if (!user) return { ...result, error: 'User not found' };

  const email = user.email || '';
  const phone = user.phone || '';
  const startTime = Date.now();

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
  if (referrals.length) result.deletedRecords.push({ table: COL_REFERRALS, ids: referrals });
  const topups = await deleteMatching(COL_TOPUPS, 'user_id', userId);
  if (topups.length) result.deletedRecords.push({ table: COL_TOPUPS, ids: topups });
  const topupIncome = await deleteMatching(COL_TOPUP_INCOME, 'user_id', userId);
  if (topupIncome.length) result.deletedRecords.push({ table: COL_TOPUP_INCOME, ids: topupIncome });
  const topupIncomeFrom = await deleteMatching(COL_TOPUP_INCOME, 'from_user_id', userId);
  if (topupIncomeFrom.length) result.deletedRecords.push({ table: COL_TOPUP_INCOME + '(from_user_id)', ids: topupIncomeFrom });
  const notifications = await deleteMatching(COL_NOTIFICATIONS, 'user_id', userId);
  if (notifications.length) result.deletedRecords.push({ table: COL_NOTIFICATIONS, ids: notifications });
  const notificationsByReceiver = await deleteMatching(COL_NOTIFICATIONS, 'receiverId', userId);
  if (notificationsByReceiver.length) result.deletedRecords.push({ table: COL_NOTIFICATIONS + '(receiverId)', ids: notificationsByReceiver });
  const notificationsBySender = await deleteMatching(COL_NOTIFICATIONS, 'senderId', userId);
  if (notificationsBySender.length) result.deletedRecords.push({ table: COL_NOTIFICATIONS + '(senderId)', ids: notificationsBySender });
  const walletTx = await deleteMatching(COL_WALLET_TX, 'user_id', userId);
  if (walletTx.length) result.deletedRecords.push({ table: COL_WALLET_TX, ids: walletTx });
  const upiPayments = await deleteMatching(COL_UPI_PAYMENTS, 'user_id', userId);
  if (upiPayments.length) result.deletedRecords.push({ table: COL_UPI_PAYMENTS, ids: upiPayments });
  const processedPayments = await deleteMatching(COL_PROCESSED_PAYMENTS, 'user_id', userId);
  if (processedPayments.length) result.deletedRecords.push({ table: COL_PROCESSED_PAYMENTS, ids: processedPayments });
  const verificationLogs = await deleteMatching(COL_VERIFICATION_LOGS, 'user_id', userId);
  if (verificationLogs.length) result.deletedRecords.push({ table: COL_VERIFICATION_LOGS, ids: verificationLogs });
  const sponsorData = await deleteMatching(COL_SPONSOR_DATA, 'user_id', userId);
  if (sponsorData.length) result.deletedRecords.push({ table: COL_SPONSOR_DATA, ids: sponsorData });
  const pendingRegs = await deleteMatching(COL_PENDING_REGS, 'user_id', userId);
  if (pendingRegs.length) result.deletedRecords.push({ table: COL_PENDING_REGS, ids: pendingRegs });

  // CRITICAL: Also delete pending_registrations by email and phone (orphaned records block re-registration)
  if (email) {
    const pendingByEmail = await deleteMatching(COL_PENDING_REGS, 'email', email.toLowerCase().trim());
    if (pendingByEmail.length) result.deletedRecords.push({ table: COL_PENDING_REGS + '(email)', ids: pendingByEmail });
  }
  if (phone) {
    const pendingByPhone = await deleteMatching(COL_PENDING_REGS, 'phone', phone.trim());
    if (pendingByPhone.length) result.deletedRecords.push({ table: COL_PENDING_REGS + '(phone)', ids: pendingByPhone });
  }

  // Clean upgrade_requests and payment_ai_logs
  const upgradeRequests = await deleteMatching(COL_UPGRADE_REQUESTS, 'user_id', userId);
  if (upgradeRequests.length) result.deletedRecords.push({ table: COL_UPGRADE_REQUESTS, ids: upgradeRequests });
  const paymentAiLogs = await deleteMatching(COL_PAYMENT_AI_LOGS, 'user_id', userId);
  if (paymentAiLogs.length) result.deletedRecords.push({ table: COL_PAYMENT_AI_LOGS, ids: paymentAiLogs });
  const paymentSessions = await deleteMatching(COL_SESSIONS, 'user_id', userId);
  if (paymentSessions.length) result.deletedRecords.push({ table: COL_SESSIONS, ids: paymentSessions });
  const auditLogs = await deleteMatching(COL_AUDIT_LOGS, 'target_id', userId);
  if (auditLogs.length) result.deletedRecords.push({ table: COL_AUDIT_LOGS, ids: auditLogs });
  const deletionAuditLogs = await deleteMatching(COL_DELETION_AUDIT_LOGS, 'deleted_record_id', userId);
  if (deletionAuditLogs.length) result.deletedRecords.push({ table: COL_DELETION_AUDIT_LOGS + '(deleted_record_id)', ids: deletionAuditLogs });
  const sponsorClaims = await deleteMatching(COL_SPONSOR_CLAIMS, 'sponsor_id', userId);
  if (sponsorClaims.length) result.deletedRecords.push({ table: COL_SPONSOR_CLAIMS, ids: sponsorClaims });
  const sponsorTransfers = await deleteMatching(COL_SPONSOR_TRANSFERS, 'user_id', userId);
  if (sponsorTransfers.length) result.deletedRecords.push({ table: COL_SPONSOR_TRANSFERS, ids: sponsorTransfers });
  if (topups.length) {
    try {
      const topupAuditIds = [];
      for (const tid of topups) {
        const entries = await runQuery(COL_TOPUP_AUDIT_LOG, [{ field: 'topupId', op: 'EQUAL', value: tid }], { limit: 100 });
        for (const e of entries) {
          try { await deleteDoc(COL_TOPUP_AUDIT_LOG, e.id); topupAuditIds.push(e.id); } catch {}
        }
      }
      if (topupAuditIds.length) result.deletedRecords.push({ table: COL_TOPUP_AUDIT_LOG, ids: topupAuditIds });
    } catch (e) { console.error('[bulkDeleteUsers] Cascade delete topup_audit_log error:', e.message); }
  }
  try { await deleteDoc(COL_WALLET_BALANCES, userId); result.deletedRecords.push({ table: COL_WALLET_BALANCES, ids: [userId] }); } catch {}

  const convoId = 'admin_' + userId;
  try {
    const msgs = await runQuery(COL_CHAT_MESSAGES, [{ field: 'convo_id', op: 'EQUAL', value: convoId }]);
    const msgIds = [];
    for (const m of msgs) { try { await deleteDoc(COL_CHAT_MESSAGES, m.id); msgIds.push(m.id); } catch {} }
    if (msgIds.length) result.deletedRecords.push({ table: COL_CHAT_MESSAGES, ids: msgIds });
  } catch {}
  try { await deleteDoc(COL_CHAT_CONVOS, convoId); result.deletedRecords.push({ table: COL_CHAT_CONVOS, ids: [convoId] }); } catch {}

  if (email) { try { await deleteDoc(COL_UNIQUES, 'email:' + email.toLowerCase().trim()); result.deletedRecords.push({ table: COL_UNIQUES + '(email)', ids: [email] }); } catch {} }
  if (phone) { try { await deleteDoc(COL_UNIQUES, 'phone:' + phone.trim()); result.deletedRecords.push({ table: COL_UNIQUES + '(phone)', ids: [phone] }); } catch {} }

  const storageDeleted = await deleteFilesFromStorage(allScreenshotUrls);
  if (storageDeleted.length) result.deletedStorage = storageDeleted;

  try { await deleteDoc(COL_USERS, userId); result.deletedRecords.push({ table: COL_USERS, ids: [userId] }); } catch (e) { return { ...result, error: 'Failed to delete user document: ' + e.message }; }

  if (user.referred_by) {
    try {
      const refs = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: user.referred_by }]);
      for (const r of refs) {
        const count = Math.max(0, (r.referrals_count || 0) - 1);
        try { await updateDoc(COL_USERS, r.id, { referrals_count: count }); } catch {}
      }
    } catch {}
  }

  result.totalCount = result.deletedRecords.reduce((sum, r) => sum + r.ids.length, 0) + result.deletedStorage.length;
  result.duration = Date.now() - startTime;

  try {
    await addDoc(COL_DELETION_AUDIT_LOGS, {
      admin_id: adminInfo?.adminId || 'admin',
      admin_name: adminInfo?.adminName || 'Admin',
      deleted_record_id: userId,
      record_type: 'user',
      reason: reason || 'No reason provided',
      collection: COL_USERS,
      deleted_count: result.totalCount,
      deleted_at: new Date().toISOString(),
    });
  } catch {}

  return result;
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(200).end(); return; }
    if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

    const { userIds, reason, adminName } = req.body || {};
    if (!req.admin) { res.writeHead(401); res.end(JSON.stringify({ error: 'Authentication required' })); return; }
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) { res.writeHead(400); res.end(JSON.stringify({ error: 'userIds array is required' })); return; }
    if (!reason || !reason.trim()) { res.writeHead(400); res.end(JSON.stringify({ error: 'Reason is required' })); return; }

    const adminInfo = { adminId: req.admin.adminId || 'admin', adminName: adminName || req.admin.adminName || 'Admin' };
    const results = [];

    for (const userId of userIds) {
      try {
        const result = await deleteUserCascade(userId.trim(), reason.trim(), adminInfo);
        results.push({ userId, success: !result.error, error: result.error || null, totalCount: result.totalCount || 0 });
      } catch (err) {
        console.error('[bulkDeleteUsers] Cascade error for user', userId, ':', err.message);
        results.push({ userId, success: false, error: 'Deletion failed' });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    const totalDeleted = results.reduce((sum, r) => sum + (r.totalCount || 0), 0);

    res.writeHead(200); res.end(JSON.stringify({
      success: true,
      results,
      summary: { total: userIds.length, successCount, failCount, totalDeleted },
    }));
  } catch (err) {
    console.error('[bulkDeleteUsers] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};