const { deleteDoc, runQuery } = require('../api/_supabase.js');
const r2 = require('../api/_r2.js');

const COL_USERS = 'users';
const COL_UPI_PAYMENTS = 'upi_payments';
const COL_TOPUPS = 'topups';
const COL_WALLET_BALANCES = 'wallet_balances';
const COL_WALLET_TX = 'wallet_transactions';
const COL_VERIFICATION_LOGS = 'verification_logs';
const COL_PROCESSED_PAYMENTS = 'processed_payments';
const COL_REFERRALS = 'referrals';
const COL_NOTIFICATIONS = 'notifications';
const COL_PENDING_REGS = 'pending_registrations';
const COL_TOPUP_INCOME = 'topup_referral_income';
const COL_SPONSOR_DATA = 'sponsor_data';
const COL_CHAT_MESSAGES = 'chat_messages';
const COL_CHAT_CONVOS = 'chat_conversations';
const COL_DELETION_AUDIT_LOGS = 'deletion_audit_logs';
const COL_UNIQUES = 'uniques';
const COL_ORDERS = 'payment_sessions';
const COL_AUDIT_LOGS = 'audit_logs';

const KEEP_EMAILS = ['system1000@jayaraj.in', 'system500@jayaraj.in', 'system120@jayaraj.in'];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(200).end(); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }
  if (!req.admin) { res.writeHead(401); res.end(JSON.stringify({ error: 'Authentication required' })); return; }

  try {
    const allUsers = await runQuery(COL_USERS, [], { limit: 1000 });
    const toDelete = allUsers.filter(u => !KEEP_EMAILS.includes(u.email));

    let totalDeleted = 0;
    const deletedIds = [];

    for (const user of toDelete) {
      const userId = user.id;
      deletedIds.push({ id: userId, email: user.email });

      // Collect screenshot URLs
      try {
        const payments = await runQuery(COL_UPI_PAYMENTS, [{ field: 'user_id', op: 'EQUAL', value: userId }], { limit: 200 });
        for (const p of payments) {
          if (p.screenshot_url) {
            try { await deleteDoc(COL_UPI_PAYMENTS, p.id); totalDeleted++; } catch (e) { console.log('delete payment fail:', p.id, e.message); }
          }
        }
      } catch {}

      // Delete all related records
      const tables = [
        COL_REFERRALS, COL_TOPUPS, COL_TOPUP_INCOME,
        COL_NOTIFICATIONS, COL_WALLET_TX, COL_UPI_PAYMENTS,
        COL_PROCESSED_PAYMENTS, COL_VERIFICATION_LOGS, COL_SPONSOR_DATA,
        COL_PENDING_REGS,
      ];
      for (const table of tables) {
        try {
          const docs = await runQuery(table, [{ field: 'user_id', op: 'EQUAL', value: userId }]);
          for (const d of docs) {
            try { await deleteDoc(table, d.id); totalDeleted++; } catch (e) { console.log('delete fail', table, d.id, e.message); }
          }
        } catch {}
      }

      // Delete from other tables
      try { await deleteDoc(COL_WALLET_BALANCES, userId); totalDeleted++; } catch {}
      try { await deleteDoc(COL_ORDERS, userId); totalDeleted++; } catch {}

      if (user.email) { try { await deleteDoc(COL_UNIQUES, 'email:' + user.email.toLowerCase().trim()); totalDeleted++; } catch {} }
      if (user.phone) { try { await deleteDoc(COL_UNIQUES, 'phone:' + user.phone.trim()); totalDeleted++; } catch {} }

      // Final: delete the user itself
      try { await deleteDoc(COL_USERS, userId); totalDeleted++; } catch (e) { console.log('delete user fail:', userId, e.message); }
    }

    // Also delete all pending_registrations without user_id
    try {
      const regs = await runQuery(COL_PENDING_REGS, []);
      for (const r of regs) {
        try { await deleteDoc(COL_PENDING_REGS, r.id); totalDeleted++; } catch {}
      }
    } catch {}

    // Delete all upi_payments (old expired ones)
    try {
      const allPayments = await runQuery(COL_UPI_PAYMENTS, []);
      for (const p of allPayments) {
        try { await deleteDoc(COL_UPI_PAYMENTS, p.id); totalDeleted++; } catch {}
      }
    } catch {}

    res.writeHead(200); res.end(JSON.stringify({
      success: true,
      message: 'Purged ' + toDelete.length + ' users and ' + totalDeleted + ' total records',
      deletedUsers: deletedIds,
      skipCount: allUsers.length - toDelete.length,
      totalRecords: totalDeleted,
    }));
  } catch (err) {
    console.error('[purgeAllUsers] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
  }
};
