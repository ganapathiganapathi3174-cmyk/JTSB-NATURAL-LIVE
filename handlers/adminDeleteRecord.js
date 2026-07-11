const { COL_DELETION_AUDIT_LOGS, COL_USERS, COL_UPI_PAYMENTS, COL_TOPUPS, COL_VERIFICATION_LOGS, COL_WALLET_BALANCES, COL_WALLET_TX, COL_TOPUP_INCOME, COL_REFERRALS, COL_NOTIFICATIONS, COL_CHAT_MESSAGES, COL_CHAT_CONVOS, COL_UNIQUES, COL_PENDING_REGS, COL_SPONSOR_DATA, COL_PROCESSED_PAYMENTS, COL_SESSIONS, COL_AUDIT_LOGS, COL_SPONSOR_CLAIMS, COL_TOPUP_AUDIT_LOG, COL_SPONSOR_TRANSFERS } = require('../api/_shared.js');
const { deleteDoc, getDoc, runQuery, addDoc, updateDoc } = require('../api/_supabase.js');
const r2 = require('../api/_r2.js');

const SIMPLE_TYPES = { topup: COL_TOPUPS, pending_payment: COL_UPI_PAYMENTS, rejected_payment: COL_UPI_PAYMENTS, verification_log: COL_VERIFICATION_LOGS, test_record: COL_UPI_PAYMENTS, upi_payment: COL_UPI_PAYMENTS, pending_registration: COL_PENDING_REGS };
const LABELS = { topup: 'Topup', upi_payment: 'UPI Payment', verification_log: 'Verification Log', user: 'User' };

function send(res, status, data) {
  try { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); } catch {}
}

async function deleteR2File(url) {
  if (!url) return false;
  try {
    const r2Domain = process.env.R2_PUBLIC_DOMAIN;
    if (r2Domain && url.includes(r2Domain)) {
      const key = url.split('/').slice(3).join('/').split('?')[0];
      if (key) { await r2.deleteFile(key); return true; }
    }
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    if (supabaseUrl && supabaseKey && url.includes(supabaseUrl)) {
      const pathPart = url.split('/storage/v1/object/public/')[1];
      if (pathPart) {
        const bucketAndPath = pathPart.split('?')[0];
        const bucket = bucketAndPath.split('/')[0];
        const filePath = bucketAndPath.substring(bucket.length + 1);
        if (bucket && filePath) {
          const { createClient } = require('@supabase/supabase-js');
          const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
          await supabase.storage.from(bucket).remove([filePath]);
          return true;
        }
      }
    }
  } catch {}
  return false;
}

async function deleteFilesFromStorage(urls) {
  const results = [];
  for (const url of urls) {
    if (!url) continue;
    const ok = await deleteR2File(url);
    if (ok) results.push(url);
  }
  return results;
}

