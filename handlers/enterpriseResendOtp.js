const { otpSessions, OTP_EXPIRY_MS, generateOtp } = require('../api/_enterpriseEngine.js');

module.exports = async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (!sessionId) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId is required' })); return; }

    const session = otpSessions.get(sessionId);
    if (!session) { res.writeHead(404); res.end(JSON.stringify({ error: 'Session not found' })); return; }
    if (session.otpVerified) { res.writeHead(400); res.end(JSON.stringify({ error: 'OTP already verified' })); return; }
    if (session.otpAttempts >= 3) { res.writeHead(429); res.end(JSON.stringify({ error: 'Maximum OTP attempts exceeded. Session blocked.' })); return; }
    if (session.status !== 'otp_sent') { res.writeHead(400); res.end(JSON.stringify({ error: 'Session not in OTP waiting state' })); return; }

    const now = Date.now();
    if (session.otpExpiresAt && now < session.otpExpiresAt && session.otpExpiresAt - now > 240000) {
      res.writeHead(429); res.end(JSON.stringify({ error: 'OTP still valid. Wait before requesting a new one.' })); return;
    }

    const otp = generateOtp();
    session.otp = otp;
    session.otpExpiresAt = Date.now() + OTP_EXPIRY_MS;
    otpSessions.set(sessionId, session);

    log('OTP', `Resent OTP ${otp} for session ${sessionId}`);
    res.writeHead(200); res.end(JSON.stringify({ status: 'otp_sent', otpExpiresAt: session.otpExpiresAt }));
  } catch (e) {
    console.error('[enterpriseResendOtp] Error:', e.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};

function log(tag, msg) {
  console.log(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] [${tag}] ${msg}`);
}
