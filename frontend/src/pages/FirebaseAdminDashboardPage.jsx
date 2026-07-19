import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FirebaseUser, FirebaseNotification } from '../db/firebase-db.js';
import { computePaymentAnalytics } from '../db/payment-analytics.js';
import AdminSidebar from '../components/AdminSidebar.jsx';

const API_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';

const ADMIN_KEY = 'fb_admin_token';

function authHeaders() {
  const t = localStorage.getItem(ADMIN_KEY);
  return t ? { 'Cache-Control': 'no-cache', 'Authorization': 'Bearer ' + t } : { 'Cache-Control': 'no-cache' };
}

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

      const user = await FirebaseUser.createWithPassword({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        password: tempPassword,
        referredBy: null,
        approved: true,
        active: true,
        loginEnabled: true,
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add New User</h2>
          <button onClick={onClose} className="modal-close">{'\u2715'}</button>
        </div>
        <div className="modal-body">
          <div className="alert alert-error">
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
            <button className={`btn btn-primary w-full${loading ? ' btn-loading' : ''}`} type="submit" disabled={loading}>
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
  const [healthData, setHealthData] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [actionUser, setActionUser] = useState(null);
  const [actionReason, setActionReason] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState('');
  const [approveSponsorUser, setApproveSponsorUser] = useState(null);
  const [approveSponsorLoading, setApproveSponsorLoading] = useState(false);
  const [sponsorClaims, setSponsorClaims] = useState([]);
  const [rejectSponsorUser, setRejectSponsorUser] = useState(null);
  const [rejectSponsorReason, setRejectSponsorReason] = useState('');
  const [rejectSponsorLoading, setRejectSponsorLoading] = useState(false);
  const [showClaimHistory, setShowClaimHistory] = useState(null);
  const actionMsgTimeoutRef = useRef(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [sseCounts, setSseCounts] = useState({ pending_payments: 0, pending_registrations: 0 });
  const [sseTime, setSseTime] = useState(null);
  const sseRef = useRef(null);

  useEffect(() => {
    return () => {
      if (actionMsgTimeoutRef.current) clearTimeout(actionMsgTimeoutRef.current);
    };
  }, []);

  function getAdminName() {
    try {
      return sessionStorage.getItem('fb_admin_name') || localStorage.getItem('fb_admin_name') || 'Admin';
    } catch {
      return 'Admin';
    }
  }

  async function handleDeleteInactive(userId, reason) {
    setActionLoading(true);
    setActionMsg('');
    try {
      const user = actionUser;
      await FirebaseUser.deleteUser(userId, { email: user?.email, phone: user?.phone });
      setUsers(prev => prev.filter(u => u.id !== userId));
      setActionMsg('✓ User permanently deleted');
      setActionUser(null);
      setActionMessage('');
      if (actionMsgTimeoutRef.current) clearTimeout(actionMsgTimeoutRef.current);
      actionMsgTimeoutRef.current = setTimeout(() => { setActionMsg(''); }, 3000);
    } catch (err) {
      console.error('[DELETE ERROR]', err);
      const detail = err.response?.data?.message || err.message || 'Failed to delete user';
      setActionMsg('Error: ' + detail + ' (see console for details)');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleApproveSponsor(userId) {
    setApproveSponsorLoading(true);
    try {
      const res = await fetch(`${API_BASE}/approveSponsor`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to approve sponsor');
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, account_status: 'active', inactive_reason: '', sponsor_awaiting_credit: false, sponsor_credited: true, sponsor_credited_amount: data.claimAmount } : u));
      setSponsorClaims(prev => prev.filter(c => c.sponsor_id !== userId));
      setApproveSponsorUser(null);
      setActionMsg(data.claimAmount > 0 ? `✓ Sponsor claim approved. ₹${data.claimAmount.toFixed(2)} credited.` : '✓ Sponsor claim approved.');
      if (actionMsgTimeoutRef.current) clearTimeout(actionMsgTimeoutRef.current);
      actionMsgTimeoutRef.current = setTimeout(() => setActionMsg(''), 3000);
    } catch (err) {
      setActionMsg('Error: ' + (err.message || 'Failed to approve sponsor'));
    } finally {
      setApproveSponsorLoading(false);
    }
  }

  async function handleRejectSponsor(userId) {
    setRejectSponsorLoading(true);
    try {
      const res = await fetch(`${API_BASE}/rejectSponsor`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, reason: rejectSponsorReason || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reject sponsor');
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, account_status: 'active', inactive_reason: '', sponsor_awaiting_credit: false } : u));
      setSponsorClaims(prev => prev.filter(c => c.sponsor_id !== userId));
      setRejectSponsorUser(null);
      setRejectSponsorReason('');
      setActionMsg('✓ Sponsor claim rejected. Account reactivated.');
      if (actionMsgTimeoutRef.current) clearTimeout(actionMsgTimeoutRef.current);
      actionMsgTimeoutRef.current = setTimeout(() => setActionMsg(''), 3000);
    } catch (err) {
      setActionMsg('Error: ' + (err.message || 'Failed to reject sponsor'));
    } finally {
      setRejectSponsorLoading(false);
    }
  }

  const REGISTRATION_FEE = Number(import.meta.env.VITE_PAYMENT_AMOUNT) || 120;
  const todayStr = new Date().toISOString().split('T')[0];
  const stats = useMemo(() => {
    const approvedUsers = users.filter(u => u.payment_status === 'approved' || u.payment_status === 'success' || u.membershipStatus === 'active');
    const regRevenue = approvedUsers.length * REGISTRATION_FEE;
    const topupRevenue = topups.filter(t => t.status === 'approved').reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const ALLOWED_PACKAGES = [120, 500, 1000];
    const totalPackagePaymentAmount = approvedUsers.reduce((sum, u) => {
      const amt = Number(u.user_entered_amount);
      if (amt && ALLOWED_PACKAGES.includes(amt)) return sum + amt;
      if (!amt || amt === 0) return sum + 120;
      return sum;
    }, 0);
    const todayUserCount = users.filter(u => u.created_at && u.created_at.startsWith(todayStr)).length;
    const todayTopupCount = topups.filter(t => t.created_at && t.created_at.startsWith(todayStr)).length;
    const todayApprovedPayments = users.filter(u => (u.payment_status === 'approved' || u.payment_status === 'success') && u.created_at && u.created_at.startsWith(todayStr)).length;
    const todayRevenue = approvedUsers.filter(u => u.created_at && u.created_at.startsWith(todayStr)).length * REGISTRATION_FEE
      + topups.filter(t => t.status === 'approved' && t.created_at && t.created_at.startsWith(todayStr)).reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const todayReferrals = users.filter(u => u.created_at && u.created_at.startsWith(todayStr)).reduce((sum, u) => sum + (u.referrals_count || 0), 0);
    return {
      totalUsers: users.length,
      successPayments: approvedUsers.length,
      approvedPayments: users.filter(u => u.payment_status === 'approved' || u.payment_status === 'success').length,
      rejectedPayments: users.filter(u => u.payment_status === 'rejected').length,
      totalReferrals: users.reduce((sum, u) => sum + (u.referrals_count || 0), 0),
      pendingTopups: topups.filter(t => t.status === 'pending').length,
      totalTopupAmount: topups.reduce((sum, t) => sum + (Number(t.amount) || 0), 0),
      totalRevenue: regRevenue + topupRevenue,
      totalPackagePaymentAmount,
      eligibleSponsors: users.filter(u => u.topup_referral_qualified && !u.sponsor_topup_completed).length,
      awaitingCredit: users.filter(u => u.sponsor_awaiting_credit && !u.sponsor_credited).length,
      totalCredited: users.reduce((sum, u) => sum + (Number(u.sponsor_credited_amount) || 0), 0),
      approvedTopups: topups.filter(t => t.status === 'approved').length,
      rejectedTopups: topups.filter(t => t.status === 'rejected').length,
      activeUsers: users.filter(u => u.account_status === 'active').length,
      inactiveUsers: users.filter(u => u.account_status === 'inactive').length,
      suspendedUsers: users.filter(u => u.account_status === 'suspended').length,
      blockedUsers: users.filter(u => u.account_status === 'blocked').length,
      membershipActive: users.filter(u => u.membershipStatus === 'active').length,
      sponsorsAwaitingRenewal: users.filter(u => u.sponsorRenewalRequired === true).length,
      usersNeedingReview: users.filter(u => u.reviewRequired === true).length,
      todayRegistrations: todayUserCount,
      todayPayments: todayApprovedPayments,
      todayRevenue,
      todayReferrals,
      todayTopups: todayTopupCount,
    };
  }, [users, topups, REGISTRATION_FEE, todayStr]);

  const paymentAnalytics = useMemo(() => computePaymentAnalytics(users, topups), [users, topups]);
  const [analyticsFilter, setAnalyticsFilter] = useState('Approved Only');
  const filteredEntries = useMemo(() => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const monthStr = todayStr.substring(0, 7);
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekStartStr = weekStart.toISOString();
    return paymentAnalytics.allEntries.filter(e => {
      if (analyticsFilter === 'Today') return e.approvedAt && e.approvedAt.startsWith(todayStr);
      if (analyticsFilter === 'This Week') return e.approvedAt && e.approvedAt >= weekStartStr;
      if (analyticsFilter === 'This Month') return e.approvedAt && e.approvedAt.startsWith(monthStr);
      return true;
    });
  }, [paymentAnalytics, analyticsFilter]);

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
    const claimsBySponsor = {};
    for (const c of sponsorClaims) {
      if (c.status === 'pending') {
        claimsBySponsor[c.sponsor_id] = c;
      }
    }
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
        claimInfo: claimsBySponsor[u.id] || null,
      }))
      .map(u => {
        let reason = u.inactive_reason;
        if (!reason) {
          if (u.sponsor_awaiting_credit) reason = 'Sponsor Claim Pending Admin Approval';
          else if (u.sponsor_topup_completed) reason = 'Own Topup Completed';
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

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/getAdminDashboardData`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      if (result.success) {
        setUsers(result.users || []);
        setTopups(result.topups || []);
        setSponsorClaims(result.sponsorClaims || []);
      }
    } catch (err) {
      console.error('[ADMIN DASHBOARD] Failed to fetch data:', err);
    }
  }, []);

  const fetchHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const res = await fetch(`${API_BASE}/getHealthStatus`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ refresh: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      if (result.success) setHealthData(result);
    } catch (err) {
      console.error('[ADMIN DASHBOARD] Failed to fetch health:', err);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem(ADMIN_KEY);
    if (!token) {
      navigate('/fb-admin', { replace: true });
      return;
    }

    fetchData();
    fetchHealth();

    const interval = setInterval(fetchData, 30000);

    return () => clearInterval(interval);
  }, [navigate, fetchData, fetchHealth]);

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_FUNCTIONS_URL || '';
    const token = localStorage.getItem(ADMIN_KEY) || '';
    const eventSource = new EventSource(`${baseUrl}/sse/dashboard?token=${encodeURIComponent(token)}`);

    eventSource.onopen = () => setSseConnected(true);
    eventSource.addEventListener('connected', () => setSseConnected(true));
    eventSource.addEventListener('initialState', (e) => {
      try {
        const data = JSON.parse(e.data);
        setSseCounts({ pending_payments: data.pending_payments, pending_registrations: data.pending_registrations });
        setSseTime(data.timestamp);
      } catch (_) {}
    });
    eventSource.addEventListener('paymentUpdated', () => {
      fetchData();
    });
    eventSource.onerror = () => {
      setSseConnected(false);
    };

    sseRef.current = eventSource;
    return () => eventSource.close();
  }, [fetchData]);

  function logout() {
    localStorage.removeItem(ADMIN_KEY);
    navigate('/fb-admin');
  }

  const pendingCounts = useMemo(() => ({
    pendingPayments: 0,
    pendingTopups: stats.pendingTopups,
  }), [stats]);

  return (
    <div className="page-wrap animate-fade-in-up">
      <AdminSidebar pendingCounts={pendingCounts} userName={getAdminName()} />
      <main className="layout-inner">
        <div className="page-header">
          <h1 className="page-title text-gradient">
            Dashboard Overview
          </h1>
          <div className="page-actions">
            <button className="btn btn-primary" onClick={() => setShowAddUser(true)}>
              + Add User
            </button>
            <span className={`sse-indicator ${sseConnected ? 'online' : 'offline'}`}>
              <span className="sse-dot" /> {sseConnected ? 'Live' : 'Disconnected'}
            </span>
          </div>
        </div>

        <div className="stats-grid animate-fade-in" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <div className="card card-hover glass-card" style={{ padding: '1.5rem' }}>
            <div className="flex items-center gap-sm mb-sm">
              <div style={{ fontSize: '1.5rem', opacity: 0.6 }}>{'\u{1F4B0}'}</div>
              <span className="text-sm text-muted font-medium">Total Payment Amount</span>
            </div>
            <div className="text-2xl font-bold" style={{ color: 'var(--primary)' }}>
              {'\u20B9'}{stats.totalPackagePaymentAmount.toLocaleString('en-IN')}
            </div>
            <div className="text-xs text-muted mt-xs">{'\u20B9'}120 + {'\u20B9'}500 + {'\u20B9'}1,000 packages</div>
          </div>
          <div className="card card-hover glass-card" style={{ padding: '1.5rem' }}>
            <div className="flex items-center gap-sm mb-sm">
              <div style={{ fontSize: '1.5rem', opacity: 0.6 }}>{'\u{1F4B3}'}</div>
              <span className="text-sm text-muted font-medium">Total Topup Amount</span>
            </div>
            <div className="text-2xl font-bold" style={{ color: 'var(--success)' }}>
              {'\u20B9'}{stats.totalTopupAmount.toLocaleString('en-IN')}
            </div>
            <div className="text-xs text-muted mt-xs">Topup transactions only</div>
          </div>
        </div>

        {sseTime && (
          <div className="sse-time">{sseConnected ? '\u25CF' : '\u25CB'} Last updated: {new Date(sseTime).toLocaleString('en-IN')}</div>
        )}

        <div className="stats-grid">
          <div className="stat-card accent-info">
            <div className="stat-bg-icon">{'\u{1F4C5}'}</div>
            <div className="stat-value">{stats.todayRegistrations}</div>
            <div className="stat-label">Today's Registrations</div>
            <div className="stat-sub">{'\u{1F4C8}'} New users</div>
          </div>
          <div className="stat-card accent-success">
            <div className="stat-bg-icon">{'\u{1F4B3}'}</div>
            <div className="stat-value">{stats.todayPayments}</div>
            <div className="stat-label">Today's Payments</div>
            <div className="stat-sub">{'\u2705'} Approved</div>
          </div>
          <div className="stat-card accent-primary">
            <div className="stat-bg-icon">{'\u{1F4B0}'}</div>
            <div className="stat-value">₹{stats.todayRevenue.toFixed(2)}</div>
            <div className="stat-label">Today's Revenue</div>
            <div className="stat-sub">{'\u{1F4C8}'} Collected</div>
          </div>
          <div className="stat-card accent-warning">
            <div className="stat-bg-icon">{'\u{1F517}'}</div>
            <div className="stat-value">{stats.todayReferrals}</div>
            <div className="stat-label">Today's Referrals</div>
            <div className="stat-sub">{'\u{1F4C8}'} Generated</div>
          </div>
          <div className="stat-card accent-info">
            <div className="stat-bg-icon">{'\u{1F4E4}'}</div>
            <div className="stat-value">{stats.todayTopups}</div>
            <div className="stat-label">Today's Topups</div>
            <div className="stat-sub">{'\u{1F504}'} Submitted</div>
          </div>
        </div>

        <div className="card glass-card">
          <div className="card-header">
            <h2 className="card-title">{'\u{1F4CA}'} Priority Overview</h2>
          </div>
          <div className="card-body">
            <div className="priority-grid">
              <Link to="/fb-admin/topups" className="priority-card" style={{ textDecoration: 'none' }}>
                <div>{'\u{1F4E4}'}</div>
                <div className="stat-value" style={{ color: 'var(--accent)' }}>{stats.pendingTopups}</div>
                <div className="stat-label">Pending Topups</div>
                <span className="priority-link">View {'\u2192'}</span>
              </Link>
              <Link to="/fb-admin/payments?status=approved" className="priority-card" style={{ textDecoration: 'none' }}>
                <div>{'\u{1F4B3}'}</div>
                <div className="stat-value" style={{ color: 'var(--success)' }}>{stats.approvedPayments}</div>
                <div className="stat-label">Approved Payments</div>
              </Link>
              <Link to="/fb-admin/topups?status=approved" className="priority-card" style={{ textDecoration: 'none' }}>
                <div>{'\u{1F4E4}'}</div>
                <div className="stat-value" style={{ color: 'var(--success)' }}>{stats.approvedTopups}</div>
                <div className="stat-label">Approved Top-Ups</div>
                <span className="priority-link">View {'\u2192'}</span>
              </Link>
            </div>
          </div>
        </div>

        <div className="stats-grid">
          <div className="card glass-card">
            <div className="card-header">
              <h2 className="card-title">{'\u26A1'} Quick Actions</h2>
            </div>
            <div className="card-body">
              <div className="quick-actions-grid">
                <button className="quick-action-btn" onClick={() => navigate('/fb-admin/upi-payments')}>
                  {'\u{1F504}'} Process Payments
                </button>
                <button className="quick-action-btn" onClick={() => setShowAddUser(true)}>
                  {'\u2795'} Add User
                </button>
                <button className="quick-action-btn" onClick={() => navigate('/fb-admin/users')}>
                  {'\u{1F465}'} Manage Users
                </button>
                <button className="quick-action-btn" onClick={() => navigate('/fb-admin/payments')}>
                  {'\u{1F4B3}'} View Payments
                </button>
                <button className="quick-action-btn" onClick={() => navigate('/fb-admin/topups')}>
                  {'\u{1F4E4}'} View Topups
                </button>
                <button className="quick-action-btn" onClick={() => navigate('/fb-admin/status')}>
                  {'\u{1F50D}'} System Status
                </button>
              </div>
            </div>
          </div>

          <div className="card glass-card">
            <div className="card-header">
              <h2 className="card-title">{'\u{1F4CA}'} System Health</h2>
              <button className="btn btn-ghost btn-sm" onClick={fetchHealth} disabled={healthLoading}>
                {healthLoading ? '...' : '\u{1F504}'}
              </button>
            </div>
            <div className="card-body">
              {healthData ? (
                <>
                  <div className="health-grid">
                    {healthData.health && Object.entries(healthData.health).slice(0, 6).map(([key, val]) => (
                      <div key={key} className="health-item">
                        <span className={`health-dot ${val?.status === 'ok' ? 'online' : val?.status === 'degraded' ? 'degraded' : 'offline'}`} />
                        <span className="health-metric-label">{key.charAt(0).toUpperCase() + key.slice(1)}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    {healthData.metrics && (
                      <>
                        <div className="health-metric">
                          <span className="health-metric-label">Uptime</span>
                          <span className="health-metric-value">
                            {healthData.metrics.uptime_seconds > 86400
                              ? Math.floor(healthData.metrics.uptime_seconds / 86400) + 'd '
                              : ''}
                            {Math.floor((healthData.metrics.uptime_seconds % 86400) / 3600)}h {Math.floor((healthData.metrics.uptime_seconds % 3600) / 60)}m
                          </span>
                        </div>
                        <div className="health-metric">
                          <span className="health-metric-label">API Calls</span>
                          <span className="health-metric-value">{healthData.metrics.api_calls?.total || 0}</span>
                        </div>
                        <div className="health-metric">
                          <span className="health-metric-label">Auth Failure Rate</span>
                          <span className="health-metric-value" style={{ color: (healthData.metrics.auth?.failure_rate || 0) > 10 ? 'var(--danger)' : 'var(--success)' }}>
                            {healthData.metrics.auth?.failure_rate || 0}%
                          </span>
                        </div>
                        <div className="health-metric">
                          <span className="health-metric-label">Payment Approval Rate</span>
                          <span className="health-metric-value" style={{ color: (healthData.metrics.payments?.approval_rate || 0) > 50 ? 'var(--success)' : 'var(--warning)' }}>
                            {healthData.metrics.payments?.approval_rate || 0}%
                          </span>
                        </div>
                        <div className="health-metric">
                          <span className="health-metric-label">OCR Success Rate</span>
                          <span className="health-metric-value" style={{ color: (healthData.metrics.ocr?.success_rate || 0) > 80 ? 'var(--success)' : (healthData.metrics.ocr?.success_rate || 0) > 50 ? 'var(--warning)' : 'var(--danger)' }}>
                            {healthData.metrics.ocr?.success_rate || 0}%
                          </span>
                        </div>
                        <div className="health-metric">
                          <span className="health-metric-label">DB Errors</span>
                          <span className="health-metric-value" style={{ color: (healthData.metrics.database?.supabase_errors || 0) > 0 ? 'var(--danger)' : 'var(--success)' }}>
                            {healthData.metrics.database?.supabase_errors || 0}
                          </span>
                        </div>
                        <div className="health-metric">
                          <span className="health-metric-label">Queue Pending</span>
                          <span className="health-metric-value" style={{ color: (healthData.queue?.pending || 0) > 0 ? 'var(--warning)' : 'var(--success)' }}>
                            {healthData.queue?.pending || 0}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  {healthLoading ? 'Loading...' : 'No health data'}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="card glass-card">
          <div className="card-header">
            <h2 className="card-title">{'\u{1F4CA}'} Collection Analytics</h2>
          </div>
          <div className="card-body">
            <div className="stats-grid">
              <div className="stat-card accent-success">
                <div className="stat-bg-icon">{'\u{1F4B0}'}</div>
                <div className="stat-value">₹{paymentAnalytics.totalCollectionAmount.toFixed(2)}</div>
                <div className="stat-label">Total Collection Amount</div>
                <div className="stat-sub">{'\u2705'} Approved entries</div>
              </div>
              <div className="stat-card accent-primary">
                <div className="stat-bg-icon">{'\u{1F4CB}'}</div>
                <div className="stat-value">{paymentAnalytics.totalApprovedPayments}</div>
                <div className="stat-label">Total Approved Payments</div>
                <div className="stat-sub">{'\u{1F4B3}'} Entries</div>
              </div>
              <div className="stat-card accent-success">
                <div className="stat-bg-icon">{'\u{1F4C5}'}</div>
                <div className="stat-value">₹{paymentAnalytics.todayCollection.toFixed(2)}</div>
                <div className="stat-label">Today's Collection</div>
                <div className="stat-sub">{'\u{1F4C8}'} Daily total</div>
              </div>
              <div className="stat-card accent-warning">
                <div className="stat-bg-icon">{'\u{1F4C6}'}</div>
                <div className="stat-value">₹{paymentAnalytics.monthCollection.toFixed(2)}</div>
                <div className="stat-label">This Month Collection</div>
                <div className="stat-sub">{'\u{1F4C8}'} Monthly total</div>
              </div>
              <div className="stat-card accent-info">
                <div className="stat-bg-icon">{'\u{1F522}'}</div>
                <div className="stat-value">₹{paymentAnalytics.averagePaymentValue.toFixed(2)}</div>
                <div className="stat-label">Average Payment Value</div>
                <div className="stat-sub">{'\u{1F4C8}'} Per entry</div>
              </div>
            </div>

            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-value text-lg">₹{paymentAnalytics.todayCollection.toFixed(2)}</div>
                <div className="stat-label text-xs">Daily Collection</div>
              </div>
              <div className="stat-card">
                <div className="stat-value text-lg">₹{paymentAnalytics.weekCollection.toFixed(2)}</div>
                <div className="stat-label text-xs">Weekly Collection</div>
              </div>
              <div className="stat-card">
                <div className="stat-value text-lg">₹{paymentAnalytics.monthCollection.toFixed(2)}</div>
                <div className="stat-label text-xs">Monthly Collection</div>
              </div>
              <div className="stat-card">
                <div className="stat-value text-lg">₹{paymentAnalytics.yearCollection.toFixed(2)}</div>
                <div className="stat-label text-xs">Yearly Collection</div>
              </div>
            </div>

            <div className="mt-lg">
              <div className="flex flex-between items-center mb-md" style={{ borderBottom: '1px solid var(--border)' }}>
                <h3 className="card-title text-gradient-success" style={{ fontSize: '0.95rem' }}>
                  {'\u{1F4CB}'} Payment Collection Records
                  <span className="text-xs text-muted font-semibold">
                    ({filteredEntries.length} entries)
                  </span>
                </h3>
                <div className="flex gap-xs flex-wrap">
                  {['Approved Only', 'Today', 'This Week', 'This Month'].map(f => (
                    <button key={f}
                      className={`btn btn-sm ${analyticsFilter === f ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setAnalyticsFilter(f)}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>User ID</th>
                      <th>User Name</th>
                      <th>Transaction ID</th>
                      <th>Amount</th>
                      <th>Payment Date</th>
                      <th>Approval Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntries.length === 0 ? (
                      <tr><td colSpan={6} className="text-center text-muted" style={{ padding: '2rem' }}>No approved entries found</td></tr>
                    ) : filteredEntries.slice(0, 100).map((e, i) => (
                      <tr key={e.transactionId + '-' + e.userId + '-' + i}>
                        <td data-label="User ID"><code className="text-xs">{e.userId ? e.userId.substring(0, 12) + '...' : '—'}</code></td>
                        <td data-label="User Name" className="font-semibold">{e.userName || '—'}</td>
                        <td data-label="Transaction ID" className="text-sm">{e.transactionId}</td>
                        <td data-label="Amount" className="font-bold">₹{e.amount.toFixed(2)}</td>
                        <td data-label="Payment Date" className="text-sm">
                          {e.paymentDate ? new Date(e.paymentDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                        </td>
                        <td data-label="Approval Status"><span className="badge badge-success badge-xs">Approved</span></td>
                      </tr>
                    ))}
                    {filteredEntries.length > 100 && (
                      <tr><td colSpan={6} className="text-center text-muted text-sm" style={{ padding: '0.5rem' }}>
                        Showing 100 of {filteredEntries.length} entries
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="stats-grid mt-lg" style={{ gap: '0.5rem' }}>
              <div className="card-dim text-center">
                <div className="text-xs text-muted mb-xs">Payments</div>
                <div className="stat-value" style={{ color: 'var(--success)' }}>{paymentAnalytics.approvedPaymentsCount}</div>
              </div>
              <div className="card-dim text-center">
                <div className="text-xs text-muted mb-xs">Topups</div>
                <div className="stat-value" style={{ color: 'var(--accent)' }}>{paymentAnalytics.approvedTopupsCount}</div>
              </div>
              <div className="card-dim text-center">
                <div className="text-xs text-muted mb-xs">Collection Growth</div>
                <div className="stat-value" style={{ color: 'var(--info)' }}>
                  {paymentAnalytics.totalCollectionAmount > 0
                    ? ((paymentAnalytics.monthCollection / paymentAnalytics.totalCollectionAmount) * 100).toFixed(1) + '%'
                    : '0%'}
                </div>
              </div>
              <div className="card-dim text-center">
                <div className="text-xs text-muted mb-xs">Total Users Paid</div>
                <div className="stat-value" style={{ color: '#eab308' }}>{paymentAnalytics.approvedPaymentsCount}</div>
              </div>
            </div>
          </div>
        </div>

        {showAddUser && (
          <AddUserModal onClose={() => setShowAddUser(false)} onAdded={() => setShowAddUser(false)} />
        )}

        {eligibleSponsorsList.length > 0 && (
          <div className="card glass-card">
            <div className="card-header">
              <h2 className="card-title text-gradient">{'\u{1F3C6}'} Sponsor Status & Topup Eligibility ({eligibleSponsorsList.length})</h2>
            </div>
            <div className="card-body">
              <div className="table-wrap">
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
                            <span className="badge badge-success badge-xs">Done</span>
                          ) : (
                            <span className="badge badge-pending badge-xs">Pending</span>
                          )}
                        </td>
                        <td data-label="Account">
                          {s.account_status === 'inactive' ? (
                            <span className="badge badge-danger badge-xs">Inactive</span>
                          ) : (
                            <span className="badge badge-success badge-xs">Active</span>
                          )}
                        </td>
                        <td data-label="Credit Status">
                          {s.sponsor_credited ? (
                            <span className="badge badge-success badge-xs">Credited</span>
                          ) : s.sponsor_awaiting_credit ? (
                            <span className="badge badge-pending badge-xs">Awaiting</span>
                          ) : (
                            <span className="badge badge-pending badge-xs">Not Yet</span>
                          )}
                        </td>
                        <td data-label="Amount" className="font-bold">
                          {s.sponsor_credited ? (
                            <span style={{ color: 'var(--success)' }}>₹{Number(s.sponsor_credited_amount || 0).toFixed(2)}</span>
                          ) : <span className="text-muted">—</span>}
                        </td>
                        <td data-label="Action">
                          <span className="text-muted text-xs">Auto-managed</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {sponsorClaims.filter(c => c.status === 'pending').length > 0 && (
          <div className="card glass-card" style={{ borderLeft: '3px solid var(--warning)' }}>
            <div className="card-header">
              <h2 className="card-title text-gradient">{'\u{1F3C6}'} Pending Sponsor Claims ({sponsorClaims.filter(c => c.status === 'pending').length})</h2>
            </div>
            <div className="card-body">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Sponsor Name</th>
                      <th>Referral Code</th>
                      <th>Claim Amount</th>
                      <th>Items</th>
                      <th>Claim Date</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sponsorClaims.filter(c => c.status === 'pending').map(c => {
                      const sponsor = users.find(u => u.id === c.sponsor_id);
                      return (
                        <tr key={c.id}>
                          <td className="font-semibold">{sponsor?.name || c.sponsor_id?.substring(0, 12) || '—'}</td>
                          <td><code>{sponsor?.referral_code || '—'}</code></td>
                          <td className="font-bold" style={{ color: 'var(--success)' }}>₹{Number(c.claim_amount || 0).toFixed(2)}</td>
                          <td>{c.items_count || 0}</td>
                          <td className="text-sm">{c.claim_date ? new Date(c.claim_date).toLocaleDateString() : '—'}</td>
                          <td><span className="badge badge-pending badge-xs">Pending</span></td>
                          <td>
                            <div className="flex gap-xs">
                              <button className="btn btn-success btn-sm"
                                onClick={() => {
                                  const enriched = { ...sponsor, inactiveReason: 'Sponsor Claim Pending Admin Approval', claimInfo: c };
                                  setApproveSponsorUser(enriched);
                                }}>
                                {'\u2713'} Approve
                              </button>
                              <button className="btn btn-danger btn-sm"
                                onClick={() => {
                                  const enriched = { ...sponsor, inactiveReason: 'Sponsor Claim Pending Admin Approval', claimInfo: c };
                                  setRejectSponsorUser(enriched);
                                }}>
                                {'\u2715'} Reject
                              </button>
                              <button className="btn btn-ghost btn-sm"
                                onClick={() => {
                                  const enriched = { ...sponsor, inactiveReason: 'Sponsor Claim Pending Admin Approval', claimInfo: c };
                                  setShowClaimHistory(enriched);
                                }}>
                                {'\u{1F4CB}'} Details
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {inactiveUsersList.length > 0 && (
          <div className="card glass-card">
            <div className="card-header">
              <h2 className="card-title text-gradient-danger">{'\u26A0\uFE0F'} Inactive Users & Reasons ({inactiveUsersList.length})</h2>
            </div>
            <div className="card-body">
              <div className="table-wrap">
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
                        <td data-label="Status"><span className="badge badge-danger badge-xs">Inactive</span></td>
                        <td data-label="Reason">
                          <span className={`badge ${u.inactiveReason === 'Own Topup Completed' ? 'badge-pending' : 'badge-danger'} badge-xs`}>
                            {u.inactiveReason}
                          </span>
                        </td>
                        <td data-label="Refs">{u.referrals_count}</td>
                        <td data-label="Topup Refs">{u.topup_referrals_count}</td>
                        <td data-label="Actions">
                          <div className="flex gap-xs flex-wrap">
                            {(u.inactiveReason && (u.inactiveReason.includes('Referral Limit') || u.inactiveReason.includes('Sponsor Claim Pending'))) && (
                              <button className="btn btn-success btn-sm"
                                onClick={() => setApproveSponsorUser(u)}>
                                {'\u2713'} Approve
                              </button>
                            )}
                            {u.inactiveReason && u.inactiveReason.includes('Sponsor Claim Pending') && (
                              <button className="btn btn-danger btn-sm"
                                onClick={() => { setRejectSponsorUser(u); setRejectSponsorReason(''); }}>
                                {'\u2715'} Reject
                              </button>
                            )}
                            <button className="btn btn-ghost btn-sm"
                              onClick={() => { setShowClaimHistory(u); }}>
                              {'\u{1F4CB}'} Details
                            </button>
                            <button className="btn btn-danger btn-sm"
                              onClick={() => { setActionUser(u); setActionReason(''); }}>
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
          </div>
        )}

        {actionUser && (
          <div className="modal-overlay" onClick={() => setActionUser(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Permanently Delete User</h2>
                <button onClick={() => { setActionUser(null); setActionMsg(''); setActionMessage(''); }} className="modal-close">{'\u2715'}</button>
              </div>
              <div className="modal-body">
                <div className="detail-grid">
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
                    <div className="flex gap-xs">
                      <span className="badge badge-danger badge-xs">Inactive</span>
                      <span className={`badge ${actionUser.inactiveReason === 'Own Topup Completed' ? 'badge-pending' : 'badge-danger'} badge-xs`}>
                        {actionUser.inactiveReason}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="alert alert-error">
                  <strong>⚠️ Permanent Data Loss Warning:</strong><br />
                  This will permanently delete this user and ALL associated data including topups, transactions, payments, screenshots, messages, chat history, and notifications. This action CANNOT be undone!
                </div>

                <div className="field">
                  <label>Reason for deletion</label>
                  <textarea
                    className="input"
                    placeholder="Why are you deleting this user?"
                    value={actionReason}
                    onChange={e => setActionReason(e.target.value)}
                    rows={3}
                  />
                </div>

                {actionMsg && (
                  <div className={`alert ${actionMsg.includes('\u2713') ? 'alert-success' : 'alert-error'}`}>
                    {actionMsg}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button className={`btn btn-danger${actionLoading ? ' btn-loading' : ''}`}
                  onClick={() => handleDeleteInactive(actionUser.id, actionReason)}
                  disabled={actionLoading}>
                  {actionLoading ? 'Deleting...' : '\u2715 Confirm Delete'}
                </button>
                <button className="btn btn-ghost" onClick={() => { setActionUser(null); setActionMsg(''); setActionMessage(''); }} disabled={actionLoading}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {approveSponsorUser && (
          <div className="modal-overlay" onClick={() => setApproveSponsorUser(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Approve Sponsor Claim</h2>
                <button onClick={() => { setApproveSponsorUser(null); setActionMsg(''); }} className="modal-close">{'\u2715'}</button>
              </div>
              <div className="modal-body">
                <div className="detail-grid">
                  <div className="detail-row">
                    <span className="detail-label">Sponsor Name</span>
                    <span className="detail-value">{approveSponsorUser.name}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Sponsor ID</span>
                    <span className="detail-value"><code>{approveSponsorUser.id ? approveSponsorUser.id.substring(0, 12) + '...' : '—'}</code></span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Referral Code</span>
                    <span className="detail-value"><code>{approveSponsorUser.referral_code || '—'}</code></span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Inactive Reason</span>
                    <span className="detail-value"><span className="badge badge-pending badge-xs">{approveSponsorUser.inactiveReason}</span></span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Current Status</span>
                    <span className="detail-value"><span className="badge badge-danger badge-xs">Inactive</span></span>
                  </div>
                </div>

                {approveSponsorUser.claimInfo && (
                  <div className="card-dim mt-lg">
                    <h3 className="card-title mb-md">Claim Details</h3>
                    <div className="detail-grid">
                      <div className="detail-row">
                        <span className="detail-label">Claim Amount</span>
                        <span className="detail-value font-bold" style={{ color: 'var(--success)' }}>₹{Number(approveSponsorUser.claimInfo.claim_amount || 0).toFixed(2)}</span>
                      </div>
                      <div className="detail-row">
                        <span className="detail-label">Claim Date</span>
                        <span className="detail-value">{approveSponsorUser.claimInfo.claim_date ? new Date(approveSponsorUser.claimInfo.claim_date).toLocaleString() : '—'}</span>
                      </div>
                      <div className="detail-row">
                        <span className="detail-label">Referred Users Count</span>
                        <span className="detail-value">{approveSponsorUser.claimInfo.items_count || 0}</span>
                      </div>
                    </div>

                    {(approveSponsorUser.claimInfo.items || []).length > 0 && (
                      <div className="mt-md">
                        <h4 className="text-sm text-muted font-semibold mb-sm">Referred Users Generating Eligibility</h4>
                        <div className="table-wrap" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                          <table className="text-xs">
                            <thead>
                              <tr>
                                <th>User Name</th>
                                <th>Top-up Amount</th>
                                <th>Top-up Date</th>
                                <th>Transaction ID</th>
                                <th>Payment Method</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {approveSponsorUser.claimInfo.items.map((item, idx) => (
                                <tr key={item.income_id || idx}>
                                  <td>{item.referred_user_name || '—'}</td>
                                  <td className="font-bold">₹{Number(item.topup_amount || 0).toFixed(2)}</td>
                                  <td className="text-xs">{item.topup_date ? new Date(item.topup_date).toLocaleDateString() : '—'}</td>
                                  <td className="font-mono text-xs">{item.transaction_id || '—'}</td>
                                  <td>{item.payment_method || 'UPI'}</td>
                                  <td><span className="badge badge-success badge-xs">{item.payment_status || 'approved'}</span></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="alert alert-warning text-sm">
                  <strong>Approve:</strong> Credits <strong>₹{Number(approveSponsorUser.claimInfo?.claim_amount || 0).toFixed(2)}</strong> to sponsor's wallet and reactivates account. Referral history and wallet history remain unchanged.
                </div>

                {actionMsg && (
                  <div className={`alert ${actionMsg.includes('\u2713') ? 'alert-success' : 'alert-error'}`}>
                    {actionMsg}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button className={`btn btn-primary${approveSponsorLoading ? ' btn-loading' : ''}`}
                  onClick={() => handleApproveSponsor(approveSponsorUser.id)}
                  disabled={approveSponsorLoading}>
                  {approveSponsorLoading ? 'Approving...' : '\u2713 Approve & Credit ₹' + Number(approveSponsorUser.claimInfo?.claim_amount || 0).toFixed(2)}
                </button>
                <button className="btn btn-ghost" onClick={() => { setApproveSponsorUser(null); setActionMsg(''); }} disabled={approveSponsorLoading}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {rejectSponsorUser && (
          <div className="modal-overlay" onClick={() => setRejectSponsorUser(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Reject Sponsor Claim</h2>
                <button onClick={() => { setRejectSponsorUser(null); setRejectSponsorReason(''); setActionMsg(''); }} className="modal-close">{'\u2715'}</button>
              </div>
              <div className="modal-body">
                <div className="detail-grid">
                  <div className="detail-row">
                    <span className="detail-label">Sponsor Name</span>
                    <span className="detail-value">{rejectSponsorUser.name}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Inactive Reason</span>
                    <span className="detail-value"><span className="badge badge-pending badge-xs">{rejectSponsorUser.inactiveReason}</span></span>
                  </div>
                </div>

                <div className="field mt-lg">
                  <label>Rejection Reason</label>
                  <textarea
                    className="input"
                    placeholder="Why is this claim being rejected?"
                    value={rejectSponsorReason}
                    onChange={e => setRejectSponsorReason(e.target.value)}
                    rows={3}
                  />
                </div>

                <div className="alert alert-warning text-sm">
                  <strong>Note:</strong> Rejecting will reactivate the sponsor account without crediting the bonus. The income records will be restored to eligible status for future claims.
                </div>

                {actionMsg && (
                  <div className={`alert ${actionMsg.includes('\u2713') ? 'alert-success' : 'alert-error'}`}>
                    {actionMsg}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button className={`btn btn-danger${rejectSponsorLoading ? ' btn-loading' : ''}`}
                  onClick={() => handleRejectSponsor(rejectSponsorUser.id)}
                  disabled={rejectSponsorLoading}>
                  {rejectSponsorLoading ? 'Rejecting...' : '\u2715 Reject Claim'}
                </button>
                <button className="btn btn-ghost" onClick={() => { setRejectSponsorUser(null); setRejectSponsorReason(''); setActionMsg(''); }} disabled={rejectSponsorLoading}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {showClaimHistory && (
          <div className="modal-overlay" onClick={() => setShowClaimHistory(null)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '800px' }}>
              <div className="modal-header">
                <h2>Claim History — {showClaimHistory.name}</h2>
                <button onClick={() => setShowClaimHistory(null)} className="modal-close">{'\u2715'}</button>
              </div>
              <div className="modal-body">
                <div className="detail-grid">
                  <div className="detail-row">
                    <span className="detail-label">Sponsor Name</span>
                    <span className="detail-value">{showClaimHistory.name}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Sponsor ID</span>
                    <span className="detail-value"><code>{showClaimHistory.id ? showClaimHistory.id.substring(0, 12) + '...' : '—'}</code></span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Referral Code</span>
                    <span className="detail-value"><code>{showClaimHistory.referral_code || '—'}</code></span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Current Status</span>
                    <span className="detail-value"><span className="badge badge-danger badge-xs">Inactive</span></span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Inactive Reason</span>
                    <span className="detail-value"><span className="badge badge-pending badge-xs">{showClaimHistory.inactiveReason}</span></span>
                  </div>
                </div>
                {showClaimHistory.claimInfo && (
                  <div className="mt-lg">
                    <h3 className="card-title mb-md">Claim Details</h3>
                    <div className="detail-grid">
                      <div className="detail-row">
                        <span className="detail-label">Total Claim Amount</span>
                        <span className="detail-value font-bold" style={{ color: 'var(--success)' }}>₹{Number(showClaimHistory.claimInfo.claim_amount || 0).toFixed(2)}</span>
                      </div>
                      <div className="detail-row">
                        <span className="detail-label">Claim Date</span>
                        <span className="detail-value">{showClaimHistory.claimInfo.claim_date ? new Date(showClaimHistory.claimInfo.claim_date).toLocaleString() : '—'}</span>
                      </div>
                      <div className="detail-row">
                        <span className="detail-label">Referred Users</span>
                        <span className="detail-value">{showClaimHistory.claimInfo.items_count || 0}</span>
                      </div>
                    </div>
                    {(showClaimHistory.claimInfo.items || []).length > 0 && (
                      <div className="mt-md" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                        <h4 className="text-sm text-muted font-semibold mb-sm">Referred Users & Top-up Details</h4>
                        <div className="table-wrap"><table className="text-xs w-full">
                          <thead>
                            <tr>
                              <th>User Name</th>
                              <th>User ID</th>
                              <th>Top-up Amount</th>
                              <th>Top-up Date</th>
                              <th>Transaction ID</th>
                              <th>Payment Method</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {showClaimHistory.claimInfo.items.map((item, idx) => (
                              <tr key={item.income_id || idx}>
                                <td>{item.referred_user_name || '—'}</td>
                                <td className="font-mono text-xs">{item.referred_user_id ? item.referred_user_id.substring(0, 8) + '...' : '—'}</td>
                                <td className="font-bold">₹{Number(item.topup_amount || 0).toFixed(2)}</td>
                                <td className="text-xs">{item.topup_date ? new Date(item.topup_date).toLocaleDateString() : '—'}</td>
                                <td className="font-mono text-xs">{item.transaction_id || '—'}</td>
                                <td>{item.payment_method || 'UPI'}</td>
                                <td><span className="badge badge-success badge-xs">{item.payment_status || 'approved'}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    )}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn btn-ghost" onClick={() => setShowClaimHistory(null)}>Close</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
