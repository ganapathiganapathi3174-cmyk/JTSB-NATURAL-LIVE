const { runQuery } = require('../api/_supabase.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (!req.admin) { res.writeHead(401); res.end(JSON.stringify({ error: 'Authentication required' })); return; }

  try {
    const url = new URL(req.url, 'http://localhost');
    const action = url.searchParams.get('action') || '';
    const targetType = url.searchParams.get('targetType') || '';
    const days = parseInt(url.searchParams.get('days') || '7', 10);
    const limit = parseInt(url.searchParams.get('limit') || '200', 10);

    const filters = [];
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    filters.push({ field: 'created_at', op: 'GREATER_OR_EQUAL', value: startDate.toISOString() });

    if (action) {
      filters.push({ field: 'action', op: 'EQUAL', value: action });
    }
    if (targetType) {
      filters.push({ field: 'target_type', op: 'EQUAL', value: targetType });
    }

    let logs = [];
    try {
      logs = await runQuery('audit_logs', filters, {
        orderBy: 'created_at', ascending: false, limit: Math.min(limit, 1000),
      });
    } catch (innerErr) {
      if (innerErr.message && innerErr.message.includes('Could not find the table')) {
        logs = [];
      } else {
        throw innerErr;
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      logs: logs || [],
      total: (logs || []).length,
    }));
  } catch (err) {
    console.error('[getAuditLogs] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
