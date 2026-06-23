const { COL_UPI_PAYMENTS } = require('../_shared.js');
const { runQuery, deleteDoc } = require('../_supabase.js');

module.exports = async (req, res) => {
  try {
    const { utr } = req.body || {};
    if (!utr) { res.writeHead(400); res.end(JSON.stringify({ error: 'UTR required' })); return; }
    const docs = await runQuery(COL_UPI_PAYMENTS, [{ field: 'utr', op: 'EQUAL', value: utr }]);
    for (const d of docs) {
      await deleteDoc(COL_UPI_PAYMENTS, d.id);
    }
    res.writeHead(200); res.end(JSON.stringify({ success: true }));
  } catch (err) {
    res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
  }
};
