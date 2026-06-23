const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const secret = req.headers['x-migration-secret'];
    if (secret !== process.env.MIGRATION_SECRET) {
      res.writeHead(403); res.end(JSON.stringify({ error: 'Forbidden' }));
      return;
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      res.writeHead(500); res.end(JSON.stringify({ error: 'Supabase not configured' }));
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

    const tables = [
      'users', 'pending_registrations', 'upi_payments', 'wallet_balances',
      'wallet_transactions', 'verification_logs', 'referrals', 'topups',
      'referral_access', 'notifications', 'chat_messages', 'chat_conversations',
      'admins', 'deletion_audit_logs', 'withdrawals', 'kyc_documents',
      'settings', 'audit_logs'
    ];

    const results = [];

    for (const table of tables) {
      try {
        const { error: rlsError } = await supabase.rpc('exec_sql', {
          sql: `ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY;`
        });
        if (rlsError) {
          results.push({ table, status: 'error', message: rlsError.message });
        } else {
          results.push({ table, status: 'rls_disabled' });
        }
      } catch (e) {
        results.push({ table, status: 'error', message: e.message });
      }
    }

    res.writeHead(200); res.end(JSON.stringify({ success: true, results }));
  } catch (err) {
    res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
  }
};
