const { COL_UPI_PAYMENTS, COL_PENDING_REGS } = require('../_shared.js');
const { deleteDoc, runQuery, writeDoc, addDoc } = require('../_supabase.js');

const VALID_TYPES = { registration: [120, 500, 1000], topup: [120, 500, 1000] };
const ACCEPTED_UPI = 'jayarajj126-3@okicici';

module.exports = async (req, res) => {
  try {
    const { pendingRegId, type, amount, utr, upiId, paymentDate, screenshotUrl } = req.body || {};
    if (!pendingRegId || !type || !amount || !utr || !upiId || !paymentDate || !screenshotUrl) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Missing required fields' })); return;
    }

    if (!VALID_TYPES[type]) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid payment type' })); return; }
    if (!VALID_TYPES[type].includes(amount)) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid amount for ' + type })); return; }
    if (upiId.toLowerCase() !== ACCEPTED_UPI.toLowerCase()) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid UPI ID' })); return; }
    if (!utr || utr.length < 4) { res.writeHead(400); res.end(JSON.stringify({ error: 'UTR must be at least 4 characters' })); return; }

    const existing = await runQuery(COL_UPI_PAYMENTS, [{ field: 'utr', op: 'EQUAL', value: utr }]);
    for (const e of existing) {
      if (e.status === 'rejected') await deleteDoc(COL_UPI_PAYMENTS, e.id);
      else { res.writeHead(409); res.end(JSON.stringify({ error: 'UTR already submitted and is under review' })); return; }
    }

    const payment = await addDoc(COL_UPI_PAYMENTS, {
      user_id: pendingRegId, utr, upi_id: upiId.toLowerCase(), amount,
      amount_option: amount.toString(), payment_type: type,
      screenshot_url: screenshotUrl, payment_date: paymentDate,
      status: 'pending',
    });

    res.writeHead(200); res.end(JSON.stringify({ status: 'pending', paymentId: payment.id }));
  } catch (err) {
    res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
  }
};
