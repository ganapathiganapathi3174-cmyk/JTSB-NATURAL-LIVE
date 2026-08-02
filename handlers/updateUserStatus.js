const { COL_USERS } = require('../api/_shared.js');
const { updateDoc, addDoc } = require('../api/_supabase.js');

module.exports = async (req, res) => {
  try {
    if (!req.admin) { res.writeHead(401); res.end(JSON.stringify({ error: 'Authentication required' })); return; }
    const { userId, status, reason } = req.body || {};
    if (!userId || !status) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'userId and status are required' }));
      return;
    }
    const validStatuses = ['active', 'suspended', 'inactive', 'blocked'];
    if (!validStatuses.includes(status)) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid status. Must be: ' + validStatuses.join(', ') }));
      return;
    }
    await updateDoc(COL_USERS, userId, { account_status: status, status_changed_at: new Date().toISOString() });
    try {
      await addDoc('audit_logs', {
        action: 'update_user_status',
        target_id: userId,
        target_type: 'user',
        admin_id: req.admin?.email || 'unknown',
        details: { newStatus: status, reason: reason || '' },
        created_at: new Date().toISOString(),
      });
    } catch (e) { console.error('[updateUserStatus] Audit log failed: ' + e.message); }
    res.writeHead(200); res.end(JSON.stringify({ success: true, userId, status }));
  } catch (err) {
    console.error('[updateUserStatus] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
