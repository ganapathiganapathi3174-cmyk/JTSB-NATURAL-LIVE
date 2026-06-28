const { COL_USERS, COL_WALLET_BALANCES, COL_WALLET_TX, COL_PENDING_REGS, randomString, crypto } = require('../api/_shared.js');
const { runQuery, writeDoc, addDoc, deleteDoc } = require('../api/_supabase.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }
  if (!req.admin) { res.writeHead(401); res.end(JSON.stringify({ error: 'Authentication required' })); return; }

  try {
    const { pendingRegId } = req.body || {};
    if (!pendingRegId) { res.writeHead(400); res.end(JSON.stringify({ error: 'pendingRegId is required' })); return; }

    const pendingRegs = await runQuery(COL_PENDING_REGS, [{ field: 'id', op: 'EQUAL', value: pendingRegId }]);
    if (!pendingRegs.length) { res.writeHead(404); res.end(JSON.stringify({ error: 'Pending registration not found' })); return; }

    const pendingReg = pendingRegs[0];
    const now = new Date().toISOString();
    const newUserId = crypto.randomUUID();

    // Find referrer by referral code (store the CODE string, not UUID)
    let referredByUserId = null;
    let referredByCode = null;
    if (pendingReg.referral_code) {
      const refUsers = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: pendingReg.referral_code }]);
      if (refUsers.length) { referredByUserId = refUsers[0].id; referredByCode = pendingReg.referral_code; }
    }

    await writeDoc(COL_USERS, newUserId, {
      id: newUserId,
      email: pendingReg.email,
      name: pendingReg.name,
      phone: pendingReg.phone,
      password_hash: pendingReg.password_hash,
      referral_code: randomString(8),
      referred_by: referredByCode,
      account_status: 'active',
      payment_status: 'success',
      approved: true,
      active: true,
      membership_paid: true,
      joined_date: now,
      approved_date: now,
    });

    await writeDoc(COL_WALLET_BALANCES, newUserId, { balance: 0, total_earned: 0 });

    // Audit log
    try { await addDoc('audit_logs', { action: 'direct_approve_registration', target_id: pendingRegId, target_type: 'pending_registration', admin_id: req.admin?.email || 'unknown', details: { userId: newUserId, referredBy: referredByCode }, created_at: now }); } catch {}

    await deleteDoc(COL_PENDING_REGS, pendingRegId);

    try { await addDoc('notifications', { receiverId: newUserId, title: 'Registration Approved', message: 'Your registration has been approved and your account is now active.', type: 'payment_approved', status: 'unread', createdAt: now, senderId: 'system', senderName: 'System' }); } catch {}

    res.writeHead(200); res.end(JSON.stringify({ status: 'approved', userId: newUserId }));
  } catch (err) {
    console.error('[approvePendingRegistration] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
