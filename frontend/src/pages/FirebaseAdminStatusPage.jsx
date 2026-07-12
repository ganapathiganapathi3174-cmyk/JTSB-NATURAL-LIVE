import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FirebaseUser } from '../db/firebase-db.js';
import { getSupabase } from '../supabase/config.js';
import AdminSidebar from '../components/AdminSidebar.jsx';

const ADMIN_KEY = 'fb_admin_token';

const STATUSES = {
  pending: { label: 'Pending', color: 'var(--warning)', bg: 'rgba(245, 165, 36, 0.15)', border: 'rgba(245, 165, 36, 0.3)' },
  suspicious: { label: 'Suspicious', color: 'var(--danger)', bg: 'rgba(243, 18, 96, 0.12)', border: 'rgba(243, 18, 96, 0.3)' },
  inactive: { label: 'Inactive', color: 'var(--muted)', bg: 'rgba(139, 147, 167, 0.15)', border: 'rgba(139, 147, 167, 0.3)' },
  active: { label: 'Active', color: 'var(--success)', bg: 'rgba(52, 199, 89, 0.15)', border: 'rgba(52, 199, 89, 0.3)' },
};

function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className={`toast toast-${type}`} onClick={onClose} role="alert">
      {message}
    </div>
  );
}

function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Confirm Status Change</h2>
        </div>
        <div className="modal-body">
          <p className="text-muted" style={{ lineHeight: 1.5, margin: 0 }}>{message}</p>
        </div>
        <div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={onConfirm}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

const StatusCard = React.memo(function StatusCard({ user, statusColor, onDragStart, onDragEnd, onTouchStart }) {
  return (
    <div
      className="kanban-card"
      draggable
      onDragStart={(e) => onDragStart(e, user)}
      onDragEnd={onDragEnd}
      onTouchStart={(e) => { if (onTouchStart) onTouchStart(e, user); }}
      style={{ borderLeftColor: statusColor }}
    >
      <div className="kanban-card-name">{user.name}</div>
      <div className="kanban-card-email">{user.email}</div>
      <div className="kanban-card-meta">
        {user.phone && <span>{user.phone}</span>}
        {user.referral_code && <span>#{user.referral_code}</span>}
      </div>
    </div>
  );
});

const StatusColumn = React.memo(function StatusColumn({ statusKey, config, users, onDrop, onDragStart, onDragEnd, isOver, draggedUser, onDragOverStatus, onTouchStart }) {
  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (onDragOverStatus) onDragOverStatus(statusKey);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    onDrop(statusKey);
  };

  return (
    <div
      className={`kanban-column ${isOver ? 'kanban-column-over' : ''}`}
      data-status={statusKey}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{ borderTopColor: config.color }}
    >
      <div className="kanban-header">
        <span className="kanban-dot" style={{ background: config.color }} />
        <span className="kanban-title">{config.label}</span>
        <span className="kanban-count">{users.length}</span>
      </div>
      <div className="kanban-body">
        {users.map(user => (
          <div
            key={user.id}
            style={{ opacity: draggedUser?.id === user.id ? 0.35 : 1, transition: 'opacity 0.15s' }}
          >
            <StatusCard
              user={user}
              statusColor={config.color}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onTouchStart={onTouchStart}
            />
          </div>
        ))}
        {users.length === 0 && (
          <div className="kanban-empty">Drop users here</div>
        )}
      </div>
    </div>
  );
});

