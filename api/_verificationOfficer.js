const engine = require('./_verification/index.js');

async function run(order, url, uid, utr, upi, buf) {
  console.log('[OFFICER] verify ' + (order && order.id) + ' amt=' + (order && order.amount));
  const v = await engine.run(order, url, uid, utr, buf);
  return v;
}

module.exports = { runOfficerVerification: run };