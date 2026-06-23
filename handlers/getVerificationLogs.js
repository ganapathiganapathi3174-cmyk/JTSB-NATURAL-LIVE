const { COL_VERIFICATION_LOGS } = require('../api/_shared.js');
const { runQuery } = require('../api/_supabase.js');

module.exports = async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.body?.limit) || 50, 1), 200);
    const docs = await runQuery(COL_VERIFICATION_LOGS, [], { orderBy: 'created_at', ascending: false, limit });
    res.writeHead(200); res.end(JSON.stringify(docs));
  } catch (err) {
    res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
  }
};
