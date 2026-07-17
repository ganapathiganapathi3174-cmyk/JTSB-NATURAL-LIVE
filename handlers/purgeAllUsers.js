const { getSupabaseClient } = require('../api/_supabase.js');

const TABLES = [
  'users', 'upi_payments', 'topups', 'wallet_balances',
  'wallet_transactions', 'verification_logs', 'processed_payments',
  'referrals', 'notifications', 'pending_registrations',
  'topup_referral_income', 'sponsor_data', 'chat_messages',
  'chat_conversations', 'payment_sessions', 'audit_logs',
  'deletion_audit_logs', 'uniques',
];

const KEEP_EMAILS = ['system1000@jayaraj.in', 'system500@jayaraj.in', 'system120@jayaraj.in'];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(200).end(); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }
  if (!req.admin) { res.writeHead(401); res.end(JSON.stringify({ error: 'Authentication required' })); return; }

  try {
    const supabase = getSupabaseClient();
    let totalDeleted = 0;
    const deleteResults = {};

    // 1. Delete all rows from all tables except users (handle users separately to keep system accounts)
    for (const table of TABLES) {
      if (table === 'users' || table === 'uniques') continue;
      const { data, error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) {
        console.error('[purge] ' + table + ' error:', error.message);
        continue;
      }
      const count = data ? data.length : 0;
      totalDeleted += count;
      deleteResults[table] = count;
    }

    // 2. Delete users except system accounts (1000, 500, 120)
    const { data: allUsers } = await supabase.from('users').select('id,email').limit(1000);
    const toDelete = (allUsers || []).filter(u => !KEEP_EMAILS.includes(u.email));
    const keepIds = (allUsers || []).filter(u => KEEP_EMAILS.includes(u.email)).map(u => u.id);

    if (toDelete.length > 0) {
      const ids = toDelete.map(u => u.id);
      // Delete in batches of 50
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const { error } = await supabase.from('users').delete().in('id', batch);
        if (error) console.error('[purge] users batch error:', error.message);
      }
      totalDeleted += ids.length;
      deleteResults['users'] = ids.length;
      deleteResults['users_skipped'] = keepIds.length;
    }

    // 3. Delete uniques for deleted users
    for (const user of toDelete) {
      if (user.email) {
        await supabase.from('uniques').delete().eq('id', 'email:' + user.email.toLowerCase().trim()).maybeSingle();
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      message: 'Purged ' + totalDeleted + ' records total. ' + toDelete.length + ' users deleted, ' + keepIds.length + ' system accounts kept.',
      deletedUsers: toDelete.length,
      keptUsers: keepIds.length,
      perTable: deleteResults,
    }));
  } catch (err) {
    console.error('[purgeAllUsers] Error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
};
