const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      res.writeHead(500); res.end(JSON.stringify({ error: 'Supabase not configured' }));
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

    const [usersRes, topupsRes, pendingRegsRes, upiPaymentsRes] = await Promise.all([
      supabase.from('users').select('*').order('created_at', { ascending: false }),
      supabase.from('topups').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('pending_registrations').select('*').order('created_at', { ascending: false }),
      supabase.from('upi_payments').select('*').order('created_at', { ascending: false }),
    ]);

    if (usersRes.error) throw new Error('Users query: ' + usersRes.error.message);
    if (topupsRes.error && topupsRes.error.message !== 'relation "topups" does not exist') {
      throw new Error('Topups query: ' + topupsRes.error.message);
    }
    if (pendingRegsRes.error && pendingRegsRes.error.message !== 'relation "pending_registrations" does not exist') {
      throw new Error('PendingRegs query: ' + pendingRegsRes.error.message);
    }
    if (upiPaymentsRes.error && upiPaymentsRes.error.message !== 'relation "upi_payments" does not exist') {
      throw new Error('UPIPayments query: ' + upiPaymentsRes.error.message);
    }

    const pendingRegs = pendingRegsRes.data || [];
    const upiPayments = upiPaymentsRes.data || [];

    const pendingPayments = upiPayments.map(up => {
      const reg = pendingRegs.find(r => r.id === up.user_id);
      let mappedStatus = up.status;
      if (mappedStatus === 'verified') mappedStatus = 'approved';
      else if (mappedStatus !== 'rejected') mappedStatus = 'pending';
      return {
        id: up.id,
        name: reg?.name || 'Unknown',
        email: reg?.email || '',
        phone: reg?.phone || '',
        referral_code: reg?.referral_code || '',
        payment_status: mappedStatus,
        created_at: up.payment_date || up.created_at || reg?.created_at,
        payment_type: up.payment_type,
        amount: up.amount,
        utr: up.utr,
        rejection_reasons: up.rejection_reasons,
        _source: 'pending_registration',
      };
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      users: usersRes.data || [],
      topups: topupsRes.data || [],
      pendingPayments,
    }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
};
