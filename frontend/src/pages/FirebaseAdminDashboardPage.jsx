import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FirebaseUser, FirebaseTopup, FirebaseNotification } from '../db/firebase-db.js';
import AdminSidebar from '../components/AdminSidebar.jsx';

const ADMIN_KEY = 'fb_admin_token';

function AddUserModal({ onClose, onAdded }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const tempPassword = password || Math.random().toString(36).slice(-8);
      
      const user = await FirebaseUser.create({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        password: tempPassword,
        referredBy: null,
      });

      setSuccess('User created successfully! Default password: ' + tempPassword);
      setTimeout(() => {
        onAdded();
      }, 1500);
    } catch (err) {
      setError(err.message || 'Failed to create user');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-modern-overlay" onClick={onClose}>
      <div className="modal-modern" onClick={e => e.stopPropagation()}>
        <div className="modal-modern-header">
          <h2>Add New User</h2>
          <button onClick={onClose} className="btn-modern btn-modern-ghost btn-modern-sm">{'\u2715'}</button>
        </div>
        <div className="modal-modern-body">
          <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
            Only add users who have completed payment. Login will be enabled after approval.
          </div>

          {error && <div className="alert alert-error">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}

          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Full Name *</label>
              <input required value={name} onChange={e => setName(e.target.value)} placeholder="Enter full name" />
            </div>
            <div className="field">
              <label>Email *</label>
              <input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="user@example.com" />
            </div>
            <div className="field">
              <label>Phone *</label>
              <input required value={phone} onChange={e => setPhone(e.target.value)} placeholder="10-digit mobile number" />
            </div>
            <div className="field">
              <label>Temporary Password (optional)</label>
              <input value={password} onChange={e => setPassword(e.target.value)} placeholder="Leave empty for auto-generated" />
            </div>
            <button className={`btn-modern btn-modern-primary${loading ? ' btn-loading' : ''}`} type="submit" disabled={loading} style={{ width: '100%' }}>
              {loading ? 'Creating...' : 'Create User'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function FirebaseAdminDashboardPage() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [topups, setTopups] = useState([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [reactivatingId, setReactivatingId] = useState(null);
  const [dupAlertCount, setDupAlertCount] = useState(0);
  const [actionUser, setActionUser] = useState(null);
  const [actionMode, setActionMode] = useState(null);
  const [actionReason, setActionReason] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState('');

  function getAdminName() {
    try {
      return sessionStorage.getItem('fb_admin_name') || localStorage.getItem('fb_admin_name') || 'Admin';
    } catch {
      return 'Admin';
    }
  }

  async function handleApproveInactive(userId, reason) {
    setActionLoading(true);
    setActionMsg('');
    try {
      if (!actionMessage || !actionMessage.trim()) {
        setActionMsg('Error: Message to user is required');
        setActionLoading(false);
        return;
      }
      await FirebaseUser.activateUser(userId, getAdminName(), reason);
      await FirebaseNotification.send({
        receiverId: userId,
        receiverName: actionUser?.name || '',
        message: actionMessage,
        type: 'user_activated',
        senderId: getAdminName(),
        senderName: getAdminName(),
      });
      setActionMsg('✓ User approved and activated!');
      setActionUser(null);
      setActionMessage('');
      setTimeout(() => { setActionMsg(''); }, 2000);
    } catch (err) {
      setActionMsg('Error: ' + (err.message || 'Failed to approve'));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRejectInactive(userId, reason) {
    setActionLoading(true);
    setActionMsg('');
    try {
      if (!actionMessage || !actionMessage.trim()) {
        setActionMsg('Error: Message to user is required');
        setActionLoading(false);
        return;
      }
      await FirebaseUser.rejectUser(userId, getAdminName(), reason);
      await FirebaseNotification.send({
        receiverId: userId,
        receiverName: actionUser?.name || '',
        message: actionMessage,
        type: 'user_rejected',
        senderId: getAdminName(),
        senderName: getAdminName(),
      });
      setActionMsg('✓ User rejected!');
      setActionUser(null);
      setActionMessage('');
      setTimeout(() => { setActionMsg(''); }, 2000);
    } catch (err) {
      setActionMsg('Error: ' + (err.message || 'Failed to reject'));
    } finally {
      setActionLoading(false);
    }
  }

  const handleReactivate = async (userId) => {
    setReactivatingId(userId);
    try {
      await FirebaseTopup.reactivateSponsor(userId);
    } catch (err) {
      alert(err.message);
    } finally {
      setReactivatingId(null);
    }
  };

  const stats = useMemo(() => ({
    totalUsers: users.length,
    pendingPayments: users.filter(u => u.payment_status === 'pending').length,
    approvedPayments: users.filter(u => u.payment_status === 'approved').length,
    rejectedPayments: users.filter(u => u.payment_status === 'rejected').length,
    totalReferrals: users.reduce((sum, u) => sum + (u.referrals_count || 0), 0),
    pendingTopups: topups.filter(t => t.status === 'pending').length,
    totalTopupAmount: topups.reduce((sum, t) => sum + (Number(t.amount) || 0), 0),
    eligibleSponsors: users.filter(u => u.topup_referral_qualified && !u.sponsor_topup_completed).length,
    awaitingCredit: users.filter(u => u.sponsor_awaiting_credit && !u.sponsor_credited).length,
    totalCredited: users.reduce((sum, u) => sum + (Number(u.sponsor_credited_amount) || 0), 0),
    duplicateUtrAlerts: 0,
    cyclePendingPayments: users.filter(u => u.cycle_payment_status === 'pending').length,
    totalPendingApprovals: users.filter(u => u.payment_status === 'pending').length + users.filter(u => u.cycle_payment_status === 'pending').length,
  }), [users, topups]);

  useEffect(() => {
    if (users.length > 0) {
      FirebaseUser.getAllUtrs().then(allUtrs => {
        const seen = {};
        let dupCount = 0;
        allUtrs.forEach(u => {
          if (!u.utr) return;
          if (seen[u.utr]) dupCount++;
          seen[u.utr] = u;
        });
        setDupAlertCount(dupCount);
      }).catch(() => {});
    }
  }, [users]);

  const eligibleSponsorsList = useMemo(() => {
    return users.filter(u => u.topup_referral_qualified)
      .map(u => ({
        id: u.id,
        name: u.name || '',
        email: u.email || '',
        phone: u.phone || '',
        referral_code: u.referral_code || '',
        referrals_count: u.referrals_count || 0,
        topup_referrals_count: u.topup_referrals_count || 0,
        sponsor_topup_completed: u.sponsor_topup_completed || false,
        sponsor_awaiting_credit: u.sponsor_awaiting_credit || false,
        sponsor_credited: u.sponsor_credited || false,
        sponsor_credited_amount: u.sponsor_credited_amount || 0,
        account_status: u.account_status || '',
      }))
      .sort((a, b) => {
        if (a.sponsor_credited !== b.sponsor_credited) return a.sponsor_credited ? 1 : -1;
        if (a.sponsor_awaiting_credit !== b.sponsor_awaiting_credit) return a.sponsor_awaiting_credit ? -1 : 1;
        return 0;
      });
  }, [users]);

  const inactiveUsersList = useMemo(() => {
    return users.filter(u => u.account_status === 'inactive')
      .map(u => ({
        id: u.id,
        name: u.name || '',
        email: u.email || '',
        referral_code: u.referral_code || '',
        referrals_count: u.referrals_count || 0,
        topup_referrals_count: u.topup_referrals_count || 0,
        sponsor_topup_completed: u.sponsor_topup_completed || false,
        sponsor_awaiting_credit: u.sponsor_awaiting_credit || false,
        sponsor_credited: u.sponsor_credited || false,
        account_status: u.account_status || '',
        inactive_reason: u.inactive_reason || '',
        is_qualified: u.is_qualified || false,
        referral_limit_reached: u.referral_limit_reached || false,
      }))
      .map(u => {
        let reason = u.inactive_reason;
        if (!reason) {
          if (u.sponsor_awaiting_credit || u.sponsor_topup_completed) reason = 'Own Topup Completed';
          else if (u.referral_limit_reached) reason = '2 Normal Referrals';
          else if (u.is_qualified) reason = 'Qualification Limit';
          else reason = 'Unknown';
        } else if (reason === 'own_topup_completed') {
          reason = 'Own Topup Completed';
        }
        return { ...u, inactiveReason: reason };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users]);

  useEffect(() => {
    const token = localStorage.getItem(ADMIN_KEY);
    if (!token) {
      navigate('/fb-admin', { replace: true });
      return;
    }

    const unsubUsers = FirebaseUser.subscribeToUsers((allUsers) => {
      setUsers(allUsers);
    });

    const unsubTopups = FirebaseTopup.subscribeToTopups((data) => {
      setTopups(data || []);
    });

    return () => {
      if (unsubUsers) unsubUsers();
      if (unsubTopups) unsubTopups();
    };
  }, [navigate]);

  function logout() {
    localStorage.removeItem(ADMIN_KEY);
    navigate('/fb-admin');
  }

  const pendingCounts = useMemo(() => ({
    pendingPayments: stats.pendingPayments,
    pendingTopups: stats.pendingTopups,
  }), [stats]);

  return (
    <div className="admin-layout">
      <AdminSidebar pendingCounts={pendingCounts} userName={getAdminName()} />

      <main className="admin-content">
        <div className="admin-content-inner">
          <div className="admin-page-header">
            <h1 className="admin-page-title">
              <span className="admin-page-title-icon">{'\u{1F4CA}'}</span>
              Dashboard Overview
            </h1>
            <div className="admin-page-actions">
              <button className="btn-modern btn-modern-primary" onClick={() => setShowAddUser(true)}>
                + Add User
              </button>
            </div>
          </div>

          <div className="stats-grid-modern">
            <div className="stat-card-modern accent">
              <div className="stat-bg-icon">{'\u{1F465}'}</div>
              <div className="stat-value">{stats.totalUsers}</div>
              <div className="stat-label">Total Users</div>
              <div className="stat-sub">{'\u{1F4C8}'} Registered</div>
            </div>
            <div className="stat-card-modern warning">
              <div className="stat-bg-icon">{'\u23F3'}</div>
              <div className="stat-value">{stats.pendingPayments}</div>
              <div className="stat-label">Pending Payments</div>
              <div className="stat-sub">{'\u{1F4B3}'} Awaiting review</div>
            </div>
            <div className="stat-card-modern success">
              <div className="stat-bg-icon">{'\u2705'}</div>
              <div className="stat-value">{stats.approvedPayments}</div>
              <div className="stat-label">Approved Payments</div>
              <div className="stat-sub">{'\u{1F4B0}'} Completed</div>
            </div>
            <div className="stat-card-modern warning">
              <div className="stat-bg-icon">{'\u{1F4E4}'}</div>
              <div className="stat-value">{stats.pendingTopups}</div>
              <div className="stat-label">Pending Topups</div>
              <div className="stat-sub">{'\u23F3'} Awaiting review</div>
            </div>
            <div className="stat-card-modern accent">
              <div className="stat-bg-icon">{'\u{1F4B8}'}</div>
              <div className="stat-value">₹{stats.totalTopupAmount.toFixed(2)}</div>
              <div className="stat-label">Total Topup Amount</div>
              <div className="stat-sub">{'\u{1F4C8}'} All time</div>
            </div>
            <div className="stat-card-modern warning">
              <div className="stat-bg-icon">{'\u{1F3C6}'}</div>
              <div className="stat-value">{stats.eligibleSponsors}</div>
              <div className="stat-label">Eligible Sponsors</div>
              <div className="stat-sub">{'\u{1F504}'} Pending topup</div>
            </div>
            <div className="stat-card-modern success">
              <div className="stat-bg-icon">{'\u{1F4B5}'}</div>
              <div className="stat-value">₹{stats.totalCredited.toFixed(2)}</div>
              <div className="stat-label">Total Credited</div>
              <div className="stat-sub">{'\u2705'} Completed</div>
            </div>
            <div className="stat-card-modern" style={{ '--accent-soft': 'transparent' }}>
              <div className="stat-bg-icon">{'\u{1F517}'}</div>
              <div className="stat-value">{stats.totalReferrals}</div>
              <div className="stat-label">Total Referrals</div>
              <div className="stat-sub">{'\u{1F4C8}'} All time</div>
            </div>
            <div className="stat-card-modern danger">
              <div className="stat-bg-icon">{'\u26A0\uFE0F'}</div>
              <div className="stat-value" style={dupAlertCount > 0 ? { color: 'var(--danger)' } : {}}>{dupAlertCount}</div>
              <div className="stat-label">Duplicate UTR</div>
              <div className="stat-sub">{dupAlertCount > 0 ? 'Investigate needed' : 'No issues'}</div>
            </div>
          </div>

          <div className="card-modern card-section">
            <div className="card-modern-header">
              <h2 className="card-modern-title">{'\u{1F4CA}'} Priority Overview</h2>
            </div>
            <div className="priority-grid">
              <Link to="/fb-admin/payments?status=pending" className="priority-card priority-border-warning" style={{ textDecoration: 'none' }}>
                <div className="card-icon">{'\u23F3'}</div>
                <div className="card-value" style={{ color: 'var(--warning)' }}>{stats.totalPendingApprovals}</div>
                <div className="card-label">Pending Approvals</div>
                <span className="priority-link">Review Now {'\u2192'}</span>
              </Link>
              <Link to="/fb-admin/topups" className="priority-card priority-border-accent" style={{ textDecoration: 'none' }}>
                <div className="card-icon">{'\u{1F4E4}'}</div>
                <div className="card-value" style={{ color: 'var(--accent)' }}>{stats.pendingTopups}</div>
                <div className="card-label">Pending Topups</div>
                <span className="priority-link">View {'\u2192'}</span>
              </Link>
              <Link to={dupAlertCount > 0 ? '/fb-admin/payments?status=duplicate_utr' : '#'} className={`priority-card ${dupAlertCount > 0 ? 'priority-border-danger' : 'priority-border-muted'}`} style={{ textDecoration: 'none' }}>
                <div className="card-icon">{'\u26A0\uFE0F'}</div>
                <div className="card-value" style={{ color: dupAlertCount > 0 ? 'var(--danger)' : 'var(--muted)' }}>{dupAlertCount}</div>
                <div className="card-label">Duplicate UTR</div>
                {dupAlertCount > 0 && <span className="priority-link" style={{ color: 'var(--danger)' }}>Investigate {'\u2192'}</span>}
              </Link>
              <Link to="/fb-admin/payments?status=approved" className="priority-card priority-border-success" style={{ textDecoration: 'none' }}>
                <div className="card-icon">{'\u{1F4B3}'}</div>
                <div className="card-value" style={{ color: 'var(--success)' }}>{stats.approvedPayments}</div>
                <div className="card-label">Approved Payments</div>
              </Link>
            </div>
          </div>

          <div className="card-modern card-section">
            <div className="card-modern-header">
              <h2 className="card-modern-title">{'\u{1F4B3}'} Payments by Status</h2>
            </div>
            <div className="table-wrap-modern table-section">
              <table>
                <thead>
                  <tr>
                    <th>Pending</th>
                    <th>Approved</th>
                    <th>Rejected</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <Link to="/fb-admin/payments?status=pending" className="link-stat" style={{ color: 'var(--warning)' }}>
                        {stats.pendingPayments}
                      </Link>
                    </td>
                    <td>
                      <Link to="/fb-admin/payments?status=approved" className="link-stat" style={{ color: 'var(--success)' }}>
                        {stats.approvedPayments}
                      </Link>
                    </td>
                    <td>
                      <Link to="/fb-admin/payments?status=rejected" className="link-stat" style={{ color: 'var(--danger)' }}>
                        {stats.rejectedPayments}
                      </Link>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {showAddUser && (
            <AddUserModal onClose={() => setShowAddUser(false)} onAdded={() => setShowAddUser(false)} />
          )}

          {eligibleSponsorsList.length > 0 && (
            <div className="card-modern card-section">
              <div className="card-modern-header">
                <h2 className="card-modern-title">{'\u{1F3C6}'} Sponsor Status & Topup Eligibility ({eligibleSponsorsList.length})</h2>
              </div>
              <div className="table-wrap-modern table-section">
                <table>
                  <thead>
                    <tr>
                      <th>Sponsor No</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Mobile</th>
                      <th>Refs</th>
                      <th>Topup Refs</th>
                      <th>Total</th>
                      <th>Own Topup</th>
                      <th>Account</th>
                      <th>Credit Status</th>
                      <th>Amount</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eligibleSponsorsList.map(s => (
                      <tr key={s.id}>
                        <td data-label="Sponsor No"><code>{s.referral_code || '—'}</code></td>
                        <td data-label="Name" className="font-semibold">{s.name}</td>
                        <td data-label="Email" className="text-sm">{s.email}</td>
                        <td data-label="Mobile" className="text-sm">{s.phone || '—'}</td>
                        <td data-label="Refs">{s.referrals_count}</td>
                        <td data-label="Topup Refs">{s.topup_referrals_count}</td>
                        <td data-label="Total" className="font-bold">{s.referrals_count + s.topup_referrals_count}</td>
                        <td data-label="Own Topup">
                          {s.sponsor_topup_completed ? (
                            <span className="badge badge-paid badge-xs">Done</span>
                          ) : (
                            <span className="badge badge-pending badge-xs">Pending</span>
                          )}
                        </td>
                        <td data-label="Account">
                          {s.account_status === 'inactive' ? (
                            <span className="badge badge-rejected badge-xs">Inactive</span>
                          ) : (
                            <span className="badge badge-paid badge-xs">Active</span>
                          )}
                        </td>
                        <td data-label="Credit Status">
                          {s.sponsor_credited ? (
                            <span className="badge badge-paid badge-xs">Credited</span>
                          ) : s.sponsor_awaiting_credit ? (
                            <span className="badge badge-pending badge-xs">Awaiting</span>
                          ) : (
                            <span className="badge badge-pending badge-xs">Not Yet</span>
                          )}
                        </td>
                        <td data-label="Amount" className="font-bold">
                          {s.sponsor_credited ? (
                            <span className="text-success">₹{Number(s.sponsor_credited_amount || 0).toFixed(2)}</span>
                          ) : <span className="muted">—</span>}
                        </td>
                        <td data-label="Action">
                          {s.account_status === 'inactive' && (
                            <button className="btn-modern btn-modern-success btn-modern-xs"
                              onClick={() => handleReactivate(s.id)}
                              disabled={reactivatingId === s.id}>
                              {reactivatingId === s.id ? '...' : 'Activate'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {inactiveUsersList.length > 0 && (
            <div className="card-modern card-section">
              <div className="card-modern-header">
                <h2 className="card-modern-title">{'\u26A0\uFE0F'} Inactive Users & Reasons ({inactiveUsersList.length})</h2>
              </div>
              <div className="table-wrap-modern table-section">
                <table>
                  <thead>
                    <tr>
                      <th>Sponsor No</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Status</th>
                      <th>Reason</th>
                      <th>Refs</th>
                      <th>Topup Refs</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inactiveUsersList.map(u => (
                      <tr key={u.id}>
                        <td data-label="Sponsor No"><code>{u.referral_code || '—'}</code></td>
                        <td data-label="Name" className="font-semibold">{u.name}</td>
                        <td data-label="Email" className="text-sm">{u.email}</td>
                        <td data-label="Status"><span className="badge badge-rejected badge-xs">Inactive</span></td>
                        <td data-label="Reason">
                          <span className={`badge ${u.inactiveReason === 'Own Topup Completed' ? 'badge-pending' : 'badge-rejected'} badge-xs`}>
                            {u.inactiveReason}
                          </span>
                        </td>
                        <td data-label="Refs">{u.referrals_count}</td>
                        <td data-label="Topup Refs">{u.topup_referrals_count}</td>
                        <td data-label="Actions">
                          <div className="action-group">
                            <button className="btn-modern btn-modern-success btn-modern-xs"
                              onClick={() => { setActionUser(u); setActionMode('approve'); setActionReason(''); }}>
                              {'\u2713'} Approve
                            </button>
                            <button className="btn-modern btn-modern-danger btn-modern-xs"
                              onClick={() => { setActionUser(u); setActionMode('reject'); setActionReason(''); }}>
                              {'\u2715'} Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {actionUser && (
            <div className="modal-modern-overlay" onClick={() => setActionUser(null)}>
              <div className="modal-modern" onClick={e => e.stopPropagation()}>
                <div className="modal-modern-header">
                  <h2>{actionMode === 'approve' ? 'Approve User' : 'Delete User'}</h2>
                  <button onClick={() => { setActionUser(null); setActionMsg(''); setActionMessage(''); }} className="btn-modern btn-modern-ghost btn-modern-sm">{'\u2715'}</button>
                </div>
                <div className="modal-modern-body">
                  <div className="detail-grid card-section-sm">
                    <div className="detail-row">
                      <span className="detail-label">User</span>
                      <span className="detail-value">{actionUser.name}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Email</span>
                      <span className="detail-value">{actionUser.email}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Status</span>
                      <div>
                        <span className="badge badge-rejected badge-xs">Inactive</span>
                        <span className={`badge ${actionUser.inactiveReason === 'Own Topup Completed' ? 'badge-pending' : 'badge-rejected'} badge-xs`} style={{ marginLeft: '0.25rem' }}>
                          {actionUser.inactiveReason}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="field modal-field-mb">
                    <label>Reason for {actionMode === 'approve' ? 'approval' : 'rejection'}</label>
                    <textarea
                      className="input"
                      placeholder={actionMode === 'approve' ? 'Why are you approving this user?' : 'Why are you rejecting this user?'}
                      value={actionReason}
                      onChange={e => setActionReason(e.target.value)}
                      rows={3}
                    />
                  </div>

                  <div className="field modal-field-mb">
                    <label>Message to User *</label>
                    <textarea
                      className="input"
                      placeholder="Explain to the user why this action was taken (required)"
                      value={actionMessage}
                      onChange={e => setActionMessage(e.target.value)}
                      rows={2}
                    />
                  </div>

                  {actionMsg && (
                    <div className={`alert ${actionMsg.includes('\u2713') ? 'alert-success' : 'alert-error'} modal-alert-mb`}>
                      {actionMsg}
                    </div>
                  )}
                </div>
                <div className="modal-modern-footer">
                  {actionMode === 'approve' ? (
                    <button className={`btn-modern btn-modern-success${actionLoading ? ' btn-loading' : ''}`}
                      onClick={() => handleApproveInactive(actionUser.id, actionReason)}
                      disabled={actionLoading}>
                      {actionLoading ? 'Approving...' : '\u2713 Confirm Approve'}
                    </button>
                  ) : (
                    <button className={`btn-modern btn-modern-danger${actionLoading ? ' btn-loading' : ''}`}
                      onClick={() => handleRejectInactive(actionUser.id, actionReason)}
                      disabled={actionLoading}>
                      {actionLoading ? 'Deleting...' : '\u2715 Confirm Delete'}
                    </button>
                  )}
                  <button className="btn-modern btn-modern-ghost" onClick={() => { setActionUser(null); setActionMsg(''); setActionMessage(''); }} disabled={actionLoading}>
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