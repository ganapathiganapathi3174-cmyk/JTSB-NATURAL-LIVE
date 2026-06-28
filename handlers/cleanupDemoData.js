const { deleteDoc, runQuery, addDoc } = require('../api/_supabase.js');
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

const DEMO_PATTERNS = [
  { field: 'email', pattern: /^(demo|test|fake|admin\d*)@/i },
  { field: 'name', pattern: /^(demo|test|fake)\s/i },
  { field: 'name', pattern: /^test$/i },
  { field: 'name', pattern: /^demo$/i },
  { field: 'email', pattern: /@example\./i },
  { field: 'email', pattern: /@test\./i },
  { field: 'email', pattern: /@demo\./i },
  { field: 'referral_code', pattern: /^DEMO|^TEST|^FAKE/i },
];

function isDemoUser(user) {
  if (!user) return false;
  if (user.email === 'jayaraj@gmail.com') return false;
  for (const { field, pattern } of DEMO_PATTERNS) {
    const val = user[field];
    if (val && pattern.test(val)) return true;
  }
  if (user.name && user.name.length <= 1) return true;
  if (user.phone && user.phone.replace(/\D/g, '').length < 10) return true;
  return false;
}

async function deleteFilesFromStorage(urls) {
  const deleted = [];
  for (const url of urls) {
    if (!url) continue;
    try {
      const r2Domain = process.env.R2_PUBLIC_DOMAIN;
      if (r2Domain && url.includes(r2Domain)) {
        const key = url.split('/').slice(3).join('/').split('?')[0];
        if (key) {
          await r2.deleteFile(key);
          deleted.push(key);
        }
        continue;
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
            deleted.push(bucket + '/' + filePath);
          }
        }
      }
    } catch {}
  }
  return deleted;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(200).end(); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  try {
    if (!req.admin) {
      res.writeHead(401); res.end(JSON.stringify({ error: 'Admin authentication required' })); return;
    }

    const allUsers = await runQuery(COL_USERS, [], { limit: 1000 });
    const demoUsers = allUsers.filter(isDemoUser);

    let totalDeletedRecords = 0;
    let totalDeletedStorage = 0;
    const deletedUserIds = [];
    const allScreenshotUrls = [];

    for (const user of demoUsers) {
      const userId = user.id;
      deletedUserIds.push({ id: userId, email: user.email, name: user.name });

      // Collect screenshot URLs from payments and topups
      try {
        const payments = await runQuery(COL_UPI_PAYMENTS, [{ field: 'user_id', op: 'EQUAL', value: userId }], { limit: 200 });
        for (const p of payments) { if (p.screenshot_url) allScreenshotUrls.push(p.screenshot_url); }
      } catch {}
      try {
        const topups = await runQuery(COL_TOPUPS, [{ field: 'user_id', op: 'EQUAL', value: userId }], { limit: 200 });
        for (const t of topups) { if (t.screenshot_url) allScreenshotUrls.push(t.screenshot_url); }
      } catch {}

      // Delete all associated records
      const tables = [
        { table: COL_REFERRALS, field: 'user_id' },
        { table: COL_TOPUPS, field: 'user_id' },
        { table: COL_TOPUP_INCOME, field: 'user_id' },
        { table: COL_TOPUP_INCOME, field: 'from_user_id' },
        { table: COL_NOTIFICATIONS, field: 'user_id' },
        { table: COL_WALLET_TX, field: 'user_id' },
        { table: COL_UPI_PAYMENTS, field: 'user_id' },
        { table: COL_PROCESSED_PAYMENTS, field: 'user_id' },
        { table: COL_VERIFICATION_LOGS, field: 'user_id' },
        { table: COL_SPONSOR_DATA, field: 'user_id' },
        { table: COL_PENDING_REGS, field: 'user_id' },
      ];

      for (const { table, field } of tables) {
        try {
          const docs = await runQuery(table, [{ field, op: 'EQUAL', value: userId }]);
          for (const d of docs) {
            try { await deleteDoc(table, d.id); totalDeletedRecords++; } catch {}
          }
        } catch {}
      }

      try { await deleteDoc(COL_WALLET_BALANCES, userId); totalDeletedRecords++; } catch {}

      const convoId = 'convo_' + userId;
      try {
        const msgs = await runQuery(COL_CHAT_MESSAGES, [{ field: 'convo_id', op: 'EQUAL', value: convoId }]);
        for (const m of msgs) { try { await deleteDoc(COL_CHAT_MESSAGES, m.id); totalDeletedRecords++; } catch {} }
      } catch {}
      try { await deleteDoc(COL_CHAT_CONVOS, convoId); totalDeletedRecords++; } catch {}

      if (user.email) { try { await deleteDoc('uniques', 'email:' + user.email.toLowerCase().trim()); totalDeletedRecords++; } catch {} }
      if (user.phone) { try { await deleteDoc('uniques', 'phone:' + user.phone.trim()); totalDeletedRecords++; } catch {} }

      try { await deleteDoc(COL_USERS, userId); totalDeletedRecords++; } catch {}
    }

    const storageDeleted = await deleteFilesFromStorage(allScreenshotUrls);
    totalDeletedStorage = storageDeleted.length;

    try {
      await addDoc(COL_DELETION_AUDIT_LOGS, {
        admin_id: 'admin',
        admin_name: 'System',
        deleted_record_id: 'batch_cleanup',
        record_type: 'batch_cleanup',
        reason: 'Automated demo/test data cleanup (' + deletedUserIds.length + ' users, ' + totalDeletedRecords + ' records, ' + totalDeletedStorage + ' storage files)',
        collection: COL_USERS,
        deleted_count: totalDeletedRecords,
        deleted_at: new Date().toISOString(),
      });
    } catch {}

    res.writeHead(200); res.end(JSON.stringify({
      success: true,
      message: `Cleaned up ${deletedUserIds.length} demo/test users (${totalDeletedRecords} total records, ${totalDeletedStorage} storage files)`,
      deletedUsers: deletedUserIds,
      totalRecords: totalDeletedRecords,
      storageFiles: totalDeletedStorage,
    }));
  } catch (err) {
    console.error('[cleanupDemoData] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};