const { COL_UPI_PAYMENTS } = require('../api/_shared.js');
const { deleteDoc, runQuery, addDoc } = require('../api/_supabase.js');
const { broadcast } = require('../api/_sse.js');

const VALID_TYPES = { registration: [120, 500, 1000], topup: [120, 500, 1000] };
const ACCEPTED_UPI = 'jayarajj126-3@okicici';

const utrLocks = new Map();

function TRACE(label) {
  console.log(`[VTRACE:${new Date().toISOString().slice(11,23)}] ${label}`);
}

module.exports = async (req, res) => {
  try {
    TRACE('V01: verifyUPIPayment STARTED');
    const { pendingRegId, userId, type, amount, utr, upiId, paymentDate, screenshotUrl } = req.body || {};
    const idForLookup = pendingRegId || userId;
    TRACE(`V02: body parsed, pendingRegId=${pendingRegId}, userId=${userId}, type=${type}, amount=${amount}`);
    if (!idForLookup || !type || !amount || !utr || !upiId || !paymentDate || !screenshotUrl) {
      TRACE('V03: Missing required fields — returning 400');
      res.writeHead(400); res.end(JSON.stringify({ error: 'Missing required fields' })); return;
    }

    if (!VALID_TYPES[type]) { TRACE('V04: invalid type'); res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid payment type' })); return; }
    if (!VALID_TYPES[type].includes(amount)) { TRACE('V05: invalid amount'); res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid amount for ' + type })); return; }
    if (upiId.toLowerCase() !== ACCEPTED_UPI.toLowerCase()) { TRACE('V06: invalid UPI'); res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid UPI ID' })); return; }
    if (!utr || utr.length < 12) { TRACE('V07: short UTR'); res.writeHead(400); res.end(JSON.stringify({ error: 'UTR must be at least 12 characters' })); return; }

    const utrKey = utr.trim().toUpperCase();
    TRACE('V08: UTR validation passed');
    if (utrLocks.has(utrKey)) {
      const lockTime = utrLocks.get(utrKey);
      if (Date.now() - lockTime < 10000) {
        TRACE('V09: duplicate lock');
        res.writeHead(429); res.end(JSON.stringify({ error: 'Duplicate submission detected. Please wait.' }));
        return;
      }
    }
    utrLocks.set(utrKey, Date.now());
    setTimeout(() => utrLocks.delete(utrKey), 10000);

    TRACE('V10: checking existing UTRs');
    try {
      const recentPayments = await runQuery(COL_UPI_PAYMENTS, [], { limit: 200 });
      if (recentPayments) {
        const existing = recentPayments.filter(p => p.utr === utr);
        for (const e of existing) {
          if (e.status === 'rejected') {
            await deleteDoc(COL_UPI_PAYMENTS, e.id);
            try { await addDoc('audit_logs', { action: 'auto_delete_rejected_utr', target_id: e.id, target_type: 'upi_payment', admin_id: 'system', details: { utr, reason: 'User re-submitted with same UTR' }, created_at: new Date().toISOString() }); } catch {}
          } else {
            TRACE('V11: UTR already under review');
            utrLocks.delete(utrKey);
            res.writeHead(409); res.end(JSON.stringify({ error: 'UTR already submitted and is under review' }));
            return;
          }
        }
      }
    } catch (e) {
      TRACE(`V11b: existing UTR query failed (non-critical): ${e.message}`);
    }

    TRACE('V12: checking daily limit');
    if (idForLookup) {
      try {
        const userPayments = await runQuery(COL_UPI_PAYMENTS, [
          { field: type === 'registration' ? 'pending_reg_id' : 'user_id', op: 'EQUAL', value: idForLookup },
        ], { limit: 20 });
        const todayStart = new Date().setHours(0, 0, 0, 0);
        const todayCount = userPayments ? userPayments.filter(p => {
          const t = p.created_at ? new Date(p.created_at).getTime() : 0;
          return t >= todayStart;
        }).length : 0;
        TRACE(`V13: todayCount=${todayCount}`);
        if (todayCount >= 3) {
          TRACE('V14: daily limit exceeded');
          utrLocks.delete(utrKey);
          res.writeHead(429); res.end(JSON.stringify({ error: 'Maximum 3 payment attempts per day' }));
          return;
        }
      } catch (e) {
        TRACE(`V14b: daily limit query failed (non-critical): ${e.message}`);
      }
    }

    const ocrAvailable = true;
    const initialStatus = ocrAvailable ? 'pending' : 'manual_review';
    TRACE(`V15: initialStatus=${initialStatus}`);

    const paymentData = {
      utr, upi_id: upiId.toLowerCase(), amount,
      amount_option: amount.toString(), payment_type: type,
      screenshot_url: screenshotUrl, payment_date: paymentDate,
      status: initialStatus,
      verification_locked: false,
    };
    if (type === 'registration') {
      paymentData.pending_reg_id = pendingRegId;
      paymentData.user_id = null;
    } else {
      paymentData.user_id = userId;
      paymentData.pending_reg_id = null;
    }

    TRACE('V16: inserting payment');
    const payment = await addDoc(COL_UPI_PAYMENTS, paymentData);
    TRACE(`V17: addDoc returned: id=${payment?.id}, status=${initialStatus}`);

    if (!payment || !payment.id || payment.id.startsWith('pending_')) {
      TRACE('V18: payment insert failed');
      utrLocks.delete(utrKey);
      res.writeHead(500); res.end(JSON.stringify({ error: 'Payment record could not be created' }));
      return;
    }

    TRACE('V19: payment insert SUCCESS, now auto-invoking processPendingPayments');
    try {
      const processHandler = require('./processPendingPayments.js');
      TRACE('V20: processHandler loaded');
      const mockReq = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {},
        admin: { email: 'system', role: 'admin', name: 'System Auto-Process' },
      };
      let responseData = null;
      const mockRes = {
        _status: 200,
        _headers: {},
        setHeader: function (k, v) { this._headers[k] = v; },
        writeHead: function (s, h) { this._status = s; if (h) Object.assign(this._headers, h); },
        end: function (d) { responseData = d; },
        json: function (d) { responseData = JSON.stringify(d); },
        status: function (c) { return { json: (d) => { this._status = c; responseData = JSON.stringify(d); } }; },
      };
      TRACE('V21: calling processHandler with mock req/res...');
      await processHandler(mockReq, mockRes);
      TRACE(`V22: processHandler returned. status=${mockRes._status}, result=${responseData ? responseData.substring(0, 200) : 'null'}`);
    } catch (autoErr) {
      TRACE(`V23: processHandler THREW: ${autoErr.message}`);
      TRACE(`V24: Stack: ${autoErr.stack ? autoErr.stack.substring(0, 500) : 'no stack'}`);
    }

    TRACE('V25: broadcasting SSE paymentCreated event');
    try { broadcast('paymentCreated', { id: payment.id, status: initialStatus, type }); } catch {}
    TRACE('V26: SSE broadcast done');

    utrLocks.delete(utrKey);
    TRACE('V27: sending response to client');
    res.writeHead(200); res.end(JSON.stringify({
      status: initialStatus,
      paymentId: payment.id,
      autoVerified: false,
      message: 'Payment received, auto-verification queued',
    }));
    TRACE('V28: verifyUPIPayment COMPLETE');
  } catch (err) {
    TRACE(`V29: UNCAUGHT ERROR: ${err.message}`);
    TRACE(`V30: Stack: ${err.stack ? err.stack.substring(0, 500) : 'no stack'}`);
    console.error('[verifyUPIPayment] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
