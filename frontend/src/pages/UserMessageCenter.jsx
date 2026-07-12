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
    <div className="msg-center" style={{ maxWidth: '720px', margin: '0 auto', padding: '1rem' }}>
      <div className="msg-center-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <button className="btn-ghost btn-sm" onClick={() => navigate('/fb/dashboard')}>
          {'\u2190'} Dashboard
        </button>
        <h1 className="msg-center-title" style={{ fontSize: '1.25rem', margin: 0 }}>Inbox</h1>
        {unreadCount > 0 && (
          <button className="btn-ghost btn-sm" onClick={handleMarkAllRead}>
            Mark All Read ({unreadCount})
          </button>
        )}
      </div>

      {loading ? (
        <div className="loading-page" style={{ padding: '2rem' }}>
          <div className="loading-spinner loading-spinner-lg" />
          <div className="loading-text">Loading messages...</div>
        </div>
      ) : notifications.length === 0 ? (
        <div className="msg-empty">
          <div style={{ textAlign: 'center', padding: '3rem 1rem', opacity: 0.5 }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '1rem' }}>
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
            <p className="muted" style={{ margin: 0 }}>No messages yet.</p>
            <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>Admin communications will appear here.</p>
          </div>
        </div>
      ) : (
        <div className="msg-chat" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {Object.entries(grouped).reverse().map(([dateLabel, items]) => (
            <div key={dateLabel}>
              <div className="chat-date-divider">
                <span>{dateLabel}</span>
              </div>
              {items.map(n => (
                <div
                  key={n.id}
                  className={`msg-bubble ${n.status === 'unread' ? 'msg-bubble-unread' : ''}`}
                  onClick={() => handleMarkAsRead(n)}
                  style={{
                    background: n.status === 'unread' ? 'rgba(91,95,255,0.08)' : 'var(--surface)',
                    border: '1px solid',
                    borderColor: n.status === 'unread' ? 'rgba(91,95,255,0.2)' : 'var(--border)',
                    borderRadius: 'var(--radius)',
                    padding: '0.75rem 1rem',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <strong style={{ fontSize: '0.85rem' }}>{n.title || getTypeLabel(n.type)}</strong>
                      {n.status === 'unread' && <span className="msg-unread-dot" />}
                    </div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--muted-2)', whiteSpace: 'nowrap' }}>{formatTime(n.createdAt)}</span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-2)', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{n.message}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--muted-2)', marginTop: '0.35rem' }}>
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
