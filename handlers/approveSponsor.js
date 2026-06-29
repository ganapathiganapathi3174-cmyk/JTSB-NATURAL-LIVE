const { COL_USERS } = require('../api/_shared.js');
const { runQuery, updateDoc, addDoc } = require('../api/_supabase.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }
  if (!req.admin) { res.writeHead(401); res.end(JSON.stringify({ error: 'Authentication required' })); return; }

  try {
    const { userId } = req.body || {};
    if (!userId) { res.writeHead(400); res.end(JSON.stringify({ error: 'userId is required' })); return; }

    const users = await runQuery(COL_USERS, [{ field: 'id', op: 'EQUAL', value: userId }], { limit: 1 });
    if (!users.length) { res.writeHead(404); res.end(JSON.stringify({ error: 'User not found' })); return; }

    const user = users[0];
    const now = new Date().toISOString();

    // Reactivate account
    // Keep existing referral data intact: referrals_count, total_referral_count, referral_code
    // Do NOT regenerate referral code or reactivate old referral link
    await updateDoc(COL_USERS, userId, {
      account_status: 'active',
      inactive_reason: null,
      referral_limit_reached: false,
      activated_at: now,
      activated_by: req.admin?.email || 'unknown',
      activation_reason: 'Admin approved sponsor reactivation after reaching referral limit',
    });

    // Audit log
    try {
      await addDoc('audit_logs', {
        action: 'approve_sponsor',
        target_id: userId,
        target_type: 'user',
        admin_id: req.admin?.email || 'unknown',
        details: {
          referralCode: user.referral_code,
          referralCount: user.referrals_count || 0,
          reason: 'Sponsor reactivated by admin — referral limit was reached',
          oldReferralActive: user.referral_active,
          oldReferralCodeKept: true,
          oldLinkRemainsExpired: true,
        },
        created_at: now,
      });
    } catch {}

    // Admin notification
    try {
      await addDoc('notifications', {
        receiverId: userId,
        title: 'Account Reactivated',
        message: 'Your account has been reactivated by admin. Your referral link remains expired and cannot be reused.',
        type: 'account_reactivated',
        status: 'unread',
        createdAt: now,
        senderId: 'system',
        senderName: 'System',
      });
    } catch {}

    res.writeHead(200);
    res.end(JSON.stringify({ status: 'approved', userId, message: 'Sponsor account reactivated. Old referral link remains expired.' }));
  } catch (err) {
    console.error('[approveSponsor] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
