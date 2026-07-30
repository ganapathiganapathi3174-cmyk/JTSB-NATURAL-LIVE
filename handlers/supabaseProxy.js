const REQUEST_TIMEOUT_MS = parseInt(process.env.SUPABASE_TIMEOUT || '8000', 10);

function getRestUrl() {
  let url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  if (!url) return null;
  if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
  return url + '/rest/v1';
}

function getApiKey() {
  return (process.env.SUPABASE_SERVICE_KEY || '').trim() || null;
}

function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timeoutId));
}

function buildFilterQuery(filters) {
  if (!filters || !filters.length) return '';
  return filters.map(f => {
    const col = encodeURIComponent(f.field);
    const val = encodeURIComponent(String(f.value));
    if (f.op === 'EQUAL') return col + '=eq.' + val;
    if (f.op === 'NOT_EQUAL') return col + '=neq.' + val;
    if (f.op === 'IN') return col + '=in.(' + String(f.value).split(',').map(v => encodeURIComponent(String(v).trim())).join(',') + ')';
    if (f.op === 'LIKE' || f.op === 'ILIKE') return col + '=ilike.' + val;
    return col + '=eq.' + val;
  }).join('&');
}

function buildOrderQuery(orderBy, ascending) {
  if (!orderBy) return '';
  const dir = ascending !== false ? '' : '.desc';
  return '&order=' + encodeURIComponent(orderBy) + dir;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }
  try {
    const { table, method = 'select', filters = [], options = {}, id, data } = req.body || {};
    if (!table) { res.writeHead(400); res.end(JSON.stringify({ error: 'table required' })); return; }

    const restUrl = getRestUrl();
    const apiKey = getApiKey();
    if (!restUrl || !apiKey) { res.writeHead(500); res.end(JSON.stringify({ error: 'Supabase not configured' })); return; }

    const tableUrl = restUrl + '/' + encodeURIComponent(table);
    const headers = { 'apikey': apiKey, 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' };

    let result;
    if (method === 'select') {
      const select = options.select || '*';
      const filterQ = buildFilterQuery(filters);
      const orderQ = buildOrderQuery(options.orderBy, options.ascending);
      const limitQ = options.limit ? '&limit=' + Number(options.limit) : '';
      const url = tableUrl + '?select=' + encodeURIComponent(select) + (filterQ ? '&' + filterQ : '') + orderQ + limitQ;
      const res2 = await fetchWithTimeout(url, { headers });
      if (!res2.ok) {
        const body = await res2.text().catch(() => '');
        throw new Error('Supabase ' + res2.status + ': ' + (body || res2.statusText));
      }
      result = await res2.json();
    } else if (method === 'get') {
      if (!id) { res.writeHead(400); res.end(JSON.stringify({ error: 'id required for get' })); return; }
      const url = tableUrl + '?id=eq.' + encodeURIComponent(String(id)) + '&select=*';
      const res2 = await fetchWithTimeout(url, { headers });
      if (!res2.ok) {
        const body = await res2.text().catch(() => '');
        throw new Error('Supabase ' + res2.status + ': ' + (body || res2.statusText));
      }
      const rows = await res2.json();
      result = (rows && rows.length > 0) ? rows[0] : null;
    } else if (method === 'count') {
      const filterQ = buildFilterQuery(filters);
      const url = tableUrl + '?select=' + (filterQ ? filterQ + '&' : '') + '&head=true';
      const res2 = await fetchWithTimeout(url, { method: 'HEAD', headers: { ...headers, 'Prefer': 'count=exact' } });
      if (!res2.ok) {
        const body = await res2.text().catch(() => '');
        throw new Error('Supabase ' + res2.status + ': ' + (body || res2.statusText));
      }
      const count = parseInt(res2.headers.get('content-range')?.split('/')[1] || '0', 10);
      result = { count: isNaN(count) ? 0 : count };
    } else if (method === 'update') {
      if (!id && !filters.length) { res.writeHead(400); res.end(JSON.stringify({ error: 'id or filters required for update' })); return; }
      const filterQ = [];
      if (id) filterQ.push('id=eq.' + encodeURIComponent(String(id)));
      for (const f of filters) filterQ.push(encodeURIComponent(f.field) + '=eq.' + encodeURIComponent(String(f.value)));
      const url = tableUrl + '?' + filterQ.join('&');
      const res2 = await fetchWithTimeout(url, { method: 'PATCH', headers, body: JSON.stringify(data || {}) });
      if (!res2.ok) {
        const body = await res2.text().catch(() => '');
        throw new Error('Supabase ' + res2.status + ': ' + (body || res2.statusText));
      }
      result = { success: true };
    } else if (method === 'upsert') {
      const res2 = await fetchWithTimeout(tableUrl, {
        method: 'POST', headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(data || {}),
      });
      if (!res2.ok) {
        const body = await res2.text().catch(() => '');
        throw new Error('Supabase ' + res2.status + ': ' + (body || res2.statusText));
      }
      result = await res2.json();
    } else if (method === 'insert') {
      const res2 = await fetchWithTimeout(tableUrl, { method: 'POST', headers, body: JSON.stringify(data || {}) });
      if (!res2.ok) {
        const body = await res2.text().catch(() => '');
        throw new Error('Supabase ' + res2.status + ': ' + (body || res2.statusText));
      }
      result = await res2.json();
    } else if (method === 'delete') {
      if (!id && !filters.length) { res.writeHead(400); res.end(JSON.stringify({ error: 'id or filters required for delete' })); return; }
      const filterQ = [];
      if (id) filterQ.push('id=eq.' + encodeURIComponent(String(id)));
      for (const f of filters) filterQ.push(encodeURIComponent(f.field) + '=eq.' + encodeURIComponent(String(f.value)));
      const url = tableUrl + '?' + filterQ.join('&');
      const res2 = await fetchWithTimeout(url, { method: 'DELETE', headers });
      if (!res2.ok) {
        const body = await res2.text().catch(() => '');
        throw new Error('Supabase ' + res2.status + ': ' + (body || res2.statusText));
      }
      result = { success: true };
    } else {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid method' })); return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: result }));
  } catch (err) {
    const isAbort = err.name === 'AbortError' || err.message?.includes('abort') || err.message?.includes('timeout');
    console.error('[supabaseProxy] ' + (isAbort ? 'TIMEOUT' : 'Error') + ':', err.message);
    if (!isAbort) console.error('[supabaseProxy] Stack:', err.stack?.split('\n').slice(0, 4).join('\n'));
    const status = isAbort ? 504 : 500;
    const errorMsg = isAbort ? 'Database request timed out. Please try again.' : 'Internal server error';
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: errorMsg }));
  }
};