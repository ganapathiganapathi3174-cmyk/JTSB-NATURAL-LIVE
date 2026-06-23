const { COL_UPI_PAYMENTS } = require('../_shared.js');
const { runQuery } = require('../_supabase.js');

module.exports = async (req, res) => {
  try {
    const { type, status, search } = req.body || {};
    const filters = [];
    if (type) filters.push({ field: 'payment_type', op: 'EQUAL', value: type });
    if (status) filters.push({ field: 'status', op: 'EQUAL', value: status });
    if (search) {
      const docs = await runQuery(COL_UPI_PAYMENTS, filters, { orderBy: 'created_at', ascending: false, limit: 200 });
      const q = search.toLowerCase();
      const filtered = docs.filter(d =>
        (d.utr && d.utr.toLowerCase().includes(q)) ||
        (d.upi_id && d.upi_id.toLowerCase().includes(q))
      );
      res.writeHead(200); res.end(JSON.stringify(filtered)); return;
    }
    const docs = await runQuery(COL_UPI_PAYMENTS, filters, { orderBy: 'created_at', ascending: false, limit: 200 });
    res.writeHead(200); res.end(JSON.stringify(docs));
  } catch (err) {
    res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
  }
};
