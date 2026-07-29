const { resendOtp } = require('../api/_otpManager.js');

module.exports = async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (!sessionId) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId is required' })); return; }

    const result = await resendOtp(sessionId);
    if (result.error) {
      const status = result.error.includes('exceeded') ? 429 : 400;
      res.writeHead(status); res.end(JSON.stringify({ error: result.error })); return;
    }

    log('OTP', `Resent OTP for session ${sessionId}`);
    res.writeHead(200); res.end(JSON.stringify({ status: 'otp_sent', otpExpiresAt: result.otpExpiresAt }));
  } catch (e) {
    console.error('[pipelineResendOtp] Error:', e.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};

function log(tag, msg) {
  console.log(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] [${tag}] ${msg}`);
}
