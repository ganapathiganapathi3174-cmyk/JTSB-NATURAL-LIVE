import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FirebaseUser, FirebaseNotification, FirebaseChat } from '../db/firebase-db.js';
import { getDb } from '../firebase/config.js';
import { doc, deleteDoc, getDoc, updateDoc } from 'firebase/firestore';
import AdminSidebar from '../components/AdminSidebar.jsx';

const ADMIN_KEY = 'fb_admin_token';

const getImageUrl = (url) => {
  if (!url) return null;
  if (url.includes('alt=media')) return url;
  if (url.startsWith('data:')) return url;
  return url + (url.includes('?') ? '&' : '?') + 'alt=media';
};

function UserDetailModal({ user, onClose, onDelete, onDeleteReferral, onActivate }) {
  const [deleting, setDeleting] = useState(false);
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState('');
  const [approving, setApproving] = useState(false);
  const [showActivateConfirm, setShowActivateConfirm] = useState(false);
  const [activateReason, setActivateReason] = useState('');
  const [activating, setActivating] = useState(false);
  const [activateMsg, setActivateMsg] = useState('');
  const [adminApproving, setAdminApproving] = useState(false);
  const [adminMessage, setAdminMessage] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const currentAdminStatus = user.admin_approval_status || 'APPROVED';

  async function handleAdminApproval(status) {
    if (!adminMessage || !adminMessage.trim()) {
      setAdminApproving(false);
      return;
    }
    setAdminApproving(true);
    try {
      const adminName = getAdminName();
      await FirebaseUser.updateAdminApproval(user.id, status, adminName);
      await FirebaseNotification.send({
        receiverId: user.id,
        receiverName: user.name || '',
        message: adminMessage,
        type: status === 'APPROVED' ? 'admin_approval_approved' : 'admin_approval_rejected',
        senderId: adminName,
        senderName: adminName,
      });
      setAdminMessage('');
      if (status === 'APPROVED' && onActivate) onActivate(user.id);
      console.log(`[ADMIN APPROVAL] User ${user.id} ${status} by ${adminName}`);
    } catch (err) {
      console.error('Admin approval error:', err);
    }
    setAdminApproving(false);
  }

  useEffect(() => {
    if (user?.id) {
      setLoading(true);
      FirebaseUser.getAllReferralsByReferrerCode(user.referral_code).then(setReferrals).finally(() => setLoading(false));
    }
  }, [user?.id, user?.referral_code]);

  async function handleResetPassword() {
    if (!window.confirm(`Reset password for "${user.email}"? A new password will be generated.`)) return;
    setResetting(true);
    setResetMsg('');
    try {
      const newPwd = Math.random().toString(36).slice(-8) + Math.floor(Math.random() * 100);
      await FirebaseUser.updatePassword(user.id, newPwd);
      setResetMsg(`Password reset successfully! New password: ${newPwd}`);
    } catch (err) {
      console.error('Reset error:', err);
      setResetMsg('Error: ' + (err.message || 'Failed to reset password'));
    } finally {
      setResetting(false);
    }
  }

  async function handleDeleteReferral(referredUser) {
    if (!window.confirm(`Remove referral "${referredUser.name}" from this user?`)) return;
    try {
      await onDeleteReferral(user.referral_code, referredUser.id);
      const updated = await FirebaseUser.getReferralsByReferrerCode(user.referral_code);
      setReferrals(updated);
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleDeleteAllReferrals() {
    if (!window.confirm(`Remove ALL referrals from this user? This cannot be undone.`)) return;
    try {
      for (const ref of referrals) {
        await onDeleteReferral(user.referral_code, ref.id);
      }
      setReferrals([]);
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleApproveReferral(referredUserId) {
    setApproving(true);
    try {
      await FirebaseUser.approveReferral(referredUserId);
      const updated = await FirebaseUser.getAllReferralsByReferrerCode(user.referral_code);
      setReferrals(updated);
    } catch (err) {
      alert(err.message);
    } finally {
      setApproving(false);
    }
  }

  function getAdminName() {
    try {
      return sessionStorage.getItem('fb_admin_name') || localStorage.getItem('fb_admin_name') || 'Admin';
    } catch {
      return 'Admin';
    }
  }

  async function handleActivateUser() {
    setActivating(true);
    setActivateMsg('');
    try {
      const adminName = getAdminName();
      if (!adminMessage || !adminMessage.trim()) {
        setActivating(false);
        return;
      }
      await FirebaseUser.activateUser(user.id, adminName, activateReason);
      await FirebaseNotification.send({
        receiverId: user.id,
        receiverName: user.name || '',
        message: adminMessage,
        type: 'user_activated',
        senderId: adminName,
        senderName: adminName,
      });
      setAdminMessage('');
      setActivateMsg('✓ User activated successfully!');
      setShowActivateConfirm(false);
      setActivateReason('');
      if (onActivate) onActivate(user.id);
    } catch (err) {
      setActivateMsg('Error: ' + (err.message || 'Failed to activate user'));
    } finally {
      setActivating(false);
    }
  }

  async function handleDeleteConfirmed() {
    setDeleting(true);
    try {
      await onDelete(user.id, user.email, user.phone);
      setShowDeleteConfirm(false);
      onClose();
    } catch (err) {
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  }

  async function handleDelete() {
    setShowDeleteConfirm(true);
  }

  if (!user) return null;

  return (
    <div className="modal-modern-overlay" onClick={onClose}>
      <div className="modal-modern" onClick={e => e.stopPropagation()}>
        <div className="modal-modern-header">
          <h2>User Details</h2>
          <button onClick={onClose} className="btn-modern btn-modern-ghost btn-modern-sm">{'\u2715'}</button>
        </div>
        <div className="modal-modern-body">
          <div className="detail-grid mb-md">
            <div className="detail-row">
              <span className="detail-label">Name</span>
              <span className="detail-value">{user.name}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Email</span>
              <span className="detail-value">{user.email}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Phone</span>
              <span className="detail-value">{user.phone || '—'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">UTR Number</span>
              <span className="detail-value mono">{user.utr_number || '—'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Payment Status</span>
              <span className={`badge ${user.payment_status === 'approved' ? 'badge-paid' : user.payment_status === 'rejected' ? 'badge-rejected' : 'badge-pending'}`}>
                {user.payment_status ? user.payment_status.charAt(0).toUpperCase() + user.payment_status.slice(1) : 'Pending'}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Account Status</span>
              <span className={`status-badge status-${user.account_status || 'inactive'}`}>
                {(user.account_status || 'inactive').charAt(0).toUpperCase() + (user.account_status || 'inactive').slice(1)}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Joined Date</span>
              <span className="detail-value text-xs">
                {user.joinedDate ? new Date(user.joinedDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Approved Date</span>
              <span className="detail-value text-xs">
                {user.approvedDate ? new Date(user.approvedDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Admin Approval</span>
              <span className={`badge ${currentAdminStatus === 'APPROVED' ? 'badge-paid' : currentAdminStatus === 'REJECTED' ? 'badge-rejected' : 'badge-pending'}`}>
                {currentAdminStatus}
              </span>
              {currentAdminStatus === 'PENDING' && (
                <div style={{ marginTop: '0.3rem' }}>
                  <textarea className="input w-full" placeholder="Message to user (required)"
                    value={adminMessage} onChange={e => setAdminMessage(e.target.value)}
                    rows={1} style={{ resize: 'vertical', fontSize: '0.78rem', marginBottom: '0.3rem' }} />
                  <div className="flex-actions">
                    <button className={`btn-modern btn-modern-success btn-modern-xs${adminApproving ? ' btn-loading' : ''}`}
                      onClick={() => handleAdminApproval('APPROVED')} disabled={adminApproving}>
                      Approve
                    </button>
                    <button className={`btn-modern btn-modern-danger btn-modern-xs${adminApproving ? ' btn-loading' : ''}`}
                      onClick={() => handleAdminApproval('REJECTED')} disabled={adminApproving}>
                      Reject
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="detail-row">
              <span className="detail-label">Referral Code</span>
              <div>
                <code style={{ fontSize: '0.95rem' }}>{user.referral_code}</code>
                <button className="btn-modern btn-modern-ghost btn-modern-xs ml-sm"
                  onClick={() => navigator.clipboard.writeText(user.referral_code)}>
                  Copy
                </button>
              </div>
            </div>
            {user.referred_by && (
              <div className="detail-row">
                <span className="detail-label">Referred By</span>
                <span className="detail-value">{user.referred_by}</span>
              </div>
            )}
            <div className="detail-row">
              <span className="detail-label">Created At</span>
              <span className="detail-value">{user.created_at ? new Date(user.created_at).toLocaleString() : '—'}</span>
            </div>
          </div>

          {loading ? (
            <div className="muted mb-md">Loading referrals...</div>
          ) : referrals.length > 0 ? (
            <div className="mb-md">
              <h4 className="section-label">
                Referrals ({referrals.length})
              </h4>
              <div className="flex-col gap-sm">
                {referrals.map((ref) => (
                  <div key={ref.id} className="referral-card-row">
                    <div>
                      <div className="font-semibold" style={{ fontSize: '0.9rem' }}>{ref.name}</div>
                      <div className="text-xs text-muted">{ref.email}</div>
                      <div className="text-xs" style={{ marginTop: '0.15rem' }}>
                        {ref.referred_by_status === 'approved' ? (
                          <span className="badge badge-paid badge-xs">Approved</span>
                        ) : ref.referred_by_status === 'pending' || !ref.referred_by_status ? (
                          <span className="badge badge-pending badge-xs">Pending</span>
                        ) : (
                          <span className="badge badge-rejected badge-xs">{ref.referred_by_status}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex-actions">
                      {(ref.referred_by_status === 'pending' || !ref.referred_by_status) && (
                        <button className={`btn-modern btn-modern-primary btn-modern-xs${approving ? ' btn-loading' : ''}`}
                          onClick={() => handleApproveReferral(ref.id)}
                          disabled={approving}>
                          {approving ? '...' : 'Approve'}
                        </button>
                      )}
                      <button className="btn-modern btn-modern-danger btn-modern-xs"
                        onClick={() => handleDeleteReferral(ref)}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
                {referrals.length > 0 && (
                  <button className="btn-modern btn-modern-danger btn-modern-sm"
                    style={{ marginTop: '0.25rem' }}
                    onClick={handleDeleteAllReferrals}>
                    Remove All Referrals
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="muted mb-md">No referrals yet</div>
          )}

          <div className="mb-md">
            <div className="detail-row">
              <span className="detail-label">Payment Screenshot</span>
              {user.upi_screenshot_url ? (
                <div>
                  <button className="btn-modern btn-modern-primary btn-modern-sm mb-sm"
                    onClick={() => window.open(getImageUrl(user.upi_screenshot_url), '_blank', 'noopener,noreferrer')}>
                    Open Image
                  </button>
                  <img src={getImageUrl(user.upi_screenshot_url)} alt="Payment"
                    style={{ maxWidth: '100%', borderRadius: '8px', border: '1px solid var(--border)' }} />
                </div>
              ) : (
                <span className="muted">No screenshot uploaded</span>
              )}
            </div>
          </div>

          {user.activated_at && (
            <div className="verify-section mb-md">
              <h4>Activation Info</h4>
              <div className="text-sm">
                <div><strong>Activated by:</strong> {user.activated_by || '—'}</div>
                <div><strong>Activated at:</strong> {user.activated_at ? new Date(user.activated_at).toLocaleString() : '—'}</div>
                {user.activation_reason && <div><strong>Reason:</strong> {user.activation_reason}</div>}
              </div>
            </div>
          )}

          <div className="flex-row-wrap">
            {(user.account_status === 'inactive' || user.account_status === 'pending') && !showActivateConfirm && (
              <button className="btn-modern btn-modern-warning" onClick={() => setShowActivateConfirm(true)}>
                Activate User
              </button>
            )}
            <button className={`btn-modern btn-modern-primary${resetting ? ' btn-loading' : ''}`}
              onClick={handleResetPassword} disabled={resetting}>
              {resetting ? 'Resetting...' : 'Reset Password'}
            </button>
            <button className={`btn-modern btn-modern-danger${deleting ? ' btn-loading' : ''}`}
              onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete User'}
            </button>
          </div>

          {showActivateConfirm && (
            <div className="activation-card">
              <h4 className="text-warning" style={{ margin: '0 0 0.5rem' }}>Activate User</h4>
              <p className="muted text-sm mb-sm">
                Are you sure you want to activate this user?
              </p>
              <textarea className="input w-full mb-sm" placeholder="Reason for activation (optional)"
                value={activateReason} onChange={e => setActivateReason(e.target.value)}
                rows={2} style={{ resize: 'vertical' }} />
              <textarea className="input w-full mb-sm" placeholder="Message to user (required)"
                value={adminMessage} onChange={e => setAdminMessage(e.target.value)}
                rows={2} style={{ resize: 'vertical' }} />
              <div className="flex-row">
                <button className="btn-modern btn-modern-warning" onClick={handleActivateUser} disabled={activating}>
                  {activating ? '\u23F3' : '\u2713'} Confirm Activation
                </button>
                <button className="btn-modern btn-modern-ghost" onClick={() => { setShowActivateConfirm(false); setActivateReason(''); setAdminMessage(''); }} disabled={activating}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {activateMsg && (
            <div className={`alert ${activateMsg.includes('\u2713') ? 'alert-success' : 'alert-error'}`} style={{ marginTop: '0.75rem' }}>
              {activateMsg}
            </div>
          )}

          {resetMsg && (
            <div className="alert alert-success" style={{ marginTop: '0.75rem', wordBreak: 'break-all' }}>
              {resetMsg}
            </div>
          )}

          {showDeleteConfirm && (
            <div className="modal-modern-overlay" onClick={() => setShowDeleteConfirm(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10000 }}>
              <div className="modal-modern" onClick={e => e.stopPropagation()}>
                <div className="modal-modern-header">
                  <h2>Confirm Permanent Deletion</h2>
                  <button onClick={() => setShowDeleteConfirm(false)} className="btn-modern btn-modern-ghost btn-modern-sm">{'\u2715'}</button>
                </div>
                <div className="modal-modern-body">
                  <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
                    <strong>{'\u26A0\uFE0F'} Warning:</strong> This will permanently delete <strong>{user.name}</strong> and ALL associated data including topups, transactions, payments, screenshots, messages, chat history, and notifications. This action CANNOT be undone!
                  </div>
                  <div className="detail-grid card-section-sm">
                    <div className="detail-row">
                      <span className="detail-label">User</span>
                      <span className="detail-value">{user.name}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Email</span>
                      <span className="detail-value">{user.email}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Phone</span>
                      <span className="detail-value">{user.phone || '—'}</span>
                    </div>
                  </div>
                </div>
                <div className="modal-modern-footer">
                  <button className={`btn-modern btn-modern-danger${deleting ? ' btn-loading' : ''}`}
                    onClick={handleDeleteConfirmed} disabled={deleting}>
                    {deleting ? 'Deleting...' : '\u2715 Confirm Delete'}
                  </button>
                  <button className="btn-modern btn-modern-ghost" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function FirebaseAdminUsersPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dragState, setDragState] = useState({ startX: 0, isDragging: false });
  const [expandedUserId, setExpandedUserId] = useState(null);
  const [expandedReferrals, setExpandedReferrals] = useState([]);
  const [loadingReferrals, setLoadingReferrals] = useState(false);
  const [deleteConfirmUser, setDeleteConfirmUser] = useState(null);
  const [deleteSuccessMsg, setDeleteSuccessMsg] = useState('');
  const [deletingUser, setDeletingUser] = useState(false);

  const handleDragStart = (e, user) => {
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    setDragState({ startX: clientX, isDragging: true, userId: user.id });
  };

  const handleDragMove = (e) => {
    if (!dragState.isDragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const diff = Math.abs(clientX - dragState.startX);
    if (diff > 50) {
      handleToggleUserExpand(dragState.userId);
      setDragState({ startX: 0, isDragging: false, userId: null });
    }
  };

  const handleDragEnd = () => {
    setDragState({ startX: 0, isDragging: false, userId: null });
  };

  const handleToggleUserExpand = async (userId) => {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
      setExpandedReferrals([]);
      return;
    }
    const user = users.find(u => u.id === userId);
    if (!user) return;
    setExpandedUserId(userId);
    setLoadingReferrals(true);
    try {
      const referrals = await FirebaseUser.getAllReferralsByReferrerCode(user.referral_code);
      setExpandedReferrals(referrals);
    } catch (err) {
      console.error('Load referrals error:', err);
    } finally {
      setLoadingReferrals(false);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem(ADMIN_KEY);
    if (!token) {
      navigate('/fb-admin', { replace: true });
      return;
    }

    const unsubscribe = FirebaseUser.subscribeToUsers((allUsers) => {
      setUsers(allUsers);
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [navigate]);

  useEffect(() => {
    const status = searchParams.get('status');
    if (status) setStatusFilter(status);
  }, [searchParams]);

  const handleDelete = async (userId, userEmail, userPhone) => {
    try {
      await FirebaseUser.deleteUser(userId, { email: userEmail, phone: userPhone });
      setUsers(prev => prev.filter(u => u.id !== userId));
      setDeleteSuccessMsg('User permanently deleted');
      setTimeout(() => setDeleteSuccessMsg(''), 3000);
    } catch (err) {
      console.error('[DELETE ERROR]', err);
      setDeleteSuccessMsg('');
      const detail = err.response?.data?.message || err.message || 'Unknown error';
      alert('Delete failed: ' + detail + '\n\nCheck browser console (F12) for detailed error logs.');
      throw err;
    }
  };

  const handleDeleteReferral = async (referralCode, referredUserId) => {
    const db = getDb();
    try {
      const userRef = doc(db, 'users_new', referredUserId);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const data = snap.data();
        const referrer = await FirebaseUser.findByReferralCode(referralCode);
        if (referrer) {
          const newCount = Math.max(0, (referrer.referrals_count || 0) - 1);
          await updateDoc(doc(db, 'users_new', referrer.id), {
            referrals_count: newCount,
            referral_limit_reached: newCount >= 2,
          });
        }
        await updateDoc(userRef, { referred_by: null, referred_by_status: null, referral_limit_reached: false });
      }
    } catch (err) {
      console.error('Delete referral error:', err);
      throw err;
    }
  };

  const referralCounts = useMemo(() => {
    const codeToId = {};
    users.forEach(u => {
      if (u.referral_code) {
        codeToId[u.referral_code] = u.id;
      }
    });
    const counts = {};
    users.forEach(u => {
      if (u.referred_by && (u.referred_by_status === 'approved' || !u.referred_by_status)) {
        const refId = codeToId[u.referred_by];
        if (refId) {
          counts[refId] = (counts[refId] || 0) + 1;
        }
      }
    });
    return counts;
  }, [users]);

  const filteredUsers = useMemo(() => {
    let filtered = users;
    
    if (statusFilter) {
      if (statusFilter === 'account_active') {
        filtered = filtered.filter(u => u.account_status === 'active');
      } else if (statusFilter === 'account_inactive') {
        filtered = filtered.filter(u => u.account_status === 'inactive');
      } else if (statusFilter === 'admin_pending') {
        filtered = filtered.filter(u => u.admin_approval_status === 'PENDING');
      } else if (statusFilter === 'admin_approved') {
        filtered = filtered.filter(u => u.admin_approval_status === 'APPROVED');
      } else if (statusFilter === 'admin_rejected') {
        filtered = filtered.filter(u => u.admin_approval_status === 'REJECTED');
      } else {
        filtered = filtered.filter(u => u.payment_status === statusFilter);
      }
    }
    
    if (q) {
      const ql = q.toLowerCase();
      filtered = filtered.filter(u => 
        (u.name && u.name.toLowerCase().includes(ql)) ||
        (u.email && u.email.toLowerCase().includes(ql)) ||
        (u.referral_code && u.referral_code.toLowerCase().includes(ql)) ||
        (u.utr_number && u.utr_number.includes(q))
      );
    }
    
    return filtered;
  }, [users, statusFilter, q]);

  const updateStatusFilter = (status) => {
    const next = new URLSearchParams(searchParams);
    if (status) next.set('status', status);
    else next.delete('status');
    setSearchParams(next, { replace: true });
    setStatusFilter(status);
  };

  const pendingCounts = useMemo(() => ({
    pendingPayments: users.filter(u => u.payment_status === 'pending' || u.cycle_payment_status === 'pending').length,
    pendingTopups: 0,
  }), [users]);

  const pendingApprovalCount = useMemo(() =>
    users.filter(u => u.admin_approval_status === 'PENDING').length,
  [users]);

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
              <span className="admin-page-title-icon">{'\u{1F465}'}</span>
              User Management
            </h1>
            <div className="admin-page-actions">
              <span className="muted text-sm">
                {users.length} total &middot; {users.filter(u => u.payment_status === 'approved').length} approved &middot; {users.filter(u => u.account_status === 'active').length} active &middot; {pendingApprovalCount} pending approval
              </span>
            </div>
          </div>

          <div className="card-modern mb-md">
            <div className="card-modern-header">
              <h2 className="card-modern-title">{'\u{1F50D}'} Search & Filter</h2>
            </div>
            <div className="search-bar-modern">
              <input value={q} onChange={e => setQ(e.target.value)}
                placeholder="Search by name, email, referral_code, or UTR..." />
              <select value={statusFilter} onChange={e => updateStatusFilter(e.target.value)}>
                <option value="">All Users</option>
                <option value="pending">Payment: Pending</option>
                <option value="approved">Payment: Approved</option>
                <option value="rejected">Payment: Rejected</option>
                <option disabled>{'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'}</option>
                <option value="account_active">Account: Active</option>
                <option value="account_inactive">Account: Inactive</option>
                <option disabled>{'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'}</option>
                <option value="admin_pending">Admin: Pending Approval</option>
                <option value="admin_approved">Admin: Approved</option>
                <option value="admin_rejected">Admin: Rejected</option>
              </select>
            </div>
          </div>

          <div className="card-modern">
            <div className="card-modern-header">
              <h2 className="card-modern-title">{'\u{1F465}'} All Users ({filteredUsers.length})</h2>
            </div>
            
            <div className="table-wrap-modern">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Payment</th>
                    <th>Account</th>
                    <th>Admin</th>
                    <th>Topup</th>
                    <th>Referrals</th>
                    <th>Joined</th>
                    <th>Approved</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody onMouseMove={handleDragMove} onMouseUp={handleDragEnd} onTouchEnd={handleDragEnd}>
                  {filteredUsers.map((u) => {
                    const adminStatus = u.admin_approval_status || 'APPROVED';
                    return (
                    <React.Fragment key={u.id}>
                      <tr className="draggable-row"
                        onMouseDown={(e) => handleDragStart(e, u)}
                        onTouchStart={(e) => handleDragStart(e, u)}
                      >
                        <td data-label="Name">
                          <div className="font-semibold">{u.name}</div>
                          <div className="text-xs text-muted">{u.email}</div>
                          <div className="font-mono text-xs text-accent">{u.referral_code || '—'}</div>
                        </td>
                        <td data-label="Phone">{u.phone || '—'}</td>
                        <td data-label="Payment">
                          <span className={`badge ${u.payment_status === 'approved' ? 'badge-paid' : u.payment_status === 'rejected' ? 'badge-rejected' : 'badge-pending'}`}>
                            {u.payment_status ? u.payment_status.charAt(0).toUpperCase() + u.payment_status.slice(1) : 'Pending'}
                          </span>
                        </td>
                        <td data-label="Account">
                          <span className={`status-badge status-${u.account_status || 'inactive'}`}>
                            {(u.account_status || 'inactive').charAt(0).toUpperCase() + (u.account_status || 'inactive').slice(1)}
                          </span>
                        </td>
                        <td data-label="Admin">
                          <span className={`badge ${adminStatus === 'APPROVED' ? 'badge-paid' : adminStatus === 'REJECTED' ? 'badge-rejected' : 'badge-pending'} badge-xs`}>
                            {adminStatus}
                          </span>
                        </td>
                        <td data-label="Topup">
                          {u.sponsor_topup_completed ? (
                            <span className="badge badge-paid badge-xs">Done</span>
                          ) : u.topup_referral_qualified ? (
                            <span className="badge badge-pending badge-xs">Qualified</span>
                          ) : (
                            <span className="muted badge-xs">—</span>
                          )}
                        </td>
                        <td data-label="Referrals">
                          <div>
                            <div className="font-semibold" style={{ fontSize: '0.9rem' }}>{u.total_referral_count || 0}</div>
                            <button className="btn-modern btn-modern-ghost btn-modern-xs"
                              onClick={(e) => { e.stopPropagation(); handleToggleUserExpand(u.id); }}>
                              {expandedUserId === u.id ? 'Hide' : `View${u.payment_status === 'approved' ? ` (${referralCounts[u.id] || 0})` : ''}`}
                            </button>
                          </div>
                        </td>
                        <td data-label="Joined" className="text-xs text-muted" style={{ whiteSpace: 'nowrap' }}>
                          {u.joinedDate ? new Date(u.joinedDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                        </td>
                        <td data-label="Approved" className="text-xs text-muted" style={{ whiteSpace: 'nowrap' }}>
                          {u.approvedDate ? new Date(u.approvedDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                        </td>
                        <td data-label="Actions">
                          <div className="flex-actions" onClick={(e) => e.stopPropagation()}>
                            <button className="btn-modern btn-modern-primary btn-modern-xs" onClick={() => setSelectedUser(u)}>View</button>
                            <button className="btn-modern btn-modern-danger btn-modern-xs" onClick={() => setDeleteConfirmUser(u)}>Del</button>
                          </div>
                        </td>
                      </tr>
                      {expandedUserId === u.id && (
                        <tr>
                          <td colSpan={10} className="expandable-row">
                            {loadingReferrals ? (
                              <div className="muted">Loading referrals...</div>
                            ) : expandedReferrals.length > 0 ? (
                              <>
                                <div className="font-semibold mb-sm text-sm text-muted">
                                  Referred by {u.name}:
                                </div>
                                <div className="flex-col gap-sm">
                                  {expandedReferrals.map((ref) => (
                                    <div key={ref.id} className="referral-card-row">
                                      <div>
                                        <div className="font-semibold text-sm">{ref.name}</div>
                                        <div className="text-xs text-muted">{ref.phone || '—'}</div>
                                        <div className="badge-xs" style={{ marginTop: '0.15rem' }}>
                                          {ref.referred_by_status === 'approved' ? (
                                            <span className="badge badge-paid badge-xs">Approved</span>
                                          ) : ref.referred_by_status === 'pending' || !ref.referred_by_status ? (
                                            <span className="badge badge-pending badge-xs">Pending</span>
                                          ) : (
                                            <span className="badge badge-rejected badge-xs">{ref.referred_by_status}</span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </>
                            ) : (
                              <div className="muted text-sm">No referrals yet.</div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                    );
                  })}
                  {filteredUsers.length === 0 && (
                    <tr><td colSpan={10}><div className="empty-state-modern"><span className="empty-icon">{'\u{1F465}'}</span><span className="empty-text">No users found.</span></div></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

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
                        await handleDelete(u.id, u.email, u.phone);
                        setDeleteConfirmUser(null);
                      } catch (e) {} finally {
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

          {selectedUser && (
            <UserDetailModal
              user={selectedUser}
              onClose={() => { setSelectedUser(null); }}
              onDelete={handleDelete}
              onDeleteReferral={handleDeleteReferral}
              onActivate={(userId) => {
                setUsers(prev => prev.map(u => u.id === userId ? { ...u, account_status: 'active', admin_approval_status: 'APPROVED' } : u));
              }}
            />
          )}
        </div>
      </main>
    </div>
  );
}
