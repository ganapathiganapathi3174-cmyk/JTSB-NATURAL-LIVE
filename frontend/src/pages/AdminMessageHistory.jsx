import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminSidebar from '../components/AdminSidebar.jsx';
import { FirebaseNotification } from '../db/firebase-db.js';

function getTypeLabel(type) {
  const labels = {
    user_activated: 'Account Approved',
    user_rejected: 'Account Rejected',
    payment_approved: 'Payment Approved',
    payment_rejected: 'Payment Rejected',
    topup_approved: 'Top-Up Approved',
    topup_rejected: 'Top-Up Rejected',
    admin_approval_approved: 'Access Approved',
    admin_approval_rejected: 'Access Rejected',
    general: 'Notification',
  };
  return labels[type] || type;
}

export default function AdminMessageHistory() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    const adminToken = localStorage.getItem('fb_admin_token');
    if (!adminToken) {
      navigate('/fb-admin', { replace: true });
      return;
    }
    setLoading(true);
    const unsub = FirebaseNotification.subscribeToAllNotifications((items) => {
      setNotifications(items);
      setLoading(false);
    });
    return () => { if (unsub) unsub(); };
  }, [navigate]);

  const filtered = useMemo(() => {
    let result = notifications;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(n =>
        (n.receiverId && n.receiverId.toLowerCase().includes(q)) ||
        (n.receiverName && n.receiverName.toLowerCase().includes(q)) ||
        (n.title && n.title.toLowerCase().includes(q)) ||
        (n.message && n.message.toLowerCase().includes(q)) ||
        (n.senderName && n.senderName.toLowerCase().includes(q))
      );
    }
    if (typeFilter !== 'all') {
      result = result.filter(n => n.type === typeFilter);
    }
    if (statusFilter !== 'all') {
      result = result.filter(n => n.status === statusFilter);
    }
    return result;
  }, [notifications, search, typeFilter, statusFilter]);

  const typeOptions = useMemo(() => {
    const types = new Set(notifications.map(n => n.type));
    return ['all', ...Array.from(types).sort()];
  }, [notifications]);

  return (
    <div className="fb-admin-layout animate-fade-in-up">
      <AdminSidebar userName={localStorage.getItem('fb_admin_name') || 'Admin'} pendingCounts={{}} />
      <main className="admin-main-content">
        <div className="admin-page">
          <div className="page-header">
            <h1 className="text-gradient">Message History</h1>
            <div className="admin-page-subtitle">All admin-to-user communications</div>
          </div>

          <div className="filters">
            <input className="input w-full glass-input" placeholder="Search by user ID, name, title, message, sender..."
              value={search} onChange={e => setSearch(e.target.value)} />
            <select className="input" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ maxWidth: '180px' }}>
              {typeOptions.map(t => (
                <option key={t} value={t}>{t === 'all' ? 'All Types' : getTypeLabel(t)}</option>
              ))}
            </select>
            <select className="input" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ maxWidth: '140px' }}>
              <option value="all">All Status</option>
              <option value="unread">Unread</option>
              <option value="read">Read</option>
            </select>
          </div>

          {loading ? (
            <div className="loading-page" style={{ padding: '2rem' }}>
              <div className="loading-spinner loading-spinner-lg" />
              <div className="loading-text">Loading messages...</div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="admin-empty-state"><p className="text-muted">No messages found.</p></div>
          ) : (
            <div className="table-wrap">
              <table className="table-modern table-wrap">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Receiver ID</th>
                    <th>Receiver</th>
                    <th>Title</th>
                    <th>Message</th>
                    <th>Sent By</th>
                    <th>Status</th>
                    <th>Read At</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(n => (
                    <tr key={n.id}>
                      <td data-label="Date">{n.createdAt ? new Date(n.createdAt).toLocaleString() : '-'}</td>
                      <td data-label="Receiver ID"><code style={{ fontSize: '0.75rem' }}>{n.receiverId || '-'}</code></td>
                      <td data-label="Receiver">{n.receiverName || '-'}</td>
                      <td data-label="Title">{n.title || getTypeLabel(n.type)}</td>
                      <td data-label="Message" className="msg-admin-message-cell">
                        <div className="card card-dim">{n.message}</div>
                      </td>
                      <td data-label="Sent By">{n.senderName || 'Admin'}</td>
                      <td data-label="Status">
                        <span className={`badge badge-xs ${n.status === 'read' ? 'badge-approved' : 'badge-rejected'}`}>
                          {n.status === 'read' ? 'Read' : 'Unread'}
                        </span>
                      </td>
                      <td data-label="Read At">{n.readAt ? new Date(n.readAt).toLocaleString() : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
