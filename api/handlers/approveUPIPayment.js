const { randomString } = require('../_shared.js');
const { runQuery, writeDoc, updateDoc, addDoc, deleteDoc } = require('../_supabase.js');

const COL_UPI_PAYMENTS = 'upi_payments';
const COL_USERS = 'users';
const COL_WALLET_BALANCES = 'wallet_balances';
const COL_WALLET_TX = 'wallet_transactions';
const COL_TOPUPS = 'topups';
const COL_PENDING_REGS = 'pending_registrations';
const COL_UNIQUES = 'uniques';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  try {
    const { paymentId } = req.body || {};
    if (!paymentId) { res.writeHead(400); res.end(JSON.stringify({ error: 'Payment ID is required' })); return; }

    const payments = await runQuery(COL_UPI_PAYMENTS, [{ field: 'id', op: 'EQUAL', value: paymentId }]);
    if (!payments.length) { res.writeHead(404); res.end(JSON.stringify({ error: 'Payment record not found' })); return; }
    const payment = payments[0];

    if (payment.status === 'verified') { res.writeHead(400); res.end(JSON.stringify({ error: 'Payment already verified' })); return; }

    const payType = payment.payment_type;
    const amountNum = payment.amount;

    if (payType === 'registration') {
      const pendingRegId = payment.user_id;
      if (!pendingRegId) { res.writeHead(400); res.end(JSON.stringify({ error: 'No registration session linked' })); return; }

      const pendingRegs = await runQuery(COL_PENDING_REGS, [{ field: 'id', op: 'EQUAL', value: pendingRegId }]);
      if (!pendingRegs.length) { res.writeHead(400); res.end(JSON.stringify({ error: 'Registration session not found' })); return; }
      const pendingReg = pendingRegs[0];

      const newUserId = 'U' + randomString(16);
      const refCode = pendingReg.referral_code;

      let referredBy = null;
      if (refCode) {
        const refUsers = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: refCode }]);
        if (refUsers.length) referredBy = refUsers[0].id;
      }

      const userData = {
        id: newUserId, email: pendingReg.email, name: pendingReg.name || '',
        phone: pendingReg.phone || '', password_hash: pendingReg.password_hash,
        referral_code: randomString(8), referred_by: referredBy,
        account_status: 'active', payment_status: 'success',
        approved: true, active: true, membership_paid: true,
        joined_date: new Date().toISOString(), approved_date: new Date().toISOString(),
      };
      await writeDoc(COL_USERS, newUserId, userData);
      await writeDoc(COL_WALLET_BALANCES, newUserId, { balance: amountNum, total_earned: amountNum });

      await addDoc(COL_WALLET_TX, {
        user_id: newUserId, type: 'deposit', amount: amountNum,
        description: 'Registration payment (admin approved)', reference_id: payment.id, balance_after: amountNum,
      });

      if (referredBy) {
        const sponsorWallets = await runQuery(COL_WALLET_BALANCES, [{ field: 'id', op: 'EQUAL', value: referredBy }]);
        if (sponsorWallets.length) {
          const sponsorWallet = sponsorWallets[0];
          const refAmount = amountNum * 0.1;
          const newBal = (sponsorWallet.balance || 0) + refAmount;
          await updateDoc(COL_WALLET_BALANCES, referredBy, { balance: newBal, total_earned: (sponsorWallet.total_earned || 0) + refAmount });
          await addDoc(COL_WALLET_TX, {
            user_id: referredBy, type: 'referral_bonus', amount: refAmount,
            description: 'Referral bonus for ' + newUserId, balance_after: newBal,
          });
        }
      }

      try { await deleteDoc(COL_PENDING_REGS, pendingRegId); } catch {}

      await updateDoc(COL_UPI_PAYMENTS, payment.id, { status: 'verified', verified_at: new Date().toISOString() });

      res.writeHead(200); res.end(JSON.stringify({ status: 'approved', userId: newUserId })); return;
    }

    if (payType === 'topup') {
      const userId = payment.user_id;
      if (!userId) { res.writeHead(400); res.end(JSON.stringify({ error: 'No user linked to this payment' })); return; }

      const userDocs = await runQuery(COL_USERS, [{ field: 'id', op: 'EQUAL', value: userId }]);
      if (!userDocs.length) { res.writeHead(400); res.end(JSON.stringify({ error: 'User not found' })); return; }

      const wallets = await runQuery(COL_WALLET_BALANCES, [{ field: 'id', op: 'EQUAL', value: userId }]);
      const wallet = wallets.length ? wallets[0] : { balance: 0, total_earned: 0 };
      const newBalance = (wallet.balance || 0) + amountNum;
      await writeDoc(COL_WALLET_BALANCES, userId, { balance: newBalance, total_earned: (wallet.total_earned || 0) + amountNum });

      await addDoc(COL_WALLET_TX, {
        user_id: userId, type: 'deposit', amount: amountNum,
        description: 'Topup via UPI (admin approved)', reference_id: payment.id, balance_after: newBalance,
      });
      await addDoc(COL_TOPUPS, {
        user_id: userId, amount: amountNum, status: 'approved',
      });

      await updateDoc(COL_UPI_PAYMENTS, payment.id, { status: 'verified', verified_at: new Date().toISOString() });

      res.writeHead(200); res.end(JSON.stringify({ status: 'approved', userId })); return;
    }

    res.writeHead(400); res.end(JSON.stringify({ error: 'Unknown payment type' }));
  } catch (err) {
    res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
  }
};
