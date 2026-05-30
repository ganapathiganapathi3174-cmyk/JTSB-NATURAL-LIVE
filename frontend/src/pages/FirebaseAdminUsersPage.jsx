import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FirebaseUser } from '../db/firebase-db.js';
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

  const currentAdminStatus = user.admin_approval_status || 'APPROVED';

  async function handleAdminApproval(status) {
    setAdminApproving(true);
    try {
      const adminName = getAdminName();
      await FirebaseUser.updateAdminApproval(user.id, status, adminName);
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
      await FirebaseUser.activateUser(user.id, adminName, activateReason);
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

  async function handleDelete() {
    if (!window.confirm(`Delete user "${user.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await onDelete(user.id);
      onClose();
    } catch (err) {
      alert(err.message);
    } finally {
      setDeleting(false);
    }
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
          <div className="detail-grid" style={{ marginBottom: '1rem' }}>
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
              <span className="detail-label">Admin Approval</span>
              <span className={`badge ${currentAdminStatus === 'APPROVED' ? 'badge-paid' : currentAdminStatus === 'REJECTED' ? 'badge-rejected' : 'badge-pending'}`}>
                {currentAdminStatus}
              </span>
              {currentAdminStatus === 'PENDING' && (
                <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.3rem' }}>
                  <button className={`btn-modern btn-modern-success btn-modern-xs${adminApproving ? ' btn-loading' : ''}`}
                    onClick={() => handleAdminApproval('APPROVED')} disabled={adminApproving}>
                    Approve
                  </button>
                  <button className={`btn-modern btn-modern-danger btn-modern-xs${adminApproving ? ' btn-loading' : ''}`}
                    onClick={() => handleAdminApproval('REJECTED')} disabled={adminApproving}>
                    Reject
                  </button>
                </div>
              )}
            </div>
            <div className="detail-row">
              <span className="detail-label">Referral Code</span>
              <div>
                <code style={{ fontSize: '0.95rem' }}>{user.referral_code}</code>
                <button className="btn-modern btn-modern-ghost btn-modern-xs"
                  style={{ marginLeft: '0.5rem' }}
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
            <div className="muted" style={{ marginBottom: '1rem' }}>Loading referrals...</div>
          ) : referrals.length > 0 ? (
            <div style={{ marginBottom: '1rem' }}>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Referrals ({referrals.length})
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {referrals.map((ref) => (
                  <div key={ref.id} style={{ padding: '0.6rem 0.75rem', background: 'var(--surface-2)', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{ref.name}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{ref.email}</div>
                      <div style={{ fontSize: '0.75rem', marginTop: '0.15rem' }}>
                        {ref.referred_by_status === 'approved' ? (
                          <span className="badge badge-paid" style={{ fontSize: '0.65rem' }}>Approved</span>
                        ) : ref.referred_by_status === 'pending' || !ref.referred_by_status ? (
                          <span className="badge badge-pending" style={{ fontSize: '0.65rem' }}>Pending</span>
                        ) : (
                          <span className="badge badge-rejected" style={{ fontSize: '0.65rem' }}>{ref.referred_by_status}</span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
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
            <div className="muted" style={{ marginBottom: '1rem' }}>No referrals yet</div>
          )}

          <div style={{ marginBottom: '1rem' }}>
            <div className="detail-row">
              <span className="detail-label">Payment Screenshot</span>
              {user.upi_screenshot_url ? (
                <div>
                  <button className="btn-modern btn-modern-primary btn-modern-sm" style={{ marginBottom: '0.5rem' }}
                    onClick={() => window.open(getImageUrl(user.upi_screenshot_url), '_blank')}>
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
            <div className="verify-section" style={{ marginBottom: '1rem' }}>
              <h4>Activation Info</h4>
              <div style={{ fontSize: '0.85rem' }}>
                <div><strong>Activated by:</strong> {user.activated_by || '—'}</div>
                <div><strong>Activated at:</strong> {user.activated_at ? new Date(user.activated_at).toLocaleString() : '—'}</div>
                {user.activation_reason && <div><strong>Reason:</strong> {user.activation_reason}</div>}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {(user.account_status === 'inactive' || user.account_status === 'pending') && !showActivateConfirm && (
              <button className="btn-modern btn-modern-warning" onClick={() => setShowActivateConfirm(true)}>
                Activate User
              </button>
            )}
            <button className={`btn-modern btn-modern-primary${resetting ? ' btn-loading' : ''}`}
              onClick={handleResetPassword} disabled={resetting}>
              {resetting ? 'Resetting...' : 'Reset Password'}
            </button>
          </div>

          {showActivateConfirm && (
            <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(245, 165, 36, 0.08)', borderRadius: 'var(--radius)', border: '1px solid rgba(245, 165, 36, 0.2)' }}>
              <h4 style={{ color: 'var(--warning)', margin: '0 0 0.5rem' }}>Activate User</h4>
              <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                Are you sure you want to activate this user?
              </p>
              <textarea className="input" placeholder="Reason for activation (optional)"
                value={activateReason} onChange={e => setActivateReason(e.target.value)}
                rows={2} style={{ width: '100%', marginBottom: '0.5rem', resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn-modern btn-modern-warning" onClick={handleActivateUser} disabled={activating}>
                  {activating ? '\u23F3' : '\u2713'} Confirm Activation
                </button>
                <button className="btn-modern btn-modern-ghost" onClick={() => { setShowActivateConfirm(false); setActivateReason(''); }} disabled={activating}>
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

  const handleDelete = async (userId) => {
    try {
      const db = getDb();
      await deleteDoc(doc(db, 'users_new', userId));
      setUsers(prev => prev.filter(u => u.id !== userId));
    } catch (err) {
      console.error('Delete error:', err);
      alert('Delete failed: ' + (err.message || 'Unknown error'));
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
              <span className="muted" style={{ fontSize: '0.85rem' }}>
                {users.length} total &middot; {users.filter(u => u.payment_status === 'approved').length} approved &middot; {users.filter(u => u.account_status === 'active').length} active &middot; {pendingApprovalCount} pending approval
              </span>
            </div>
          </div>

          <div className="card-modern" style={{ marginBottom: '1rem' }}>
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
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody onMouseMove={handleDragMove} onMouseUp={handleDragEnd} onTouchEnd={handleDragEnd}>
                  {filteredUsers.map((u) => {
                    const adminStatus = u.admin_approval_status || 'APPROVED';
                    return (
                    <React.Fragment key={u.id}>
                      <tr
                        onMouseDown={(e) => handleDragStart(e, u)}
                        onTouchStart={(e) => handleDragStart(e, u)}
                        style={{ cursor: 'grab', userSelect: 'none' }}
                      >
                        <td data-label="Name">
                          <div style={{ fontWeight: 600 }}>{u.name}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{u.email}</div>
                          <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--accent)' }}>{u.referral_code || '—'}</div>
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
                          <span className={`badge ${adminStatus === 'APPROVED' ? 'badge-paid' : adminStatus === 'REJECTED' ? 'badge-rejected' : 'badge-pending'}`}
                            style={{ fontSize: '0.7rem' }}>
                            {adminStatus}
                          </span>
                        </td>
                        <td data-label="Topup">
                          {u.sponsor_topup_completed ? (
                            <span className="badge badge-paid" style={{ fontSize: '0.7rem' }}>Done</span>
                          ) : u.topup_referral_qualified ? (
                            <span className="badge badge-pending" style={{ fontSize: '0.7rem' }}>Qualified</span>
                          ) : (
                            <span className="muted" style={{ fontSize: '0.7rem' }}>—</span>
                          )}
                        </td>
                        <td data-label="Referrals">
                          <div>
                            <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{u.total_referral_count || 0}</div>
                            <button className="btn-modern btn-modern-ghost btn-modern-xs"
                              onClick={(e) => { e.stopPropagation(); handleToggleUserExpand(u.id); }}>
                              {expandedUserId === u.id ? 'Hide' : `View${u.payment_status === 'approved' ? ` (${referralCounts[u.id] || 0})` : ''}`}
                            </button>
                          </div>
                        </td>
                        <td data-label="Actions">
                          <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: '0.3rem' }}>
                            <button className="btn-modern btn-modern-primary btn-modern-xs" onClick={() => setSelectedUser(u)}>View</button>
                            <button className="btn-modern btn-modern-danger btn-modern-xs" onClick={() => { if (window.confirm(`Delete "${u.name}"?`)) { handleDelete(u.id); } }}>Del</button>
                          </div>
                        </td>
                      </tr>
                      {expandedUserId === u.id && (
                        <tr>
                          <td colSpan={8} style={{ padding: '0.75rem', background: 'var(--bg)', borderTop: '2px solid var(--accent)' }}>
                            {loadingReferrals ? (
                              <div className="muted">Loading referrals...</div>
                            ) : expandedReferrals.length > 0 ? (
                              <>
                                <div style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--muted)' }}>
                                  Referred by {u.name}:
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                  {expandedReferrals.map((ref) => (
                                    <div key={ref.id} style={{ padding: '0.5rem 0.75rem', background: 'var(--surface-2)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <div>
                                        <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{ref.name}</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{ref.phone || '—'}</div>
                                        <div style={{ fontSize: '0.7rem', marginTop: '0.15rem' }}>
                                          {ref.referred_by_status === 'approved' ? (
                                            <span className="badge badge-paid" style={{ fontSize: '0.65rem' }}>Approved</span>
                                          ) : ref.referred_by_status === 'pending' || !ref.referred_by_status ? (
                                            <span className="badge badge-pending" style={{ fontSize: '0.65rem' }}>Pending</span>
                                          ) : (
                                            <span className="badge badge-rejected" style={{ fontSize: '0.65rem' }}>{ref.referred_by_status}</span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </>
                            ) : (
                              <div className="muted" style={{ fontSize: '0.85rem' }}>No referrals yet.</div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                    );
                  })}
                  {filteredUsers.length === 0 && (
                    <tr><td colSpan={8}><div className="empty-state-modern"><span className="empty-icon">{'\u{1F465}'}</span><span className="empty-text">No users found.</span></div></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

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
