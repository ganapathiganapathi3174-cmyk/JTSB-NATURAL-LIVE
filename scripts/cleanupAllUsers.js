require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { getSupabaseClient } = require('../api/_supabase.js');
const { SYSTEM_REFERRAL_CODES } = require('../api/_shared.js');

async function main() {
  const supabase = getSupabaseClient();
  console.log('[CLEANUP] Fetching all non-system users...');

  const { data: allUsers, error } = await supabase
    .from('users')
    .select('id, name, email, referral_code')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[CLEANUP] Failed to fetch users:', error.message);
    process.exit(1);
  }

  const systemUsers = allUsers.filter(u => SYSTEM_REFERRAL_CODES.includes(u.referral_code));
  const deleteUsers = allUsers.filter(u => !SYSTEM_REFERRAL_CODES.includes(u.referral_code));

  console.log(`[CLEANUP] Total users: ${allUsers.length}`);
  console.log(`[CLEANUP] System users (kept): ${systemUsers.length} (${systemUsers.map(u => u.referral_code).join(', ')})`);
  console.log(`[CLEANUP] Users to delete: ${deleteUsers.length}`);

  if (deleteUsers.length === 0) {
    console.log('[CLEANUP] No users to delete.');
    process.exit(0);
  }

  const userIds = deleteUsers.map(u => u.id);
  console.log(`[CLEANUP] Deleting ${userIds.length} users and all associated data...`);

  for (let i = 0; i < userIds.length; i++) {
    const uid = userIds[i];
    const user = deleteUsers.find(u => u.id === uid);
    console.log(`[CLEANUP] [${i + 1}/${userIds.length}] Deleting user ${user?.name || uid} (${uid})...`);

    const tables = [
      { table: 'referrals', field: 'user_id' },
      { table: 'topups', field: 'userId' },
      { table: 'topups', field: 'user_id' },
      { table: 'topup_referral_income', field: 'userId' },
      { table: 'topup_referral_income', field: 'fromUserId' },
      { table: 'topup_referral_income', field: 'user_id' },
      { table: 'topup_referral_income', field: 'from_user_id' },
      { table: 'notifications', field: 'user_id' },
      { table: 'notifications', field: 'receiverId' },
      { table: 'notifications', field: 'senderId' },
      { table: 'wallet_transactions', field: 'userId' },
      { table: 'wallet_transactions', field: 'user_id' },
      { table: 'upi_payments', field: 'user_id' },
      { table: 'processed_payments', field: 'user_id' },
      { table: 'verification_logs', field: 'user_id' },
      { table: 'sponsor_data', field: 'user_id' },
      { table: 'pending_registrations', field: 'user_id' },
      { table: 'payment_sessions', field: 'user_id' },
      { table: 'audit_logs', field: 'target_id' },
      { table: 'deletion_audit_logs', field: 'deleted_record_id' },
      { table: 'sponsor_claims', field: 'sponsor_id' },
      { table: 'sponsor_transfers', field: 'user_id' },
      { table: 'sponsor_transfers', field: 'sponsor_id' },
    ];

    for (const { table, field } of tables) {
      try {
        await supabase.from(table).delete().eq(field, uid);
      } catch {}
    }

    try {
      await supabase.from('wallet_balances').delete().eq('id', uid);
    } catch {}

    const convoId = 'admin_' + uid;
    try {
      await supabase.from('chat_messages').delete().eq('convoId', convoId);
    } catch {}
    try {
      await supabase.from('chat_conversations').delete().eq('id', convoId);
    } catch {}

    if (user) {
      if (user.email) {
        try { await supabase.from('uniques').delete().eq('id', 'email:' + user.email.toLowerCase().trim()); } catch {}
      }
      if (user.email) {
        try { await supabase.from('uniques').delete().eq('id', 'email:' + user.email.toLowerCase().trim()); } catch {}
      }
    }

    try {
      await supabase.from('users').delete().eq('id', uid);
    } catch (e) {
      console.error(`[CLEANUP] Failed to delete user ${uid}: ${e.message}`);
    }
  }

  // Clean up orphaned pending registrations (user_id is null)
  try {
    const { data: orphanedPendings, error: pendError } = await supabase
      .from('pending_registrations')
      .select('id, email')
      .is('user_id', null);
    if (!pendError && orphanedPendings?.length > 0) {
      console.log(`[CLEANUP] Cleaning ${orphanedPendings.length} orphaned pending registrations (user_id=null)...`);
      for (const p of orphanedPendings) {
        await supabase.from('pending_registrations').delete().eq('id', p.id);
        console.log(`  Deleted pending_registration ${p.id} (${p.email || 'no email'})`);
      }
    }
  } catch (e) { console.error('[CLEANUP] Failed to clean orphaned pendings:', e.message); }

  console.log(`[CLEANUP] Done. Deleted ${userIds.length} users and all associated data.`);
  process.exit(0);
}

main().catch(err => {
  console.error('[CLEANUP] Fatal error:', err.message);
  process.exit(1);
});