export default function FirebaseAdminStatusPage() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [draggedUser, setDraggedUser] = useState(null);
  const [draggedOverStatus, setDraggedOverStatus] = useState(null);
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem(ADMIN_KEY);
    if (!token) {
      navigate('/fb-admin', { replace: true });
      return;
    }
    const unsub = FirebaseUser.subscribeToUsers(allUsers => setUsers(allUsers));
    return () => { if (unsub) unsub(); };
  }, [navigate]);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
  }, []);

  const groupedUsers = useMemo(() => {
    const groups = { pending: [], suspicious: [], inactive: [], active: [] };
    const q = (searchQuery || '').toLowerCase().trim();

    function deriveStatus(u) {
      if (u.admin_status) return u.admin_status;
      if (u.account_status === 'inactive') return 'inactive';
      if ((u.payment_status === 'approved' || u.payment_status === 'success') && u.account_status === 'active') return 'active';
      return 'pending';
    }

    users.forEach(u => {
      const status = deriveStatus(u);
      if (!groups[status]) groups[status] = [];

      if (q) {
        const match =
          (u.name && u.name.toLowerCase().includes(q)) ||
          (u.email && u.email.toLowerCase().includes(q)) ||
          (u.phone && u.phone.includes(q)) ||
          (u.referral_code && u.referral_code.toLowerCase().includes(q));
        if (!match) return;
      }

      groups[status].push(u);
    });

    Object.keys(groups).forEach(k => {
      groups[k].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    });

    return groups;
  }, [users, searchQuery]);

  const handleDragStart = useCallback((e, user) => {
    setDraggedUser(user);
    e.dataTransfer.setData('text/plain', user.id);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedUser(null);
    setDraggedOverStatus(null);
  }, []);

  const handleTouchStart = useCallback((e, user) => {
    setDraggedUser(user);
  }, []);

  const handleTouchMove = useCallback((e) => {
    const touch = e.touches[0];
    if (!touch) return;
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!el) return;
    const col = el.closest('.kanban-column');
    const key = col ? (Object.keys(STATUSES).find(k => col.dataset.status === k) || null) : null;
    setDraggedOverStatus(key);
  }, []);

  const executeDrop = useCallback(async (user, targetStatus) => {
    setDraggedOverStatus(null);
    setUpdating(true);
    try {
      const supabase = getSupabase();
      const updateFields = { admin_status: targetStatus };
      if (targetStatus === 'active') updateFields.account_status = 'active';
      if (targetStatus === 'inactive') updateFields.account_status = 'inactive';
      await supabase.from('users').update(updateFields).eq('id', user.id);
      showToast(`"${user.name}" moved to ${STATUSES[targetStatus].label}`);
    } catch (err) {
      showToast('Update failed: ' + (err.message || 'Unknown error'), 'error');
    } finally {
      setUpdating(false);
      setDraggedUser(null);
    }
  }, [showToast]);

  const handleDropWithTarget = useCallback((user, targetStatus) => {
    if (!user || user.admin_status === targetStatus) {
      setDraggedUser(null);
      return;
    }
    if (targetStatus === 'suspicious') {
      setConfirm({
        message: `Are you sure you want to mark "${user.name}" as ${STATUSES[targetStatus].label}?`,
        onConfirm: () => { setConfirm(null); executeDrop(user, targetStatus); },
        onCancel: () => { setConfirm(null); setDraggedUser(null); setDraggedOverStatus(null); },
      });
    } else {
      executeDrop(user, targetStatus);
    }
  }, [executeDrop]);

  const handleDrop = useCallback((targetStatus) => {
    setDraggedOverStatus(null);
    handleDropWithTarget(draggedUser, targetStatus);
  }, [draggedUser, handleDropWithTarget]);

  const handleTouchEnd = useCallback((e) => {
    if (!draggedUser) return;
    const touch = e.changedTouches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!el) { setDraggedUser(null); return; }
    const col = el.closest('.kanban-column');
    if (!col) { setDraggedUser(null); return; }
    const key = Object.keys(STATUSES).find(k => col.dataset.status === k);
    if (key && key !== draggedUser.admin_status) {
      handleDropWithTarget(draggedUser, key);
    } else {
      setDraggedUser(null);
      setDraggedOverStatus(null);
    }
  }, [draggedUser, handleDropWithTarget]);

  useEffect(() => {
    if (!draggedUser) return;
    let lastKey = null;
    const onMove = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el) return;
      const col = el.closest('.kanban-column');
      const key = col ? (Object.keys(STATUSES).find(k => col.dataset.status === k) || null) : null;
      if (key !== lastKey) { lastKey = key; setDraggedOverStatus(key); }
    };
    window.addEventListener('dragover', onMove);
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd);
    return () => {
      window.removeEventListener('dragover', onMove);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [draggedUser, handleTouchMove, handleTouchEnd]);

  const totalCount = users.length;
  const filteredCount = Object.values(groupedUsers).reduce((s, a) => s + a.length, 0);

  function getAdminName() {
    try {
      return sessionStorage.getItem('fb_admin_name') || localStorage.getItem('fb_admin_name') || 'Admin';
    } catch { return 'Admin'; }
  }

  return (
    <div className="layout-page">
      <AdminSidebar userName={getAdminName()} />

      <main>
        <div className="layout-inner">
          <div className="page-header">
            <h1 className="page-title">
              <span className="admin-page-title-icon">{'\u{1F4CB}'}</span>
              Status Board
            </h1>
            <div className="page-actions">
              <span className="muted text-sm">
                Showing {filteredCount} of {totalCount} users
              </span>
            </div>
          </div>

          <div className="card mb-md">
            <div className="filters" style={{ justifyContent: 'space-between' }}>
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by name, email, phone, code..."
              />
            </div>
          </div>

          <div className="kanban-board">
            {Object.entries(STATUSES).map(([key, config]) => (
              <StatusColumn
                key={key}
                statusKey={key}
                config={config}
                users={groupedUsers[key] || []}
                onDrop={handleDrop}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onTouchStart={handleTouchStart}
                isOver={draggedOverStatus === key}
                draggedUser={draggedUser}
              />
            ))}
          </div>
        </div>

        {toast && (
          <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
        )}
        {confirm && (
          <ConfirmModal
            message={confirm.message}
            onConfirm={confirm.onConfirm}
            onCancel={confirm.onCancel}
          />
        )}
      </main>
    </div>
  );
}
