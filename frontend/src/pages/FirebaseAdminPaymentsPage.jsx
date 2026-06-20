import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FirebaseUser } from '../db/firebase-db.js';

import AdminSidebar from '../components/AdminSidebar.jsx';

const ADMIN_KEY = 'fb_admin_token';

function getRelativeTime(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function PaymentDetailModal({ user, onClose }) {
  if (!user) return null;

  const statusLabel = user.payment_status ? user.payment_status.charAt(0).toUpperCase() + user.payment_status.slice(1) : 'Pending';
  const statusBadge = user.payment_status === 'approved' || user.payment_status === 'success' ? 'badge-paid' : user.payment_status === 'rejected' ? 'badge-rejected' : 'badge-pending';

  return (
    <div className="modal-modern-overlay" onClick={onClose}>
      <div className="modal-modern" onClick={e => e.stopPropagation()}>
        <div className="modal-modern-header">
          <h2>Payment Details</h2>
          <button onClick={onClose} className="btn-modern btn-modern-ghost btn-modern-sm">{'\u2715'}</button>
        </div>
        <div className="modal-modern-body">
          <div className="detail-grid-sm">
            <div>
              <div className="muted text-sm">User</div>
              <div className="font-bold" style={{ fontSize: '1.05rem' }}>{user.name}</div>
            </div>
            <div className="detail-grid-2col">
              <div>
                <div className="muted text-sm">Email</div>
                <div style={{ fontSize: '0.9rem' }}>{user.email}</div>
              </div>
              <div>
                <div className="muted text-sm">Phone</div>
                <div style={{ fontSize: '0.9rem' }}>{user.phone || '—'}</div>
              </div>
            </div>

            <div>
              <div className="muted text-sm">Payment Status</div>
              <span className={`badge ${statusBadge}`}>{statusLabel}</span>
            </div>

            {user.created_at && (
              <div>
                <div className="muted text-sm">Payment Date</div>
                <div style={{ fontSize: '0.9rem' }}>{formatDateTime(user.created_at)}</div>
                <div className="relative-time">{getRelativeTime(user.created_at)}</div>
              </div>
            )}

            {user.referred_by && (
              <div>
                <div className="muted text-sm">Referred By</div>
                <div>{user.referred_by}</div>
              </div>
            )}

            <div className="detail-grid-2col">
              <div>
                <div className="muted text-sm">Referral Code</div>
                <div className="font-mono">{user.referral_code}</div>
              </div>
              <div>
                <div className="muted text-sm">Total Referrals</div>
                <div>{user.total_referral_count || 0}</div>
              </div>
            </div>
          </div>
        </div>
        <div className="modal-modern-footer">
          <button className="btn-modern btn-modern-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default function FirebaseAdminPaymentsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [q, setQ] = useState('');
  const [smartFilter, setSmartFilter] = useState('');
  const [deleteConfirmUser, setDeleteConfirmUser] = useState(null);
  const [deleteSuccessMsg, setDeleteSuccessMsg] = useState('');
  const [deletingUser, setDeletingUser] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem(ADMIN_KEY);
    if (!token) { navigate('/fb-admin', { replace: true }); return; }
    const unsubscribe = FirebaseUser.subscribeToPayments((usersWithPayment) => {
      setUsers(usersWithPayment);
    });
    return () => { if (unsubscribe) unsubscribe(); };
  }, [navigate]);

  useEffect(() => {
    const status = searchParams.get('status');
    if (status) setSmartFilter(status);
  }, [searchParams]);

  const filteredUsers = useMemo(() => {
    let filtered = users;
    if (smartFilter) {
      switch (smartFilter) {
        case 'pending':
          filtered = filtered.filter(u => u.payment_status === 'pending');
          break;
        case 'approved':
          filtered = filtered.filter(u => u.payment_status === 'approved' || u.payment_status === 'success');
          break;
        case 'rejected':
          filtered = filtered.filter(u => u.payment_status === 'rejected');
          break;
        case 'today':
          filtered = filtered.filter(u => { if (!u.created_at) return false; return new Date(u.created_at).toDateString() === new Date().toDateString(); });
          break;
        case 'week':
          filtered = filtered.filter(u => { if (!u.created_at) return false; return new Date(u.created_at) >= new Date(Date.now() - 7 * 86400000); });
          break;
        default: break;
      }
    }
    if (q) {
      const ql = q.toLowerCase();
      filtered = filtered.filter(u => {
        const mName = u.name && u.name.toLowerCase().includes(ql);
        const mEmail = u.email && u.email.toLowerCase().includes(ql);
        return mName || mEmail;
      });
    }
    return filtered;
  }, [users, smartFilter, q]);

  const stats = useMemo(() => {
    let pending = 0, approved = 0, rejected = 0;
    for (const u of users) {
      const s = u.payment_status;
      if (s === 'pending') pending++;
      else if (s === 'approved' || s === 'success') approved++;
      else if (s === 'rejected') rejected++;
    }
    return { pending, approved, rejected };
  }, [users]);

  const handleDeleteUser = async (userId, userEmail, userPhone) => {
    try {
      await FirebaseUser.deleteUser(userId, { email: userEmail, phone: userPhone });
      setUsers(prev => prev.filter(u => u.id !== userId));
      setDeleteConfirmUser(null);
      setDeleteSuccessMsg('User permanently deleted');
      setTimeout(() => setDeleteSuccessMsg(''), 3000);
    } catch (err) {
      console.error('[DELETE ERROR]', err);
      setDeleteSuccessMsg('');
      const detail = err.response?.data?.message || err.message || 'Unknown error';
      alert('Delete failed: ' + detail + '\n\nCheck browser console (F12) for detailed error logs.');
    }
  };

  const updateSmartFilter = (value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('status', value);
    else next.delete('status');
    setSearchParams(next, { replace: true });
    setSmartFilter(value);
  };

  const openDetails = useCallback((user) => {
    setSelectedUser(user);
  }, []);

  const pendingCounts = useMemo(() => ({
    pendingPayments: stats.pending,
    pendingTopups: 0,
  }), [stats]);

  function getAdminName() {
    try {
      return sessionStorage.getItem('fb_admin_name') || localStorage.getItem('fb_admin_name') || 'Admin';
    } catch { return 'Admin'; }
  }

  return (
    <div className="admin-layout">
      <AdminSidebar pendingCounts={pendingCounts} userName={getAdminName()} />

      <main className="admin-content">
        <div className="admin-content-inner">
          <div className="admin-page-header">
            <h1 className="admin-page-title">
              <span className="admin-page-title-icon">{'\u{1F4B3}'}</span>
              Payments
            </h1>
            <div className="admin-page-actions">
              <span className="badge badge-pending text-xs">{stats.pending} pending</span>
            </div>
          </div>

          <div className="stats-grid-modern">
            <div className="stat-card-modern warning">
              <div className="stat-bg-icon">{'\u23F3'}</div>
              <div className="stat-value">{stats.pending}</div>
              <div className="stat-label">Pending Payments</div>
            </div>
            <div className="stat-card-modern success">
              <div className="stat-bg-icon">{'\u2705'}</div>
              <div className="stat-value">{stats.approved}</div>
              <div className="stat-label">Approved</div>
            </div>
            <div className="stat-card-modern danger">
              <div className="stat-bg-icon">{'\u2715'}</div>
              <div className="stat-value">{stats.rejected}</div>
              <div className="stat-label">Rejected</div>
            </div>
          </div>

          <div className="card-modern mb-md">
            <div className="card-modern-header">
              <h2 className="card-modern-title">{'\u{1F50D}'} Search & Filter</h2>
            </div>
            <div className="search-bar-modern">
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or email..." />
              <select value={smartFilter} onChange={e => updateSmartFilter(e.target.value)}>
                <option value="">All Payments</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option disabled>{'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'}</option>
                <option value="today">Today</option>
                <option value="week">This Week</option>
              </select>
            </div>
          </div>

          <div className="card-modern">
            <div className="card-modern-header">
              <h2 className="card-modern-title">{'\u{1F4CB}'} Payments ({filteredUsers.length})</h2>
            </div>
            <p className="muted text-sm mb-md">
              All payments are auto-approved via webhook. This page is read-only.
            </p>

            <div className="table-wrap-modern">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => {
                    const displayStatus = u.payment_status;
                    const displayBadge = displayStatus === 'approved' ? 'badge-paid' : displayStatus === 'rejected' ? 'badge-rejected' : 'badge-pending';
                    return (
                      <tr key={u.id}>
                        <td data-label="Date" className="text-xs whitespace-nowrap">
                          {u.created_at ? <><div>{new Date(u.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div><div className="relative-time">{getRelativeTime(u.created_at)}</div></> : '—'}
                        </td>
                        <td data-label="Name">
                          <div className="font-semibold">{u.name}</div>
                          <div className="text-xs" style={{ color: 'var(--muted)' }}>{u.email}</div>
                        </td>
                        <td data-label="Phone">{u.phone || '—'}</td>
                        <td data-label="Status">
                          <span className={`badge ${displayBadge}`}>
                            {displayStatus ? displayStatus.charAt(0).toUpperCase() + displayStatus.slice(1) : 'Pending'}
                          </span>
                        </td>
                        <td data-label="Actions">
                          <div className="flex-actions">
                            <button className="btn-modern btn-modern-primary btn-modern-xs" onClick={() => openDetails(u)}>Details</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredUsers.length === 0 && (
                    <tr><td colSpan={5} className="muted text-center" style={{ padding: '2rem' }}>No payments found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {selectedUser && (
            <PaymentDetailModal
              key={selectedUser.id}
              user={selectedUser}
              onClose={() => setSelectedUser(null)}
            />
          )}

          {deleteSuccessMsg && (
            <div style={{ position: 'fixed', top: '1rem', right: '1rem', zIndex: 9999, padding: '1rem 1.5rem', borderRadius: '8px', background: 'var(--success)', color: '#fff', fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
              {'\u2713'} {deleteSuccessMsg}
            </div>
          )}

          {deleteConfirmUser && (
            <div className="modal-modern-overlay" onClick={() => setDeleteConfirmUser(null)}>
              <div className="modal-modern" onClick={e => e.stopPropagation()}>
                <div className="modal-modern-header">
                  <h2>Confirm Permanent Deletion</h2>
                  <button onClick={() => setDeleteConfirmUser(null)} className="btn-modern btn-modern-ghost btn-modern-sm">{'\u2715'}</button>
                </div>
                <div className="modal-modern-body">
                  <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
                    <strong>{'\u26A0\uFE0F'} Warning:</strong> This will permanently delete <strong>{deleteConfirmUser.name}</strong> and ALL associated data including topups, transactions, payments, screenshots, messages, chat history, and notifications. This action CANNOT be undone!
                  </div>
                  <div className="detail-grid card-section-sm">
                    <div className="detail-row">
                      <span className="detail-label">User</span>
                      <span className="detail-value">{deleteConfirmUser.name}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Email</span>
                      <span className="detail-value">{deleteConfirmUser.email}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Phone</span>
                      <span className="detail-value">{deleteConfirmUser.phone || '—'}</span>
                    </div>
                  </div>
                </div>
                <div className="modal-modern-footer">
                  <button className={`btn-modern btn-modern-danger${deletingUser ? ' btn-loading' : ''}`}
                    onClick={async () => {
                      if (deletingUser) return;
                      const u = deleteConfirmUser;
                      setDeletingUser(true);
                      try {
                        await handleDeleteUser(u.id, u.email, u.phone);
                      } catch (e) { console.error('Delete user error:', e); } finally {
                        setDeletingUser(false);
                      }
                    }} disabled={deletingUser}>
                    {deletingUser ? 'Deleting...' : '\u2715 Confirm Delete'}
                  </button>
                  <button className="btn-modern btn-modern-ghost" onClick={() => setDeleteConfirmUser(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
