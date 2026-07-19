import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const isThisYear = d.getFullYear() === now.getFullYear();
  if (isThisYear) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function UserMessageCenter() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const listEndRef = useRef(null);

  const userId = localStorage.getItem('fb_user_id');

  useEffect(() => {
    if (!userId) {
      navigate('/fb/login', { replace: true });
      return;
    }
    setLoading(true);
    const unsub = FirebaseNotification.subscribeToUserNotifications(userId, (items) => {
      setNotifications(items);
      setLoading(false);
    });
    return () => { if (unsub) unsub(); };
  }, [userId, navigate]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [notifications]);

  async function handleMarkAllRead() {
    try {
      await FirebaseNotification.markAllAsRead(userId);
    } catch (err) {
      console.error('Failed to mark all as read:', err);
    }
  }

  async function handleMarkAsRead(n) {
    if (n.status === 'unread') {
      try {
        await FirebaseNotification.markAsRead(n.id);
      } catch (err) {
        console.error('Failed to mark as read:', err);
      }
    }
  }

  const unreadCount = notifications.filter(n => n.status === 'unread').length;

  const groupByDate = (items) => {
    const groups = {};
    items.forEach(item => {
      if (!item.createdAt) return;
      const key = new Date(item.createdAt).toLocaleDateString();
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    return groups;
  };

  const grouped = groupByDate(notifications);

  return (
    <div className="page-wrap animate-fade-in-up" style={{ maxWidth: '720px', margin: '0 auto' }}>
      <div className="glass-strong flex-between items-center mb-md" style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius-lg)' }}>
        <button className="btn-ghost btn-sm" onClick={() => navigate('/fb/dashboard')}>
          {'\u2190'} Dashboard
        </button>
        <h1 className="text-lg font-bold text-gradient">Inbox</h1>
        {unreadCount > 0 && (
          <button className="btn-ghost btn-sm" onClick={handleMarkAllRead}>
            Mark All Read ({unreadCount})
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col items-center gap-md" style={{ padding: '2rem' }}>
          <div className="loading-spinner loading-spinner-lg" />
          <div className="loading-text">Loading messages...</div>
        </div>
      ) : notifications.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          </div>
          <p className="empty-text">No messages yet.</p>
          <p className="text-muted text-sm">Admin communications will appear here.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-sm">
          {Object.entries(grouped).reverse().map(([dateLabel, items]) => (
            <div key={dateLabel}>
              <div className="text-center mb-sm mt-md">
                <span className="text-muted text-xs font-semibold" style={{ background: 'var(--surface-2)', padding: '0.2rem 0.75rem', borderRadius: 12 }}>{dateLabel}</span>
              </div>
              {items.map(n => (
              <div
                key={n.id}
                onClick={() => handleMarkAsRead(n)}
                className={`glass card mb-sm animate-fade-in-up`}
                style={{
                  cursor: 'pointer',
                  background: n.status === 'unread' ? 'var(--accent-light)' : '',
                  border: n.status === 'unread' ? '1px solid var(--accent-glow)' : '',
                }}
                >
                  <div className="flex-between items-center mb-xs">
                    <div className="flex items-center gap-xs">
                      <strong className="text-sm">{n.title || getTypeLabel(n.type)}</strong>
                      {n.status === 'unread' && <span className="badge badge-primary badge-xs">New</span>}
                    </div>
                    <span className="text-xs" style={{ color: 'var(--muted-2)', whiteSpace: 'nowrap' }}>{formatTime(n.createdAt)}</span>
                  </div>
                  <div className="text-sm" style={{ color: 'var(--text-2)', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{n.message}</div>
                  <div className="text-xs mt-xs" style={{ color: 'var(--muted-2)' }}>
                    From: {n.senderName || 'Admin'} {'\u00B7'} <span style={{ color: n.status === 'read' ? 'var(--success)' : 'var(--muted-2)' }}>
                      {n.status === 'read' ? 'Read' : 'Sent'}
                    </span>
                    {n.readAt && n.status === 'read' && (
                      <span> {'\u00B7'} {new Date(n.readAt).toLocaleString()}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
          <div ref={listEndRef} />
        </div>
      )}
    </div>
  );
}
