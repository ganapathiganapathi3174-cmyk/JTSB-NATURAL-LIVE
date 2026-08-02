const { COL_USERS } = require('../api/_shared.js');
const { getDoc, updateDoc, addDoc } = require('../api/_supabase.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(200).end(); return; }
  if (req.method !== 'POST') { res.writeHead(405).end(JSON.stringify({ error: 'Method not allowed' })); return; }
  if (!req.admin) { res.writeHead(401).end(JSON.stringify({ error: 'Authentication required' })); return; }

  try {
    const { userId, action } = req.body || {};
    if (!userId) { res.writeHead(400).end(JSON.stringify({ error: 'userId is required' })); return; }
    if (!['activate', 'deactivate', 'reset'].includes(action)) {
      res.writeHead(400).end(JSON.stringify({ error: 'action must be activate, deactivate, or reset' })); return;
    }

    const user = await getDoc(COL_USERS, userId);
    if (!user) { res.writeHead(404).end(JSON.stringify({ error: 'User not found' })); return; }

    const now = new Date().toISOString();
    let updates = {};

    switch (action) {
      case 'activate':
        updates = {
          referral_active: true,
          referral_limit_reached: false,
          referral_expires_at: null,
        };
        break;
      case 'deactivate':
        updates = {
          referral_active: false,
          referral_limit_reached: true,
        };
        break;
      case 'reset':
        updates = {
          referral_active: true,
          referral_limit_reached: false,
          referrals_count: 0,
          total_referral_count: 0,
          is_qualified: false,
          referral_expires_at: null,
        };
        break;
    }

    await updateDoc(COL_USERS, userId, updates);

    try {
      await addDoc('audit_logs', {
        action: 'referral_status_' + action,
        target_id: userId,
        target_type: 'user',
        admin_id: req.admin?.email || 'unknown',
        details: { previousStatus: user.referral_active ? 'active' : 'inactive', newStatus: updates.referral_active ? 'active' : 'inactive', action },
        created_at: now,
      });
    } catch (e) { console.error('[updateReferralStatus] Audit log failed: ' + e.message); }

    res.writeHead(200).end(JSON.stringify({
      success: true,
      message: 'Referral status ' + (action === 'activate' ? 'activated' : action === 'deactivate' ? 'deactivated' : 'reset') + ' successfully',
      userId,
      referral_active: updates.referral_active,
      referrals_count: 'referrals_count' in updates ? updates.referrals_count : user.referrals_count,
    }));
  } catch (err) {
    console.error('[updateReferralStatus] Error:', err.message);
    res.writeHead(500).end(JSON.stringify({ error: 'Internal server error' }));
  }
};