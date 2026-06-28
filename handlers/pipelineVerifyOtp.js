const { verifyOtp, processPaymentApproval } = require('../api/_pipelineEngine.js');

module.exports = async (req, res) => {
  try {
    const { sessionId, otp } = req.body || {};
    if (!sessionId || !otp) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId and otp are required' })); return; }
    if (!/^\d{6}$/.test(otp)) { res.writeHead(400); res.end(JSON.stringify({ error: 'OTP must be 6 digits' })); return; }

    const verification = await verifyOtp(sessionId, otp);
    if (verification.error) {
      const status = verification.error.includes('exceeded') ? 429
        : verification.error.includes('expired') ? 410
        : verification.error.includes('verified') ? 400
        : 400;
      res.writeHead(status); res.end(JSON.stringify({ error: verification.error })); return;
    }

    log('OTP', `Session ${sessionId}: OTP verified, processing approval...`);
    const approval = await processPaymentApproval(sessionId);

    if (approval.error) {
      res.writeHead(500); res.end(JSON.stringify({ error: approval.error })); return;
    }

    log('OTP', `Session ${sessionId}: ${verification.session.paymentType} approved successfully`);
    res.writeHead(200); res.end(JSON.stringify({
      status: 'approved',
      sessionId,
      paymentType: verification.session.paymentType,
      amount: verification.session.amount,
      ...approval,
    }));
  } catch (e) {
    console.error('[pipelineVerifyOtp] Error:', e.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};

function log(tag, msg) {
  console.log(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] [${tag}] ${msg}`);
}
