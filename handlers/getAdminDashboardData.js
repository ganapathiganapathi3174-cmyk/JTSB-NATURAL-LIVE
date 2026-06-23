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

    const [usersRes, topupsRes] = await Promise.all([
      supabase.from('users').select('*').order('created_at', { ascending: false }),
      supabase.from('topups').select('*').order('created_at', { ascending: false }).limit(500),
    ]);

    if (usersRes.error) throw new Error('Users query: ' + usersRes.error.message);
    if (topupsRes.error && topupsRes.error.message !== 'relation "topups" does not exist') {
      throw new Error('Topups query: ' + topupsRes.error.message);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      users: usersRes.data || [],
      topups: topupsRes.data || [],
    }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
};
