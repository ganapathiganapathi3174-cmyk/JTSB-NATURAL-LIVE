const {
  ALLOWED_AMOUNTS, ACCEPTED_UPI, OTP_EXPIRY_MS,
  otpSessions, generateSessionId,
} = require('../api/_otpManager.js');
const { COL_PENDING_REGS, COL_USERS, COL_UPI_PAYMENTS } = require('../api/_shared.js');
const { runQuery, addDoc } = require('../api/_supabase.js');

module.exports = async (req, res) => {
  const startTime = Date.now();
  try {
    const { paymentType, amount, utr, pendingRegId, userId, screenshotUrl, paymentDate } = req.body || {};

    const errors = [];
    if (!paymentType || !['registration', 'topup'].includes(paymentType)) errors.push('paymentType must be registration or topup');
    if (!amount || !ALLOWED_AMOUNTS.includes(Number(amount))) errors.push(`Amount must be one of: ₹${ALLOWED_AMOUNTS.join(', ₹')}`);
    if (!utr || utr.length < 12) errors.push('UTR must be at least 12 characters');
    if (!screenshotUrl) errors.push('Screenshot URL is required');
    const idForLookup = paymentType === 'registration' ? pendingRegId : userId;
    if (!idForLookup) errors.push(paymentType === 'registration' ? 'pendingRegId is required' : 'userId is required');
    if (errors.length) { res.writeHead(400); res.end(JSON.stringify({ error: errors.join('. ') })); return; }

    if (paymentType === 'registration') {
      const pending = await runQuery(COL_PENDING_REGS, [{ field: 'id', op: 'EQUAL', value: pendingRegId }]);
      if (!pending || pending.length === 0) { res.writeHead(404); res.end(JSON.stringify({ error: 'Pending registration not found' })); return; }
      var pendingReg = pending[0];
    } else {
      const user = await runQuery(COL_USERS, [{ field: 'id', op: 'EQUAL', value: userId }]);
      if (!user || user.length === 0) { res.writeHead(404); res.end(JSON.stringify({ error: 'User not found' })); return; }
    }

    const sessionId = generateSessionId();
    const session = {
      sessionId, paymentType, amount: Number(amount), utr: utr.toUpperCase().trim(),
      screenshotUrl, paymentDate: paymentDate || new Date().toISOString().split('T')[0],
      createdAt: Date.now(), status: 'verifying',
      stages: {},
    };
    if (paymentType === 'registration') { session.pendingRegId = pendingRegId; session.pendingReg = pendingReg; }
    else { session.userId = userId; }
    otpSessions.set(sessionId, session);

    log('SUBMIT', `Session ${sessionId}: ${paymentType}, amount=${amount}, utr=${utr.slice(0, 6)}****`);
    session.status = 'pending_review';
    otpSessions.set(sessionId, session);
    res.writeHead(200); res.end(JSON.stringify({
      sessionId, status: 'pending_review',
      message: 'Payment submitted for verification. Admin will review shortly.',
      paymentType, amount: Number(amount),
    }));

    try {
      await addDoc(COL_UPI_PAYMENTS, {
        utr, upi_id: ACCEPTED_UPI, amount: Number(amount),
        amount_option: String(amount), payment_type: paymentType,
        screenshot_url: screenshotUrl, payment_date: session.paymentDate,
        status: session.status === 'otp_sent' ? 'pending_otp' : session.status,
        pipeline_session: sessionId, created_at: new Date().toISOString(),
      });
    } catch (e) { log('SUBMIT', `DB save skipped: ${e.message}`); }

  } catch (e) {
    console.error('[pipelinePayment] Error:', e.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};

function log(tag, msg) {
  console.log(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] [${tag}] ${msg}`);
}
