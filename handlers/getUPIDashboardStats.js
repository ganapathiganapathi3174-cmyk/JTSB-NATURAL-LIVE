const { COL_UPI_PAYMENTS } = require('../api/_shared.js');
const { runQuery, countQuery } = require('../api/_supabase.js');

module.exports = async (req, res) => {
  try {
    const totalUsers = await countQuery('users');
    const allPayments = await runQuery(COL_UPI_PAYMENTS, [], { select: 'status,payment_type' });
    const pending = allPayments.filter(p => p.status === 'pending').length;
    const verified = allPayments.filter(p => p.status === 'verified').length;
    const rejected = allPayments.filter(p => p.status === 'rejected').length;
    const manual = allPayments.filter(p => p.status === 'manual_review').length;
    const regPayments = allPayments.filter(p => p.payment_type === 'registration').length;
    const topupPayments = allPayments.filter(p => p.payment_type === 'topup').length;

    res.writeHead(200); res.end(JSON.stringify({
      totalUsers, pendingPayments: pending, verifiedPayments: verified,
      rejectedPayments: rejected, manualReviewPayments: manual,
      registrationPayments: regPayments, topupPayments,
    }));
  } catch (err) {
    res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
  }
};
