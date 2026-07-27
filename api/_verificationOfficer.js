const verificationEngine = require('./_verification/index.js');

function log(msg) {
  console.log('[' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '] [OFFICER] ' + msg);
}

function now() { return new Date().toISOString(); }

async function runOfficerVerification(order, screenshotUrl, userId, userEnteredUtr, userEnteredUpi) {
  const t0 = Date.now();
  log('Starting verification for ' + (order.id || 'unknown') + ', amount=' + order.amount);

  const orderObj = {
    id: order.id,
    amount: order.amount,
    type: order.type || 'registration',
    created_at: order.created_at || now(),
    expected_upi_id: require('./_shared.js').ADMIN_UPI_ID,
  };

  const v = await verificationEngine.run(orderObj, screenshotUrl, userId, userEnteredUtr);

  log('Done: status=' + v.status + ' score=' + v.verificationScore + ' (' + (Date.now() - t0) + 'ms)');
  return v;
}

module.exports = { runOfficerVerification };
