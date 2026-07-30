const { createClient } = require('@supabase/supabase-js');

const REQUEST_TIMEOUT_MS = parseInt(process.env.SUPABASE_TIMEOUT || '8000', 10);

function createSupabaseClient() {
  let supabaseUrl = (process.env.SUPABASE_URL || '').trim();
  const supabaseKey = (process.env.SUPABASE_SERVICE_KEY || '').trim();
  supabaseUrl = supabaseUrl.replace(/\/+$/, '');
  if (!supabaseUrl.startsWith('http://') && !supabaseUrl.startsWith('https://')) {
    supabaseUrl = 'https://' + supabaseUrl;
  }
  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, options = {}) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        if (options.signal) {
          options.signal.addEventListener('abort', () => controller.abort(), { once: true });
        }
        return fetch(url, { ...options, signal: controller.signal })
          .finally(() => clearTimeout(timeoutId));
      },
    },
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }
  try {
    const { table, method = 'select', filters = [], options = {}, id, data } = req.body || {};
    if (!table) { res.writeHead(400); res.end(JSON.stringify({ error: 'table required' })); return; }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseKey) { res.writeHead(500); res.end(JSON.stringify({ error: 'Supabase not configured' })); return; }

    const supabase = createSupabaseClient();

    let result;
    if (method === 'select') {
      let query = supabase.from(table).select(options.select || '*');
      if (filters.length) {
        for (const f of filters) {
          if (f.op === 'EQUAL') query = query.eq(f.field, f.value);
          else if (f.op === 'NOT_EQUAL') query = query.neq(f.field, f.value);
          else if (f.op === 'IN') query = query.in(f.field, f.value);
          else if (f.op === 'LIKE') query = query.ilike(f.field, f.value);
        }
      }
      if (options.orderBy) query = query.order(options.orderBy, { ascending: options.ascending !== false });
      if (options.limit) query = query.limit(options.limit);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      result = data || [];
    } else if (method === 'get') {
      if (!id) { res.writeHead(400); res.end(JSON.stringify({ error: 'id required for get' })); return; }
      const { data, error } = await supabase.from(table).select('*').eq('id', id).single();
      if (error && error.code !== 'PGRST116') throw new Error(error.message);
      result = data;
    } else if (method === 'count') {
      let query = supabase.from(table).select('*', { count: 'exact', head: true });
      for (const f of filters) {
        if (f.op === 'EQUAL') query = query.eq(f.field, f.value);
      }
      const { count, error } = await query;
      if (error) throw new Error(error.message);
      result = { count: count || 0 };
    } else if (method === 'update') {
      if (!id && !filters.length) { res.writeHead(400); res.end(JSON.stringify({ error: 'id or filters required for update' })); return; }
      let query = supabase.from(table).update(data || {});
      if (id) query = query.eq('id', id);
      for (const f of filters) query = query.eq(f.field, f.value);
      const { error } = await query;
      if (error) throw new Error(error.message);
      result = { success: true };
    } else if (method === 'upsert') {
      const { data: upserted, error } = await supabase.from(table).upsert(data || {}, { onConflict: options.onConflict || 'id' }).select('id').single();
      if (error) throw new Error(error.message);
      result = upserted;
    } else if (method === 'insert') {
      const { data: inserted, error } = await supabase.from(table).insert(data || {}).select('id');
      if (error) throw new Error(error.message);
      result = inserted;
    } else if (method === 'delete') {
      if (!id && !filters.length) { res.writeHead(400); res.end(JSON.stringify({ error: 'id or filters required for delete' })); return; }
      let query = supabase.from(table).delete();
      if (id) query = query.eq('id', id);
      for (const f of filters) query = query.eq(f.field, f.value);
      const { error } = await query;
      if (error) throw new Error(error.message);
      result = { success: true };
    } else {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid method' })); return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: result }));
  } catch (err) {
    const isAbort = err.name === 'AbortError' || err.message?.includes('abort') || err.message?.includes('timeout');
    console.error('[supabaseProxy] ' + (isAbort ? 'TIMEOUT' : 'Error') + ':', err.message);
    console.error('[supabaseProxy] Path:', req.path, 'Method:', req.body?.method, 'Table:', req.body?.table);
    if (!isAbort) console.error('[supabaseProxy] Stack:', err.stack?.split('\n').slice(0, 4).join('\n'));
    const isConfigError = err.message.includes('not configured') || err.message.includes('supabaseUrl');
    const status = isAbort ? 504 : (isConfigError ? 502 : 500);
    const errorMsg = isAbort ? 'Database request timed out. Please try again.' : (isConfigError ? 'Server configuration error: ' + err.message : 'Internal server error');
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: errorMsg }));
  }
};