async function deleteMatching(table, field, value) {
  try {
    const docs = await runQuery(table, [{ field, op: 'EQUAL', value }]);
    const ids = [];
    for (const d of docs) {
      try {
        await deleteDoc(table, d.id);
        const verify = await getDoc(table, d.id);
        if (verify) {
          console.error(`[adminDeleteRecord] Post-delete verification FAILED for ${table}/${d.id} — record still exists`);
        } else {
          ids.push(d.id);
        }
      } catch (e) {
        console.error(`[adminDeleteRecord] deleteMatching error for ${table}/${d.id}: ${e.message}`);
      }
    }
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

  // 1. Collect all screenshot URLs from payments and topups before deleting records
  const allScreenshotUrls = [];
  try {
    const payments = await runQuery(COL_UPI_PAYMENTS, [{ field: 'user_id', op: 'EQUAL', value: userId }], { limit: 500 });
    for (const p of payments) {
      if (p.screenshot_url) allScreenshotUrls.push(p.screenshot_url);
    }
  } catch {}
  try {
    const topups = await runQuery(COL_TOPUPS, [{ field: 'user_id', op: 'EQUAL', value: userId }], { limit: 500 });
    for (const t of topups) {
      if (t.screenshot_url) allScreenshotUrls.push(t.screenshot_url);
    }
  } catch {}

  // 2. Delete all associated records
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

  // Additional tables for complete user data purge
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

  // Clean up topup_audit_log using already-collected topup IDs
  if (topups.length) {
    try {
      const topupAuditLogs = [];
      for (const tid of topups) {
        const entries = await runQuery(COL_TOPUP_AUDIT_LOG, [{ field: 'topupId', op: 'EQUAL', value: tid }], { limit: 100 });
        for (const e of entries) {
          try {
            await deleteDoc(COL_TOPUP_AUDIT_LOG, e.id);
            const ve = await getDoc(COL_TOPUP_AUDIT_LOG, e.id);
            if (!ve) topupAuditLogs.push(e.id);
          } catch {}
        }
      }
      if (topupAuditLogs.length) result.deletedRecords.push({ table: COL_TOPUP_AUDIT_LOG, ids: topupAuditLogs });
    } catch (e) { console.error('[adminDeleteRecord] Cascade delete topup_audit_log error:', e.message); }
  }

  try {
    await deleteDoc(COL_WALLET_BALANCES, userId);
    const v = await getDoc(COL_WALLET_BALANCES, userId);
    if (!v) result.deletedRecords.push({ table: COL_WALLET_BALANCES, ids: [userId] });
  } catch {}

  // Chat cleanup
  const convoId = 'admin_' + userId;
  try {
    const msgs = await runQuery(COL_CHAT_MESSAGES, [{ field: 'convo_id', op: 'EQUAL', value: convoId }]);
    const msgIds = [];
    for (const m of msgs) {
      try {
        await deleteDoc(COL_CHAT_MESSAGES, m.id);
        msgIds.push(m.id);
      } catch {}
    }
    if (msgIds.length) result.deletedRecords.push({ table: COL_CHAT_MESSAGES, ids: msgIds });
  } catch {}
  try {
    await deleteDoc(COL_CHAT_CONVOS, convoId);
    result.deletedRecords.push({ table: COL_CHAT_CONVOS, ids: [convoId] });
  } catch {}

  // Uniques cleanup
  if (email) { try { await deleteDoc(COL_UNIQUES, 'email:' + email.toLowerCase().trim()); result.deletedRecords.push({ table: COL_UNIQUES + '(email)', ids: [email] }); } catch {} }
  if (phone) { try { await deleteDoc(COL_UNIQUES, 'phone:' + phone.trim()); result.deletedRecords.push({ table: COL_UNIQUES + '(phone)', ids: [phone] }); } catch {} }

  // 3. Delete storage files (screenshots from upi_payments and topups)
  const storageDeleted = await deleteFilesFromStorage(allScreenshotUrls);
  if (storageDeleted.length) result.deletedStorage = storageDeleted;

  // 4. Delete the user record last
  try {
    await deleteDoc(COL_USERS, userId);
    const verifyUser = await getDoc(COL_USERS, userId);
    if (verifyUser) {
      return { ...result, error: 'Failed to delete user document — record still exists after delete attempt' };
    }
    result.deletedRecords.push({ table: COL_USERS, ids: [userId] });
  } catch (e) {
    return { ...result, error: 'Failed to delete user document: ' + e.message };
  }

  // 5. Update referrer's count
  if (user.referred_by) {
    try {
      const refs = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: user.referred_by }]);
      for (const r of refs) {
        const count = Math.max(0, (r.referrals_count || 0) - 1);
        try { await updateDoc(COL_USERS, r.id, { referrals_count: count }); } catch {}
      }
    } catch {}
  }

  // 6. Write audit log
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
    if (req.method !== 'POST') { send(res, 405, { error: 'Method not allowed' }); return; }

    const { recordId, recordType, reason, adminName } = req.body || {};
    if (!req.admin) { send(res, 401, { error: 'Authentication required. Please re-login as admin.' }); return; }
    if (!recordId || !recordId.trim() || !reason || !reason.trim()) { send(res, 400, { error: 'Missing required fields: recordId, recordType, reason' }); return; }

    const adminInfo = { adminId: req.admin.email || req.admin.adminId || 'admin', adminName: adminName || req.admin.name || 'Admin' };

    if (recordType === 'user') {
      const result = await deleteUserCascade(recordId.trim(), reason.trim(), adminInfo);
      if (result.error) {
        send(res, 404, { error: result.error, deletedRecords: result.deletedRecords, deletedStorage: result.deletedStorage });
        return;
      }
      send(res, 200, {
        success: true,
        message: 'User and all associated data permanently deleted',
        deletedRecords: result.deletedRecords,
        deletedStorage: result.deletedStorage,
        totalCount: result.totalCount,
        duration: result.duration + 'ms',
      });
      return;
    }

    const collection = SIMPLE_TYPES[recordType];
    if (!collection) { send(res, 400, { error: 'Invalid record type. Valid types: ' + Object.keys({ ...SIMPLE_TYPES, user: true }).join(', ') }); return; }

    let deleteId = recordId.trim();
    let screenshotUrl = null;
    let paymentRecord = null;

    // For UPI payments: fetch record first to get screenshot_url and resolve UUID vs UTR
    if (collection === COL_UPI_PAYMENTS) {
      // Try to find by ID first (UUID) — catch invalid UUID syntax
      try { paymentRecord = await getDoc(COL_UPI_PAYMENTS, deleteId); } catch {}
      // If not found by ID, try by UTR
      if (!paymentRecord) {
        const existing = await runQuery(COL_UPI_PAYMENTS, [{ field: 'utr', op: 'EQUAL', value: deleteId }], { limit: 1 });
        if (existing.length) {
          paymentRecord = existing[0];
          deleteId = paymentRecord.id;
        }
      }
      if (!paymentRecord) {
        send(res, 404, { error: 'Payment record not found. It may have been already deleted.' });
        return;
      }
      screenshotUrl = paymentRecord.screenshot_url || null;
    }

    // Delete from database
    try {
      await deleteDoc(collection, deleteId);
    } catch (delErr) {
      const msg = delErr.message || '';
      if (msg.includes('403') || msg.includes('permission')) { send(res, 403, { error: 'Permission denied.' }); return; }
      if (msg.includes('404') || msg.includes('not found')) { send(res, 404, { error: 'Record not found. It may have been already deleted.' }); return; }
      console.error('[adminDeleteRecord] Database error:', msg);
      send(res, 500, { error: 'Database deletion failed' }); return;
    }

    // Verify deletion by checking if record still exists
    try {
      const verifyStillExists = await getDoc(collection, deleteId);
      if (verifyStillExists) {
        console.error(`[adminDeleteRecord] Post-delete verification FAILED for ${collection}/${deleteId} — record still exists`);
        send(res, 500, { error: 'Deletion verification failed — record still exists in database. Please try again.' });
        return;
      }
    } catch {
      // getDoc threw an error — likely the record was deleted, which is fine
    }

    // Delete screenshot from storage
    let storageDeleted = null;
    if (screenshotUrl) {
      const ok = await deleteR2File(screenshotUrl);
      if (ok) storageDeleted = screenshotUrl;
    }

    // Cascade delete related records when deleting a UPI payment
    const cascade = { topups: 0, verification_logs: 0, processed_payments: 0 };
    if (paymentRecord && collection === COL_UPI_PAYMENTS) {
      const pid = paymentRecord.id;
      const uid = paymentRecord.user_id;
      const utrVal = paymentRecord.utr;

      // 1. Delete verification_logs by payment_id (direct match)
      try {
        const vlogs = await runQuery(COL_VERIFICATION_LOGS, [{ field: 'payment_id', op: 'EQUAL', value: pid }], { limit: 500 });
        for (const v of vlogs) {
          try {
            await deleteDoc(COL_VERIFICATION_LOGS, v.id);
            const vv = await getDoc(COL_VERIFICATION_LOGS, v.id);
            if (!vv) cascade.verification_logs++;
          } catch {}
        }
      } catch (e) { console.error('[adminDeleteRecord] Cascade delete verification_logs error:', e.message); }

      // 2. Delete topups by user_id + utr (logical match, no FK to payments)
      if (uid && utrVal) {
        try {
          const topups = await runQuery(COL_TOPUPS, [
            { field: 'user_id', op: 'EQUAL', value: uid },
            { field: 'utr', op: 'EQUAL', value: utrVal },
          ], { limit: 100 });
          for (const t of topups) {
            try {
              await deleteDoc(COL_TOPUPS, t.id);
              const vt = await getDoc(COL_TOPUPS, t.id);
              if (!vt) cascade.topups++;
            } catch {}
          }
        } catch (e) { console.error('[adminDeleteRecord] Cascade delete topups error:', e.message); }

        // 3. Delete processed_payments by user_id + utr
        try {
          const processed = await runQuery(COL_PROCESSED_PAYMENTS, [
            { field: 'user_id', op: 'EQUAL', value: uid },
            { field: 'utr', op: 'EQUAL', value: utrVal },
          ], { limit: 100 });
          for (const p of processed) {
            try {
              await deleteDoc(COL_PROCESSED_PAYMENTS, p.id);
              const vp = await getDoc(COL_PROCESSED_PAYMENTS, p.id);
              if (!vp) cascade.processed_payments++;
            } catch {}
          }
        } catch (e) { console.error('[adminDeleteRecord] Cascade delete processed_payments error:', e.message); }
      }
    }

    // Audit log
    const cascadeTotal = cascade.topups + cascade.verification_logs + cascade.processed_payments;
    try {
      await addDoc(COL_DELETION_AUDIT_LOGS, {
        admin_id: adminInfo.adminId,
        admin_name: adminInfo.adminName,
        deleted_record_id: recordId.trim(),
        record_type: recordType,
        reason: reason.trim(),
        collection: collection,
        deleted_count: 1 + cascadeTotal,
        deleted_at: new Date().toISOString(),
      });
    } catch {}

    send(res, 200, {
      success: true,
      message: (LABELS[recordType] || 'Record') + ' deleted successfully',
      storageDeleted: !!storageDeleted,
      cascade,
    });
  } catch (err) {
    console.error('[adminDeleteRecord] Error:', err.message);
    send(res, 500, { error: 'Internal server error' });
  }
};
