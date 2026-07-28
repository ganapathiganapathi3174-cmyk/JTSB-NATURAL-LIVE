const { runQuery } = require('../_supabase.js');
const { COL_UPI_PAYMENTS } = require('../_shared.js');

async function check(field, value) {
  if (!value) return { field, duplicate: false };
  try {
    const rows = await runQuery(COL_UPI_PAYMENTS, [{ field, op: 'EQUAL', value }], { limit: 3 });
    if (rows && rows.length > 0) {
      const active = rows.filter(r => r.status !== 'rejected');
      if (active.length > 0) return { field, duplicate: true, id: active[0].id };
    }
  } catch (_) {}
  return { field, duplicate: false };
}

async function run(utrVal, txnVal, hashVal) {
  const results = await Promise.all([
    check('utr', utrVal),
    check('screenshot_hash', hashVal || ''),
  ]);
  const anyDup = results.some(r => r.duplicate);
  return { duplicate: anyDup, checks: results };
}

module.exports = { run };