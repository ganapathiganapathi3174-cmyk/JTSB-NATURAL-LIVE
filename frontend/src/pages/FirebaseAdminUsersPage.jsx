import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FirebaseUser, FirebaseNotification } from '../db/firebase-db.js';
import { getSupabase } from '../supabase/config.js';
import AdminSidebar from '../components/AdminSidebar.jsx';

const ADMIN_KEY = 'fb_admin_token';
const API_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';

function authHeaders() {
  const t = localStorage.getItem(ADMIN_KEY);
  return t ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t } : { 'Content-Type': 'application/json' };
}

function getLastActiveStatus(dateStr) {
  if (!dateStr) return 'inactive';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 5 * 60 * 1000) return 'online';
  if (diff < 24 * 60 * 60 * 1000) return 'recent';
  return 'inactive';
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(10px)'; el.style.transition = 'all 0.3s'; setTimeout(() => el.remove(), 300); }, 3000);
}

function exportToCSV(users, filename = 'users-export.csv') {
  const headers = ['Name', 'Email', 'Phone', 'Status', 'Account Status', 'Referral Code', 'Referred By', 'Referrals Count', 'Joined Date', 'Approved Date', 'Last Active'];
  const rows = users.map(u => [
    `"${(u.name || '').replace(/"/g, '""')}"`,
    `"${(u.email || '').replace(/"/g, '""')}"`,
    `"${(u.phone || '').replace(/"/g, '""')}"`,
    u.payment_status || 'pending',
    u.account_status || 'inactive',
    u.referral_code || '',
    u.referred_by || '',
    u.total_referral_count || 0,
    u.joinedDate ? new Date(u.joinedDate).toISOString() : '',
    u.approvedDate ? new Date(u.approvedDate).toISOString() : '',
    u.lastActiveAt ? new Date(u.lastActiveAt).toISOString() : '',
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function UserDetailModal({ user, onClose, onDelete, onDeleteReferral, onActivate }) {
  const [deleting, setDeleting] = useState(false);
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState('');
  const [showActivateConfirm, setShowActivateConfirm] = useState(false);
  const [activateReason, setActivateReason] = useState('');
  const [activating, setActivating] = useState(false);
  const [activateMsg, setActivateMsg] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [adminMessage, setAdminMessage] = useState('');

  useEffect(() => {
    if (user?.id) {
      setLoading(true);
      FirebaseUser.getAllReferralsByReferrerCode(user.referral_code).then(setReferrals).catch(() => setReferrals([])).finally(() => setLoading(false));
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
      setActivateMsg('User activated successfully!');
      setShowActivateConfirm(false);
      setActivateReason('');
      if (onActivate) onActivate(user.id);
    } catch (err) {
      setActivateMsg('Error: ' + (err.message || 'Failed to activate user'));
    } finally {
      setActivating(false);
    }
  }

  const [deleteReason, setDeleteReason] = useState('');
  const [deleteError, setDeleteError] = useState('');

  async function handleDeleteConfirmed() {
    if (!deleteReason.trim()) { setDeleteError('Please provide a reason for deletion.'); return; }
    setDeleteError('');
    setDeleting(true);
    try {
      await onDelete(user.id, deleteReason.trim(), user);
      setShowDeleteConfirm(false);
      onClose();
    } catch (err) {
      setDeleteError(err.message || 'Deletion failed');
    } finally {
      setDeleting(false);
    }
  }

  async function handleDelete() {
    setDeleteReason('');
    setDeleteError('');
    setShowDeleteConfirm(true);
  }

  if (!user) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>User Details</h2>
          <button onClick={onClose} className="modal-close">{'\u2715'}</button>
        </div>
        <div className="modal-body">
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
              <span className="detail-value">{user.phone || '\u2014'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Payment Status</span>
              <span className={`badge ${user.payment_status === 'approved' || user.payment_status === 'success' ? 'badge-success' : user.payment_status === 'rejected' ? 'badge-danger' : 'badge-pending'}`}>
                {user.payment_status ? user.payment_status.charAt(0).toUpperCase() + user.payment_status.slice(1) : 'Pending'}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Account Status</span>
              <span className={`badge ${user.account_status === 'active' ? 'badge-success' : user.account_status === 'suspended' ? 'badge-pending' : 'badge-danger'}`}>
                {(user.account_status || 'inactive').charAt(0).toUpperCase() + (user.account_status || 'inactive').slice(1)}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Joined Date</span>
              <span className="detail-value text-xs">
                {user.joinedDate ? new Date(user.joinedDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '\u2014'}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Approved Date</span>
              <span className="detail-value text-xs">
                {user.approvedDate ? new Date(user.approvedDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '\u2014'}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Referral Code</span>
              <div className="flex items-center gap-sm">
                <code style={{ fontSize: '0.95rem' }}>{user.referral_code}</code>
                <button className="btn btn-ghost btn-xs"
                  onClick={() => navigator.clipboard.writeText(user.referral_code)}>
                  Copy
                </button>
              </div>
            </div>
            {user._source === 'pending_registration' && (
              <div className="alert alert-warning text-sm" style={{ gridColumn: '1 / -1' }}>
                <strong>{'\u23F3'} Pending Registration</strong> — This user has registered but not yet completed payment. The account will be created after payment is verified.
              </div>
            )}
            {user.referred_by && (
              <div className="detail-row">
                <span className="detail-label">Referred By</span>
                <span className="detail-value">{user.referred_by}</span>
              </div>
            )}
            <div className="detail-row">
              <span className="detail-label">Created At</span>
              <span className="detail-value">{user.created_at ? new Date(user.created_at).toLocaleString() : '\u2014'}</span>
            </div>
          </div>

          {loading ? (
            <div className="text-muted mb-md">Loading referrals...</div>
          ) : referrals.length > 0 ? (
            <div className="mb-md">
              <h4 className="card-title mb-sm">
                Referrals ({referrals.length})
              </h4>
              <div className="flex flex-col gap-sm">
                {referrals.map((ref) => (
                  <div key={ref.id} className="flex flex-between items-start gap-sm" style={{ padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '8px' }}>
                    <div>
                      <div className="font-semibold text-sm">{ref.name}</div>
                      <div className="text-xs text-muted">{ref.email}</div>
                      <div className="text-xs mt-xs">
                        {ref.referred_by_status === 'approved' ? (
                          <span className="badge badge-success badge-xs">Approved</span>
                        ) : ref.referred_by_status === 'pending' || !ref.referred_by_status ? (
                          <span className="badge badge-pending badge-xs">Pending</span>
                        ) : (
                          <span className="badge badge-danger badge-xs">{ref.referred_by_status}</span>
                        )}
                      </div>
                    </div>
                    <button className="btn btn-danger btn-xs"
                      onClick={() => handleDeleteReferral(ref)}>
                      Remove
                    </button>
                  </div>
                ))}
                {referrals.length > 0 && (
                  <button className="btn btn-danger btn-sm"
                    onClick={handleDeleteAllReferrals}>
                    Remove All Referrals
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="text-muted mb-md">No referrals yet</div>
          )}

          {user.activated_at && (
            <div className="card-dim mb-md">
              <h4 className="card-title mb-sm">Activation Info</h4>
              <div className="text-sm">
                <div><strong>Activated by:</strong> {user.activated_by || '\u2014'}</div>
                <div><strong>Activated at:</strong> {user.activated_at ? new Date(user.activated_at).toLocaleString() : '\u2014'}</div>
                {user.activation_reason && <div><strong>Reason:</strong> {user.activation_reason}</div>}
              </div>
            </div>
          )}

          <div className="flex gap-sm flex-wrap">
            {(user.account_status === 'inactive' || user.account_status === 'pending') && !showActivateConfirm && (
              <button className="btn btn-warning" onClick={() => setShowActivateConfirm(true)}>
                Activate User
              </button>
            )}
            <button className={`btn btn-primary${resetting ? ' btn-loading' : ''}`}
              onClick={handleResetPassword} disabled={resetting}>
              {resetting ? 'Resetting...' : 'Reset Password'}
            </button>
            <button className={`btn btn-danger${deleting ? ' btn-loading' : ''}`}
              onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete User'}
            </button>
          </div>

          {showActivateConfirm && (
            <div className="card-dim mt-md">
              <h4 className="card-title mb-sm" style={{ color: 'var(--warning)' }}>Activate User</h4>
              <p className="text-muted text-sm mb-sm">
                Are you sure you want to activate this user?
              </p>
              <textarea className="input w-full mb-sm" placeholder="Reason for activation (optional)"
                value={activateReason} onChange={e => setActivateReason(e.target.value)}
                rows={2} />
              <textarea className="input w-full mb-sm" placeholder="Message to user (required)"
                value={adminMessage} onChange={e => setAdminMessage(e.target.value)}
                rows={2} />
              <div className="flex gap-sm">
                <button className="btn btn-warning" onClick={handleActivateUser} disabled={activating}>
                  {activating ? '\u23F3' : '\u2713'} Confirm Activation
                </button>
                <button className="btn btn-ghost" onClick={() => { setShowActivateConfirm(false); setActivateReason(''); setAdminMessage(''); }} disabled={activating}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {activateMsg && (
            <div className={`alert mt-md ${activateMsg.includes('succ') ? 'alert-success' : 'alert-error'}`}>
              {activateMsg}
            </div>
          )}

          {resetMsg && (
            <div className="alert alert-success mt-md" style={{ wordBreak: 'break-all' }}>
              {resetMsg}
            </div>
          )}

          {showDeleteConfirm && (
            <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10000 }}>
              <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <h2>Confirm Permanent Deletion</h2>
                  <button onClick={() => setShowDeleteConfirm(false)} className="modal-close">{'\u2715'}</button>
                </div>
                <div className="modal-body">
                  <div className="alert alert-error">
                    <strong>{'\u26A0\uFE0F'} Warning:</strong> Are you sure you want to permanently delete <strong>{user.name}</strong> and all associated data? This includes all topups, transactions, payments, screenshots, messages, chat history, notifications, referral records, sponsor data, and uploaded files. This action CANNOT be undone!
                  </div>
                  <textarea className="input w-full mb-sm"
                    placeholder="Reason for deletion (required)"
                    value={deleteReason}
                    onChange={e => { setDeleteReason(e.target.value); setDeleteError(''); }}
                    rows={2} />
                  {deleteError && <div className="alert alert-error">{deleteError}</div>}
                </div>
                <div className="modal-footer">
                  <button className={`btn btn-danger${deleting ? ' btn-loading' : ''}`}
                    onClick={handleDeleteConfirmed} disabled={deleting}>
                    {deleting ? 'Deleting...' : 'Delete Permanently'}
                  </button>
                  <button className="btn btn-ghost" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
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
  const [expandedUserId, setExpandedUserId] = useState(null);
  const [expandedReferrals, setExpandedReferrals] = useState([]);
  const [loadingReferrals, setLoadingReferrals] = useState(false);
  const [deleteConfirmUser, setDeleteConfirmUser] = useState(null);
  const [deleteSuccessMsg, setDeleteSuccessMsg] = useState('');
  const [deletingUser, setDeletingUser] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const deleteSuccessTimeoutRef = useRef(null);

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkDeleteText, setBulkDeleteText] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteReason, setBulkDeleteReason] = useState('');

  useEffect(() => {
    return () => {
      if (deleteSuccessTimeoutRef.current) clearTimeout(deleteSuccessTimeoutRef.current);
    };
  }, []);

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
    try {
      const body = JSON.parse(atob(token.split('.')[1]));
      const exp = body.exp;
      if (!exp || Math.floor(Date.now() / 1000) > exp) {
        localStorage.removeItem(ADMIN_KEY);
        localStorage.removeItem('fb_admin_login_at');
        navigate('/fb-admin', { replace: true });
        return;
      }
    } catch {
      localStorage.removeItem(ADMIN_KEY);
      localStorage.removeItem('fb_admin_login_at');
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

  const handleDelete = async (userId, reason, deleteUser) => {
    const adminToken = localStorage.getItem('fb_admin_token');
    if (!adminToken) throw new Error('Admin session not found. Please re-login.');
    const adminName = (() => {
      try { return sessionStorage.getItem('fb_admin_name') || localStorage.getItem('fb_admin_name') || 'Admin'; } catch { return 'Admin'; }
    })();
    const recordType = deleteUser?._source === 'pending_registration' ? 'pending_registration' : 'user';
    const res = await fetch(`${API_BASE}/adminDeleteRecord`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + adminToken },
      body: JSON.stringify({ recordId: userId, recordType, reason, adminName }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Delete failed');
    setUsers(prev => prev.filter(u => u.id !== userId));
    const recordCount = data.totalCount || 0;
    const storageCount = data.deletedStorage?.length || 0;
    setDeleteSuccessMsg(`${deleteUser?.name || 'User'} permanently deleted \u2014 ${recordCount} records removed${storageCount ? `, ${storageCount} storage files cleaned` : ''}`);
    if (deleteSuccessTimeoutRef.current) clearTimeout(deleteSuccessTimeoutRef.current);
    deleteSuccessTimeoutRef.current = setTimeout(() => setDeleteSuccessMsg(''), 5000);
  };

  const handleDeleteReferral = async (referralCode, referredUserId) => {
    try {
      const supabase = getSupabase();
      const { data: referredUser } = await supabase.from('users').select('*').eq('id', referredUserId).maybeSingle();
      if (referredUser) {
        const referrer = await FirebaseUser.findByReferralCode(referralCode);
        if (referrer) {
          const newCount = Math.max(0, (referrer.referrals_count || 0) - 1);
          await supabase.from('users').update({ referrals_count: newCount, referral_limit_reached: newCount >= 2 }).eq('id', referrer.id);
        }
        await supabase.from('users').update({ referred_by: null, referred_by_status: null, referral_limit_reached: false }).eq('id', referredUserId);
      }
    } catch (err) {
      console.error('Delete referral error:', err);
      throw err;
    }
  };

  const handleReferralAction = async (userId, action) => {
    try {
      const res = await fetch(`${API_BASE}/updateReferralStatus`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ userId, action }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Action failed');
      const data = await res.json();
      toast(data.message);
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...data } : u));
    } catch (err) {
      toast(err.message, 'error');
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
      } else if (statusFilter === 'approved') {
        filtered = filtered.filter(u => u.payment_status === 'approved' || u.payment_status === 'success');
      } else if (statusFilter === 'pending_registration') {
        filtered = filtered.filter(u => u._source === 'pending_registration');
      } else {
        filtered = filtered.filter(u => u.payment_status === statusFilter);
      }
    }
    if (q) {
      const ql = q.toLowerCase();
      filtered = filtered.filter(u =>
        (u.name && u.name.toLowerCase().includes(ql)) ||
        (u.email && u.email.toLowerCase().includes(ql)) ||
        (u.phone && u.phone.toLowerCase().includes(ql)) ||
        (u.referral_code && u.referral_code.toLowerCase().includes(ql))
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
    pendingPayments: users.filter(u => u.payment_status === 'pending').length,
    pendingTopups: 0,
  }), [users]);

  function getAdminName() {
    try {
      return sessionStorage.getItem('fb_admin_name') || localStorage.getItem('fb_admin_name') || 'Admin';
    } catch { return 'Admin'; }
  }

  const isAllSelected = useMemo(() => {
    return filteredUsers.length > 0 && filteredUsers.every(u => selectedIds.has(u.id));
  }, [filteredUsers, selectedIds]);

  const handleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredUsers.map(u => u.id)));
    }
  };

  const handleSelectOne = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleBulkDelete = async () => {
    if (bulkDeleteText !== 'DELETE') {
      toast('Please type DELETE to confirm', 'error');
      return;
    }
    if (!bulkDeleteReason.trim()) {
      toast('Please provide a reason for deletion', 'error');
      return;
    }
    const adminToken = localStorage.getItem('fb_admin_token');
    if (!adminToken) { toast('Admin session expired. Please re-login.', 'error'); return; }
    const adminName = getAdminName();
    setBulkDeleting(true);
    try {
      const userIds = Array.from(selectedIds);
      const res = await fetch(`${API_BASE}/bulkDeleteUsers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + adminToken },
        body: JSON.stringify({ userIds, reason: bulkDeleteReason.trim(), adminName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Bulk delete failed');
      if (data.summary) {
        toast(`Deleted ${data.summary.successCount}/${data.summary.total} users (${data.summary.totalDeleted} total records)`, data.summary.failCount > 0 ? 'warning' : 'success');
        if (data.summary.failCount > 0) {
          console.warn('[BULK DELETE] Failures:', data.results.filter(r => !r.success));
        }
      }
      setUsers(prev => prev.filter(u => !selectedIds.has(u.id)));
      setSelectedIds(new Set());
      setBulkDeleteConfirm(false);
      setBulkDeleteText('');
      setBulkDeleteReason('');
    } catch (err) {
      toast(err.message || 'Bulk delete failed', 'error');
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <div className="page-wrap animate-fade-in-up">
      <AdminSidebar pendingCounts={pendingCounts} userName={getAdminName()} />
      <main className="layout-inner">
        <div className="page-header">
          <h1 className="page-title text-gradient">
            {'\u{1F465}'}
            User Management
          </h1>
          <div className="page-actions">
            <span className="text-sm text-muted">
              {users.length} total &middot; {users.filter(u => u.payment_status === 'approved' || u.payment_status === 'success').length} paid &middot; {users.filter(u => u.account_status === 'active').length} active
            </span>
          </div>
        </div>

        <div className="card mb-md glass-card">
          <div className="card-header">
            <h2 className="card-title">{'\u{1F50D}'} Search & Filter</h2>
            <div className="flex gap-sm">
              <button className="btn btn-ghost btn-sm" onClick={() => exportToCSV(filteredUsers, `users-${new Date().toISOString().split('T')[0]}.csv`)}>
                {'\u{1F4E5}'} Export CSV
              </button>
            </div>
          </div>
          <div className="filters">
            <input className="search-input glass-input" value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search by name, email, phone, or referral_code..." />
            <select value={statusFilter} onChange={e => updateStatusFilter(e.target.value)}>
              <option value="">All Users</option>
              <option value="pending_registration">Pending Registration</option>
              <option value="pending">Payment: Pending</option>
              <option value="approved">Payment: Approved</option>
              <option value="rejected">Payment: Rejected</option>
              <option disabled>{'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'}</option>
              <option value="account_active">Account: Active</option>
              <option value="account_inactive">Account: Inactive</option>
            </select>
          </div>
        </div>

        {selectedIds.size > 0 && (
          <div className="bulk-bar">
            <span className="bulk-count">{selectedIds.size} user{selectedIds.size > 1 ? 's' : ''} selected</span>
            <button className="btn btn-danger btn-sm" onClick={() => setBulkDeleteConfirm(true)}>
              {'\u2715'} Delete Selected
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setSelectedIds(new Set())}>
              Clear Selection
            </button>
          </div>
        )}

        <div className="card glass-card">
          <div className="card-header">
            <h2 className="card-title">{'\u{1F465}'} All Users ({filteredUsers.length})</h2>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '40px' }}>
                    <input type="checkbox"
                      checked={isAllSelected}
                      onChange={handleSelectAll}
                      style={{ cursor: 'pointer', width: '18px', height: '18px' }} />
                  </th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Payment</th>
                  <th>Account</th>
                  <th>Referral</th>
                  <th>Topup</th>
                  <th>Referrals</th>
                  <th>Joined</th>
                  <th>Approved</th>
                  <th>Last Active</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => {
                  return (
                  <React.Fragment key={u.id}>
                    <tr className={selectedIds.has(u.id) ? 'row-selected' : ''}>
                      <td>
                        <input type="checkbox"
                          checked={selectedIds.has(u.id)}
                          onChange={() => handleSelectOne(u.id)}
                          style={{ cursor: 'pointer', width: '18px', height: '18px' }} />
                      </td>
                      <td data-label="Name">
                        <div className="font-semibold">{u.name}</div>
                        <div className="text-xs text-muted">{u.email}</div>
                        <div className="font-mono text-xs" style={{ color: 'var(--primary)' }}>{u.referral_code || '\u2014'}</div>
                      </td>
                      <td data-label="Phone">{u.phone || '\u2014'}</td>
                      <td data-label="Payment">
                        <span className={`badge ${u.payment_status === 'approved' || u.payment_status === 'success' ? 'badge-success' : u.payment_status === 'rejected' ? 'badge-danger' : 'badge-pending'}`}>
                          {u.payment_status ? u.payment_status.charAt(0).toUpperCase() + u.payment_status.slice(1) : 'Pending'}
                        </span>
                      </td>
                      <td data-label="Account">
                        <span className={`badge ${u.account_status === 'active' ? 'badge-success' : u.account_status === 'suspended' ? 'badge-pending' : 'badge-danger'}`}>
                          {(u.account_status || 'inactive').charAt(0).toUpperCase() + (u.account_status || 'inactive').slice(1)}
                        </span>
                      </td>
                      <td data-label="Referral">
                        <span className={`badge ${u.referral_active === false ? 'badge-danger' : 'badge-success'}`}>
                          {u.referral_active === false ? 'INACTIVE' : 'ACTIVE'}
                        </span>
                      </td>
                      <td data-label="Topup">
                        {u.sponsor_topup_completed ? (
                          <span className="badge badge-success badge-xs">Done</span>
                        ) : u.topup_referral_qualified ? (
                          <span className="badge badge-pending badge-xs">Qualified</span>
                        ) : (
                          <span className="badge badge-xs">\u2014</span>
                        )}
                      </td>
                      <td data-label="Referrals">
                        <div>
                          <div className="font-semibold text-sm">{u.total_referral_count || 0}</div>
                          <button className="btn btn-ghost btn-xs"
                            onClick={(e) => { e.stopPropagation(); handleToggleUserExpand(u.id); }}>
                            {expandedUserId === u.id ? 'Hide' : `View${u.payment_status === 'approved' ? ` (${referralCounts[u.id] || 0})` : ''}`}
                          </button>
                        </div>
                      </td>
                      <td data-label="Joined" className="text-xs text-muted" style={{ whiteSpace: 'nowrap' }}>
                        {u.joinedDate ? new Date(u.joinedDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '\u2014'}
                      </td>
                      <td data-label="Approved" className="text-xs text-muted" style={{ whiteSpace: 'nowrap' }}>
                        {u.approvedDate ? new Date(u.approvedDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '\u2014'}
                      </td>
                      <td data-label="Last Active" className="text-xs" style={{ whiteSpace: 'nowrap' }}>
                        {u.lastActiveAt ? (
                          <span style={{ color: getLastActiveStatus(u.lastActiveAt) === 'online' ? 'var(--success)' : getLastActiveStatus(u.lastActiveAt) === 'recent' ? 'var(--warning)' : 'var(--text-tertiary)' }}>
                            {new Date(u.lastActiveAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        ) : <span className="text-muted">\u2014</span>}
                      </td>
                      <td data-label="Actions">
                        <div className="flex flex-col gap-xs" onClick={(e) => e.stopPropagation()}>
                          {(u.account_status === 'suspended' || u.account_status === 'inactive' || u.account_status === 'blocked') && (
                            <button className="btn btn-success btn-xs"
                              onClick={async () => {
                                try {
                                  const res = await fetch(`${API_BASE}/updateUserStatus`, {
                                    method: 'POST',
                                    headers: authHeaders(),
                                    body: JSON.stringify({ userId: u.id, status: 'active', reason: 'Admin activated' }),
                                  });
                                  if (!res.ok) throw new Error((await res.json()).error || 'Activation failed');
                                  toast('User activated');
                                } catch (err) {
                                  toast(err.message, 'error');
                                }
                              }}>Activate</button>
                          )}
                          {u.account_status === 'active' && (
                            <button className="btn btn-warning btn-xs"
                              onClick={async () => {
                                try {
                                  const res = await fetch(`${API_BASE}/updateUserStatus`, {
                                    method: 'POST',
                                    headers: authHeaders(),
                                    body: JSON.stringify({ userId: u.id, status: 'suspended', reason: 'Admin suspended' }),
                                  });
                                  if (!res.ok) throw new Error((await res.json()).error || 'Suspend failed');
                                  toast('User suspended');
                                } catch (err) {
                                  toast(err.message, 'error');
                                }
                              }}>Suspend</button>
                          )}
                          <button className="btn btn-primary btn-xs" onClick={() => setSelectedUser(u)}>View</button>
                          <button className="btn btn-danger btn-xs" onClick={() => setDeleteConfirmUser(u)}>Del</button>
                          {(u.referral_active === false) ? (
                            <button className="btn btn-success btn-xs" onClick={() => handleReferralAction(u.id, 'activate')}>Activate Ref</button>
                          ) : (
                            <button className="btn btn-warning btn-xs" onClick={() => handleReferralAction(u.id, 'deactivate')}>Deact. Ref</button>
                          )}
                          <button className="btn btn-ghost btn-xs" onClick={() => handleReferralAction(u.id, 'reset')}>Reset Ref</button>
                        </div>
                      </td>
                    </tr>
                    {expandedUserId === u.id && (
                      <tr>
                        <td colSpan={13} style={{ padding: '1rem', background: 'var(--bg-alt)' }}>
                          {loadingReferrals ? (
                            <div className="text-muted">Loading referrals...</div>
                          ) : expandedReferrals.length > 0 ? (
                            <>
                              <div className="font-semibold mb-sm text-sm text-muted">
                                Referred by {u.name}:
                              </div>
                              <div className="flex flex-col gap-sm">
                                {expandedReferrals.map((ref) => (
                                  <div key={ref.id} className="flex flex-between items-start gap-sm" style={{ padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '8px' }}>
                                    <div>
                                      <div className="font-semibold text-sm">{ref.name}</div>
                                      <div className="text-xs text-muted">{ref.phone || '\u2014'}</div>
                                      <div className="mt-xs">
                                        {ref.referred_by_status === 'approved' ? (
                                          <span className="badge badge-success badge-xs">Approved</span>
                                        ) : ref.referred_by_status === 'pending' || !ref.referred_by_status ? (
                                          <span className="badge badge-pending badge-xs">Pending</span>
                                        ) : (
                                          <span className="badge badge-danger badge-xs">{ref.referred_by_status}</span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </>
                          ) : (
                            <div className="text-muted text-sm">No referrals yet.</div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                  );
                })}
                {filteredUsers.length === 0 && (
                  <tr><td colSpan={13}><div className="empty-state"><span className="empty-icon">{'\u{1F465}'}</span><span className="empty-text">No users found.</span></div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {deleteSuccessMsg && (
          <div className="toast toast-success" style={{ position: 'fixed', top: '1rem', right: '1rem', zIndex: 9999 }}>
            {'\u2713'} {deleteSuccessMsg}
          </div>
        )}

        {deleteConfirmUser && (
          <div className="modal-overlay" onClick={() => { setDeleteConfirmUser(null); setDeleteReason(''); setDeleteError(''); }}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Confirm Permanent Deletion</h2>
                <button onClick={() => { setDeleteConfirmUser(null); setDeleteReason(''); setDeleteError(''); }} className="modal-close">{'\u2715'}</button>
              </div>
              <div className="modal-body">
                <div className="alert alert-error">
                  <strong>{'\u26A0\uFE0F'} Warning:</strong> Are you sure you want to permanently delete <strong>{deleteConfirmUser.name}</strong> and all associated data? This includes all topups, transactions, payments, screenshots, messages, chat history, notifications, referral records, sponsor data, and uploaded files. This action CANNOT be undone!
                </div>
                <textarea className="input w-full mb-sm"
                  placeholder="Reason for deletion (required)"
                  value={deleteReason}
                  onChange={e => { setDeleteReason(e.target.value); setDeleteError(''); }}
                  rows={2} />
                {deleteError && <div className="alert alert-error">{deleteError}</div>}
              </div>
              <div className="modal-footer">
                <button className={`btn btn-danger${deletingUser ? ' btn-loading' : ''}`}
                  onClick={async () => {
                    if (deletingUser) return;
                    if (!deleteReason.trim()) { setDeleteError('Please provide a reason for deletion.'); return; }
                    setDeleteError('');
                    const u = deleteConfirmUser;
                    setDeletingUser(true);
                    try {
                      await handleDelete(u.id, deleteReason.trim(), u);
                      setDeleteConfirmUser(null);
                      setDeleteReason('');
                    } catch (e) {
                      setDeleteError(e.message || 'Deletion failed');
                    } finally {
                      setDeletingUser(false);
                    }
                  }} disabled={deletingUser}>
                  {deletingUser ? 'Deleting...' : 'Delete Permanently'}
                </button>
                <button className="btn btn-ghost" onClick={() => { setDeleteConfirmUser(null); setDeleteReason(''); setDeleteError(''); }}>
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
              setUsers(prev => prev.map(u => u.id === userId ? { ...u, account_status: 'active' } : u));
            }}
          />
        )}

        {bulkDeleteConfirm && (
          <div className="modal-overlay" onClick={() => { setBulkDeleteConfirm(false); setBulkDeleteText(''); setBulkDeleteReason(''); }}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2>{'\u26A0\uFE0F'} Bulk Delete Users</h2>
                <button onClick={() => { setBulkDeleteConfirm(false); setBulkDeleteText(''); setBulkDeleteReason(''); }} className="modal-close">{'\u2715'}</button>
              </div>
              <div className="modal-body">
                <div className="alert alert-error">
                  <strong>{'\u26A0\uFE0F'} Danger:</strong> You are about to permanently delete <strong>{selectedIds.size} user{selectedIds.size > 1 ? 's' : ''}</strong>. All associated data for each user will be permanently removed. This action CANNOT be undone!
                </div>
                <div className="field">
                  <label>Reason for deletion *</label>
                  <textarea className="input"
                    placeholder="Why are you deleting these users?"
                    value={bulkDeleteReason}
                    onChange={e => setBulkDeleteReason(e.target.value)}
                    rows={3} />
                </div>
                <div className="field">
                  <label>Type <strong>DELETE</strong> to confirm *</label>
                  <input className={`input ${bulkDeleteText && bulkDeleteText !== 'DELETE' ? 'input-error' : bulkDeleteText === 'DELETE' ? '' : ''}`}
                    placeholder="Type DELETE here"
                    value={bulkDeleteText}
                    onChange={e => setBulkDeleteText(e.target.value)} />
                  {bulkDeleteText && bulkDeleteText !== 'DELETE' && (
                    <span className="field-error">Type exactly "DELETE" to confirm</span>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button className={`btn btn-danger${bulkDeleting ? ' btn-loading' : ''}`}
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting || bulkDeleteText !== 'DELETE' || !bulkDeleteReason.trim()}>
                  {bulkDeleting ? 'Deleting...' : `Delete ${selectedIds.size} User${selectedIds.size > 1 ? 's' : ''}`}
                </button>
                <button className="btn btn-ghost" onClick={() => { setBulkDeleteConfirm(false); setBulkDeleteText(''); setBulkDeleteReason(''); }} disabled={bulkDeleting}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
