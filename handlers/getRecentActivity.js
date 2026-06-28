module.exports = async (req, res) => {
  try {
    const supabase = require('../api/_supabase.js');
    const client = supabase.getSupabaseClient();

    const [auditRes, deletionRes] = await Promise.all([
      client.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(50),
      client.from('deletion_audit_logs').select('*').order('deleted_at', { ascending: false }).limit(50),
    ]);

    const auditLogs = (auditRes.data || []).map(e => ({
      id: e.id,
      action: e.action,
      targetId: e.target_id,
      targetType: e.target_type,
      adminId: e.admin_id,
      details: e.details,
      createdAt: e.created_at,
      _type: 'audit',
    }));

    const deletionLogs = (deletionRes.data || []).map(e => ({
      id: e.id,
      action: 'delete_' + (e.record_type || 'record'),
      targetId: e.deleted_record_id,
      targetType: e.record_type,
      adminId: e.admin_id,
      details: { reason: e.reason, adminName: e.admin_name, deletedCount: e.deleted_count, collection: e.collection },
      createdAt: e.deleted_at,
      _type: 'deletion',
    }));

    const merged = [...deletionLogs, ...auditLogs]
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 50);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, activities: merged }));
  } catch (err) {
    console.error('[getRecentActivity] Error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
