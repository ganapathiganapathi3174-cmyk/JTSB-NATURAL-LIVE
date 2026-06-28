const { otpSessions, MAX_OTP_ATTEMPTS, processPaymentApproval } = require('../api/_enterpriseEngine.js');

module.exports = async (req, res) => {
  try {
    const { sessionId, otp } = req.body || {};
    if (!sessionId || !otp) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId and otp are required' })); return; }
    if (!/^\d{6}$/.test(otp)) { res.writeHead(400); res.end(JSON.stringify({ error: 'OTP must be 6 digits' })); return; }

    const session = otpSessions.get(sessionId);
    if (!session) { res.writeHead(404); res.end(JSON.stringify({ error: 'Session not found or expired' })); return; }
    if (session.otpVerified) { res.writeHead(400); res.end(JSON.stringify({ error: 'OTP already verified' })); return; }
    if (Date.now() > session.otpExpiresAt) { res.writeHead(410); res.end(JSON.stringify({ error: 'OTP expired' })); return; }
    if (session.otpAttempts >= MAX_OTP_ATTEMPTS) {
      session.status = 'otp_blocked';
      otpSessions.set(sessionId, session);
      res.writeHead(429); res.end(JSON.stringify({ error: 'Maximum OTP attempts exceeded' })); return;
    }

    session.otpAttempts++;
    if (session.otp !== otp) {
      otpSessions.set(sessionId, session);
      const remaining = MAX_OTP_ATTEMPTS - session.otpAttempts;
      res.writeHead(400); res.end(JSON.stringify({ error: `Invalid OTP. ${remaining} attempt(s) remaining.` })); return;
    }

    session.otpVerified = true;
    session.status = 'approved';
    session.verifiedAt = Date.now();
    otpSessions.set(sessionId, session);

    log('OTP', `Session ${sessionId}: OTP verified, processing approval...`);
    const approval = await processPaymentApproval(sessionId);

    if (approval.error) {
      session.status = 'approval_failed';
      otpSessions.set(sessionId, session);
      res.writeHead(500); res.end(JSON.stringify({ error: approval.error })); return;
    }

    log('OTP', `Session ${sessionId}: ${session.paymentType} approved successfully`);
    res.writeHead(200); res.end(JSON.stringify({
      status: 'approved',
      sessionId,
      paymentType: session.paymentType,
      amount: session.amount,
      ...approval,
    }));
  } catch (e) {
    console.error('[enterpriseVerifyOtp] Error:', e.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};

function log(tag, msg) {
  console.log(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] [${tag}] ${msg}`);
}
