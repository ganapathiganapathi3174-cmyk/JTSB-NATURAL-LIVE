const { COL_DELETION_AUDIT_LOGS, COL_USERS, COL_UPI_PAYMENTS, COL_TOPUPS, COL_VERIFICATION_LOGS, COL_WALLET_BALANCES, COL_WALLET_TX, COL_TOPUP_INCOME, COL_REFERRALS, COL_NOTIFICATIONS, COL_CHAT_MESSAGES, COL_CHAT_CONVOS, COL_UNIQUES } = require('./_shared.js');
const { deleteDoc, getDoc, runQuery, addDoc, updateDoc } = require('./_supabase.js');

const SIMPLE_TYPES = { topup: COL_TOPUPS, pending_payment: COL_UPI_PAYMENTS, rejected_payment: COL_UPI_PAYMENTS, verification_log: COL_VERIFICATION_LOGS, test_record: COL_UPI_PAYMENTS, upi_payment: COL_UPI_PAYMENTS };
const LABELS = { topup: 'Topup', upi_payment: 'UPI Payment', verification_log: 'Verification Log', user: 'User' };

function send(res, status, data) {
  try { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); } catch {}
}

async function deleteMatching(table, field, value) {
  try {
    const docs = await runQuery(table, [{ field, op: 'EQUAL', value }]);
    const ids = [];
    for (const d of docs) { try { await deleteDoc(table, d.id); ids.push(d.id); } catch {} }
    return ids;
  } catch { return []; }
}

async function deleteUserCascade(userId) {
  const deleted = [];
  const user = await getDoc(COL_USERS, userId);
  if (!user) return { deleted, error: 'User not found' };

  const email = user.email || '';
  const phone = user.phone || '';

  deleted.push(...await deleteMatching(COL_REFERRALS, 'user_id', userId));
  deleted.push(...await deleteMatching(COL_TOPUPS, 'user_id', userId));
  deleted.push(...await deleteMatching(COL_TOPUP_INCOME, 'user_id', userId));
  deleted.push(...await deleteMatching(COL_TOPUP_INCOME, 'from_user_id', userId));
  deleted.push(...await deleteMatching(COL_NOTIFICATIONS, 'user_id', userId));
  deleted.push(...await deleteMatching(COL_WALLET_TX, 'user_id', userId));
  deleted.push(...await deleteMatching(COL_UPI_PAYMENTS, 'user_id', userId));

  try { await deleteDoc(COL_WALLET_BALANCES, userId); deleted.push('wallet_balances/' + userId); } catch {}

  const convoId = 'convo_' + userId;
  try {
    const msgs = await runQuery(COL_CHAT_MESSAGES, [{ field: 'convo_id', op: 'EQUAL', value: convoId }]);
    for (const m of msgs) { try { await deleteDoc(COL_CHAT_MESSAGES, m.id); deleted.push('chat_messages/' + m.id); } catch {} }
  } catch {}
  try { await deleteDoc(COL_CHAT_CONVOS, convoId); deleted.push('chat_conversations/' + convoId); } catch {}

  if (email) { try { await deleteDoc(COL_UNIQUES, 'email:' + email.toLowerCase().trim()); deleted.push('uniques/email'); } catch {} }
  if (phone) { try { await deleteDoc(COL_UNIQUES, 'phone:' + phone.trim()); deleted.push('uniques/phone'); } catch {} }

  try { await deleteDoc(COL_USERS, userId); deleted.push('users/' + userId); } catch (e) { return { deleted, error: 'Failed to delete user document: ' + e.message }; }

  if (user.referred_by) {
    try {
      const refs = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: user.referred_by }]);
      for (const r of refs) {
        const count = Math.max(0, (r.referrals_count || 0) - 1);
        try { await updateDoc(COL_USERS, r.id, { referrals_count: count }); } catch {}
      }
    } catch {}
  }

  return { deleted, error: null };
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(200).end(); return; }
    if (req.method !== 'POST') { send(res, 405, { error: 'Method not allowed' }); return; }

    const { recordId, recordType, reason, adminToken } = req.body || {};
    if (!adminToken) { send(res, 401, { error: 'Authentication required. Please re-login as admin.' }); return; }

    let decoded;
    try { decoded = JSON.parse(Buffer.from(adminToken, 'base64').toString()); } catch { send(res, 401, { error: 'Invalid admin session. Please re-login.' }); return; }
    if (!decoded.expiresAt || Date.now() > decoded.expiresAt) { send(res, 401, { error: 'Admin session expired. Please re-login.' }); return; }
    if (!recordId || !recordId.trim() || !reason || !reason.trim()) { send(res, 400, { error: 'Missing required fields: recordId, recordType, reason' }); return; }

    if (recordType === 'user') {
      const result = await deleteUserCascade(recordId.trim());
      if (result.error) { send(res, 404, { error: result.error }); return; }
      try {
        await addDoc(COL_DELETION_AUDIT_LOGS, {
          admin_id: 'admin', admin_name: 'Admin', deleted_record_id: recordId.trim(),
          record_type: 'user', reason: reason.trim(), collection: COL_USERS, deleted_count: result.deleted.length,
        });
      } catch {}
      send(res, 200, { success: true, message: 'User deleted successfully', deletedRecords: result.deleted.length }); return;
    }

    const collection = SIMPLE_TYPES[recordType];
    if (!collection) { send(res, 400, { error: 'Invalid record type. Valid types: ' + Object.keys({ ...SIMPLE_TYPES, user: true }).join(', ') }); return; }

    try {
      await deleteDoc(collection, recordId.trim());
    } catch (delErr) {
      const msg = delErr.message || '';
      if (msg.includes('403') || msg.includes('permission') || msg.includes('Permission')) { send(res, 403, { error: 'Permission denied.' }); return; }
      if (msg.includes('404') || msg.includes('not found')) { send(res, 404, { error: 'Record not found. It may have been already deleted.' }); return; }
      send(res, 500, { error: 'Database error: ' + msg }); return;
    }

    try {
      await addDoc(COL_DELETION_AUDIT_LOGS, {
        admin_id: 'admin', admin_name: 'Admin', deleted_record_id: recordId.trim(),
        record_type: recordType, reason: reason.trim(), collection: collection,
      });
    } catch {}

    send(res, 200, { success: true, message: (LABELS[recordType] || 'Record') + ' deleted successfully' });
  } catch (err) {
    send(res, 500, { error: err.message || 'Internal server error' });
  }
};
