const { COL_VERIFICATION_LOGS } = require('../api/_shared.js');
const { runQuery } = require('../api/_supabase.js');

module.exports = async (req, res) => {
  try {
    let limit = 50;
    if (req.method === 'GET') {
      const query = require('url').parse(req.url, true).query;
      limit = parseInt(query.limit) || 50;
    } else {
      limit = parseInt(req.body?.limit) || 50;
    }
    limit = Math.min(Math.max(limit, 1), 200);
    const docs = await runQuery(COL_VERIFICATION_LOGS, [], { orderBy: 'created_at', ascending: false, limit });
    res.writeHead(200); res.end(JSON.stringify(docs));
  } catch (err) {
    console.error('[getVerificationLogs] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
