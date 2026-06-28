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
  const [activities, setActivities] = useState([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [healthData, setHealthData] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [actionUser, setActionUser] = useState(null);
  const [actionReason, setActionReason] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState('');
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

  const REGISTRATION_FEE = Number(import.meta.env.VITE_PAYMENT_AMOUNT) || 120;
  const todayStr = new Date().toISOString().split('T')[0];
  const stats = useMemo(() => {
    const approvedUsers = users.filter(u => u.payment_status === 'approved' || u.payment_status === 'success' || u.membershipStatus === 'active');
    const regRevenue = approvedUsers.length * REGISTRATION_FEE;
    const topupRevenue = topups.filter(t => t.status === 'approved').reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
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
      }
    } catch (err) {
      console.error('[ADMIN DASHBOARD] Failed to fetch data:', err);
    }
  }, []);

  const fetchActivities = useCallback(async () => {
    setActivitiesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/getRecentActivity`, {
        method: 'POST', headers: authHeaders(), body: '{}',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      if (result.success) setActivities(result.activities || []);
    } catch (err) {
      console.error('[ADMIN DASHBOARD] Failed to fetch activities:', err);
    } finally {
      setActivitiesLoading(false);
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
    fetchActivities();
    fetchHealth();

    const interval = setInterval(fetchData, 30000);

    return () => clearInterval(interval);
  }, [navigate, fetchData, fetchActivities, fetchHealth]);

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_FUNCTIONS_URL || '';
    const eventSource = new EventSource(`${baseUrl}/sse/dashboard`);

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
              <span className={`badge ${sseConnected ? 'badge-paid' : 'badge-rejected'} badge-xs`} style={{ marginLeft: '0.5rem', fontSize: '0.7rem' }}>
                {sseConnected ? '\u25CF Live' : '\u25CB Disconnected'}
              </span>
            </div>
          </div>

          <div className="stats-grid-modern">
            <div className="stat-card-modern accent">
              <div className="stat-bg-icon">{'\u{1F465}'}</div>
              <div className="stat-value">{stats.totalUsers}</div>
              <div className="stat-label">Total Users</div>
              <div className="stat-sub">{'\u{1F4C8}'} Registered</div>
            </div>
            <div className={`stat-card-modern ${sseCounts.pending_payments > 0 ? 'warning' : 'success'}`}>
              <div className="stat-bg-icon">{'\u{1F4E8}'}</div>
              <div className="stat-value">{sseConnected ? sseCounts.pending_payments : stats.pendingTopups}</div>
              <div className="stat-label">{sseConnected ? 'Pending Payments (Live)' : 'Pending Payments'}</div>
              <div className="stat-sub">{sseConnected ? '\u25CF Real-time SSE' : '\u{1F504}'} Awaiting processing</div>
            </div>
            <div className="stat-card-modern success">
              <div className="stat-bg-icon">{'\u2705'}</div>
              <div className="stat-value">{stats.successPayments}</div>
              <div className="stat-label">Paid Users</div>
              <div className="stat-sub">{'\u{1F4B0}'} Successfully registered</div>
            </div>
            <div className="stat-card-modern accent">
              <div className="stat-bg-icon">{'\u{1F4B8}'}</div>
              <div className="stat-value">₹{stats.totalTopupAmount.toFixed(2)}</div>
              <div className="stat-label">Total Topup Amount</div>
              <div className="stat-sub">{'\u{1F4C8}'} All time</div>
            </div>
            <div className="stat-card-modern success">
              <div className="stat-bg-icon">{'\u{1F4B5}'}</div>
              <div className="stat-value">₹{stats.totalRevenue.toFixed(2)}</div>
              <div className="stat-label">Total Revenue</div>
              <div className="stat-sub">{'\u{1F4C8}'} Reg + Topups</div>
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
            <div className="stat-card-modern success">
              <div className="stat-bg-icon">{'\u{1F465}'}</div>
              <div className="stat-value">{stats.activeUsers}</div>
              <div className="stat-label">Active Users</div>
              <div className="stat-sub">{'\u2705'} Account active</div>
            </div>
            <div className="stat-card-modern warning">
              <div className="stat-bg-icon">{'\u23F3'}</div>
              <div className="stat-value">{stats.inactiveUsers}</div>
              <div className="stat-label">Inactive Users</div>
              <div className="stat-sub">{'\u{1F504}'} Requires action</div>
            </div>
            <div className="stat-card-modern danger">
              <div className="stat-bg-icon">{'\u{1F6AB}'}</div>
              <div className="stat-value">{stats.suspendedUsers}</div>
              <div className="stat-label">Suspended</div>
              <div className="stat-sub">{'\u26A0\uFE0F'} Requires review</div>
            </div>
            <div className="stat-card-modern" style={{ '--accent-soft': 'transparent' }}>
              <div className="stat-bg-icon">{'\u{1F464}'}</div>
              <div className="stat-value">{stats.membershipActive}</div>
              <div className="stat-label">Membership Active</div>
              <div className="stat-sub">{'\u{1F4B0}'} Paid & active</div>
            </div>
            <div className="stat-card-modern warning">
              <div className="stat-bg-icon">{'\u{1F504}'}</div>
              <div className="stat-value">{stats.sponsorsAwaitingRenewal}</div>
              <div className="stat-label">Sponsor Renewal</div>
              <div className="stat-sub">{'\u{1F3C6}'} Awaiting renewal</div>
            </div>
            <div className="stat-card-modern" style={{ '--accent-soft': 'transparent' }}>
              <div className="stat-bg-icon">{'\u{1F50D}'}</div>
              <div className="stat-value">{stats.usersNeedingReview}</div>
              <div className="stat-label">Needs Review</div>
              <div className="stat-sub">{'\u{1F4CB}'} Pending admin review</div>
            </div>
          </div>

          {sseTime && (
            <div style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--muted, #64748b)', marginBottom: '0.5rem' }}>
              {sseConnected ? '\u25CF' : '\u25CB'} Last updated: {new Date(sseTime).toLocaleString('en-IN')}
            </div>
          )}

          <div className="stats-grid-modern" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
            <div className="stat-card-modern info" style={{ '--accent-soft': 'rgba(59, 130, 246, 0.06)' }}>
              <div className="stat-bg-icon">{'\u{1F4C5}'}</div>
              <div className="stat-value">{stats.todayRegistrations}</div>
              <div className="stat-label">Today's Registrations</div>
              <div className="stat-sub">{'\u{1F4C8}'} New users</div>
            </div>
            <div className="stat-card-modern success">
              <div className="stat-bg-icon">{'\u{1F4B3}'}</div>
              <div className="stat-value">{stats.todayPayments}</div>
              <div className="stat-label">Today's Payments</div>
              <div className="stat-sub">{'\u2705'} Approved</div>
            </div>
            <div className="stat-card-modern accent">
              <div className="stat-bg-icon">{'\u{1F4B0}'}</div>
              <div className="stat-value">₹{stats.todayRevenue.toFixed(2)}</div>
              <div className="stat-label">Today's Revenue</div>
              <div className="stat-sub">{'\u{1F4C8}'} Collected</div>
            </div>
            <div className="stat-card-modern warning">
              <div className="stat-bg-icon">{'\u{1F517}'}</div>
              <div className="stat-value">{stats.todayReferrals}</div>
              <div className="stat-label">Today's Referrals</div>
              <div className="stat-sub">{'\u{1F4C8}'} Generated</div>
            </div>
            <div className="stat-card-modern" style={{ '--accent-soft': 'rgba(139, 92, 246, 0.06)' }}>
              <div className="stat-bg-icon">{'\u{1F4E4}'}</div>
              <div className="stat-value">{stats.todayTopups}</div>
              <div className="stat-label">Today's Topups</div>
              <div className="stat-sub">{'\u{1F504}'} Submitted</div>
            </div>
          </div>

          <div className="card-modern card-section">
            <div className="card-modern-header">
              <h2 className="card-modern-title">{'\u{1F4CA}'} Priority Overview</h2>
            </div>
            <div className="priority-grid">
              <Link to="/fb-admin/topups" className="priority-card priority-border-accent" style={{ textDecoration: 'none' }}>
                <div className="card-icon">{'\u{1F4E4}'}</div>
                <div className="card-value" style={{ color: 'var(--accent)' }}>{stats.pendingTopups}</div>
                <div className="card-label">Pending Topups</div>
                <span className="priority-link">View {'\u2192'}</span>
              </Link>
              <Link to="/fb-admin/payments?status=approved" className="priority-card priority-border-success" style={{ textDecoration: 'none' }}>
                <div className="card-icon">{'\u{1F4B3}'}</div>
                <div className="card-value" style={{ color: 'var(--success)' }}>{stats.approvedPayments}</div>
                <div className="card-label">Approved Payments</div>
              </Link>
              <Link to="/fb-admin/topups?status=approved" className="priority-card priority-border-success" style={{ textDecoration: 'none' }}>
                <div className="card-icon">{'\u{1F4E4}'}</div>
                <div className="card-value" style={{ color: 'var(--success)' }}>{stats.approvedTopups}</div>
                <div className="card-label">Approved Top-Ups</div>
                <span className="priority-link">View {'\u2192'}</span>
              </Link>
            </div>
          </div>

          <div className="card-modern card-section">
            <div className="card-modern-header">
              <h2 className="card-modern-title">{'\u{1F4CB}'} Recent Activity</h2>
              <button className="btn-modern btn-modern-ghost btn-modern-xs" onClick={fetchActivities} disabled={activitiesLoading}>
                {activitiesLoading ? '...' : '\u{1F504}'}
              </button>
            </div>
            <div style={{ padding: '0.75rem 1rem' }}>
              {activities.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '1.5rem', color: '#9ca3af', fontSize: '0.85rem' }}>
                  {activitiesLoading ? 'Loading...' : 'No recent activity'}
                </div>
              ) : (
                <div className="timeline">
                  {activities.slice(0, 20).map(a => {
                    const actionLabel = a.action
                      .replace(/_/g, ' ')
                      .replace(/\b\w/g, c => c.toUpperCase());
                    const isApprove = a.action.includes('approve') || a.action.includes('credit');
                    const isReject = a.action.includes('reject') || a.action.includes('delete') || a.action.includes('fail');
                    const isRestore = a.action.includes('restore');
                    const isReview = a.action.includes('manual') || a.action.includes('review');
                    const cls = isApprove ? 'timeline-success' : isReject ? 'timeline-danger' : isRestore ? 'timeline-warning' : 'timeline-info';
                    return (
                      <div key={a.id} className={`timeline-item ${cls}`}>
                        <div className="timeline-time">{a.createdAt ? new Date(a.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</div>
                        <div className="timeline-action">{actionLabel}</div>
                        <div className="timeline-detail">
                          {a.adminId && <>by <strong>{a.adminId}</strong></>}
                          {a.targetType && <> on {a.targetType}{a.targetId ? ' #' + (typeof a.targetId === 'string' ? a.targetId.substring(0, 12) : a.targetId) : ''}</>}
                          {a.details?.reason && <> — {a.details.reason}</>}
                          {a.details?.amount && <> — ₹{a.details.amount}</>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="stats-grid-modern" style={{ gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="card-modern card-section" style={{ margin: 0 }}>
              <div className="card-modern-header">
                <h2 className="card-modern-title">{'\u26A1'} Quick Actions</h2>
              </div>
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

            <div className="card-modern card-section" style={{ margin: 0 }}>
              <div className="card-modern-header">
                <h2 className="card-modern-title">{'\u{1F4CA}'} System Health</h2>
                <button className="btn-modern btn-modern-ghost btn-modern-xs" onClick={fetchHealth} disabled={healthLoading}>
                  {healthLoading ? '...' : '\u{1F504}'}
                </button>
              </div>
              <div>
                {healthData ? (
                  <>
                    <div className="health-grid" style={{ marginBottom: '0.75rem' }}>
                      {healthData.health && Object.entries(healthData.health).slice(0, 6).map(([key, val]) => (
                        <div key={key} className="health-item">
                          <span className={`health-dot ${val?.status === 'ok' ? 'online' : val?.status === 'degraded' ? 'degraded' : 'offline'}`} />
                          <span className="health-label">{key.charAt(0).toUpperCase() + key.slice(1)}</span>
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
                            <span className={`health-metric-value ${(healthData.metrics.auth?.failure_rate || 0) > 10 ? 'danger' : 'success'}`}>
                              {healthData.metrics.auth?.failure_rate || 0}%
                            </span>
                          </div>
                          <div className="health-metric">
                            <span className="health-metric-label">Payment Approval Rate</span>
                            <span className={`health-metric-value ${(healthData.metrics.payments?.approval_rate || 0) > 50 ? 'success' : 'warning'}`}>
                              {healthData.metrics.payments?.approval_rate || 0}%
                            </span>
                          </div>
                          <div className="health-metric">
                            <span className="health-metric-label">OCR Success Rate</span>
                            <span className={`health-metric-value ${(healthData.metrics.ocr?.success_rate || 0) > 80 ? 'success' : (healthData.metrics.ocr?.success_rate || 0) > 50 ? 'warning' : 'danger'}`}>
                              {healthData.metrics.ocr?.success_rate || 0}%
                            </span>
                          </div>
                          <div className="health-metric">
                            <span className="health-metric-label">DB Errors</span>
                            <span className={`health-metric-value ${(healthData.metrics.database?.supabase_errors || 0) > 0 ? 'danger' : 'success'}`}>
                              {healthData.metrics.database?.supabase_errors || 0}
                            </span>
                          </div>
                          <div className="health-metric">
                            <span className="health-metric-label">Queue Pending</span>
                            <span className={`health-metric-value ${(healthData.queue?.pending || 0) > 0 ? 'warning' : 'success'}`}>
                              {healthData.queue?.pending || 0}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <div style={{ textAlign: 'center', padding: '1.5rem', color: '#9ca3af', fontSize: '0.85rem' }}>
                    {healthLoading ? 'Loading...' : 'No health data'}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="card-modern card-section">
            <div className="card-modern-header">
              <h2 className="card-modern-title">{'\u{1F4CA}'} Collection Analytics</h2>
            </div>
            <div className="stats-grid-modern">
              <div className="stat-card-modern success">
                <div className="stat-bg-icon">{'\u{1F4B0}'}</div>
                <div className="stat-value">₹{paymentAnalytics.totalCollectionAmount.toFixed(2)}</div>
                <div className="stat-label">Total Collection Amount</div>
                <div className="stat-sub">{'\u2705'} Approved entries</div>
              </div>
              <div className="stat-card-modern accent">
                <div className="stat-bg-icon">{'\u{1F4CB}'}</div>
                <div className="stat-value">{paymentAnalytics.totalApprovedPayments}</div>
                <div className="stat-label">Total Approved Payments</div>
                <div className="stat-sub">{'\u{1F4B3}'} Entries</div>
              </div>
              <div className="stat-card-modern" style={{ '--accent-soft': 'var(--success-soft, rgba(34, 197, 94, 0.1))' }}>
                <div className="stat-bg-icon">{'\u{1F4C5}'}</div>
                <div className="stat-value">₹{paymentAnalytics.todayCollection.toFixed(2)}</div>
                <div className="stat-label">Today's Collection</div>
                <div className="stat-sub">{'\u{1F4C8}'} Daily total</div>
              </div>
              <div className="stat-card-modern warning">
                <div className="stat-bg-icon">{'\u{1F4C6}'}</div>
                <div className="stat-value">₹{paymentAnalytics.monthCollection.toFixed(2)}</div>
                <div className="stat-label">This Month Collection</div>
                <div className="stat-sub">{'\u{1F4C8}'} Monthly total</div>
              </div>
              <div className="stat-card-modern" style={{ '--accent-soft': 'var(--info-soft, rgba(59, 130, 246, 0.1))' }}>
                <div className="stat-bg-icon">{'\u{1F522}'}</div>
                <div className="stat-value">₹{paymentAnalytics.averagePaymentValue.toFixed(2)}</div>
                <div className="stat-label">Average Payment Value</div>
                <div className="stat-sub">{'\u{1F4C8}'} Per entry</div>
              </div>
            </div>

            <div className="stats-grid-modern" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: '1rem' }}>
              <div className="stat-card-modern" style={{ '--accent-soft': 'transparent', border: '1px solid var(--border, #e2e8f0)' }}>
                <div className="stat-value" style={{ fontSize: '1rem' }}>₹{paymentAnalytics.todayCollection.toFixed(2)}</div>
                <div className="stat-label" style={{ fontSize: '0.7rem' }}>Daily Collection</div>
              </div>
              <div className="stat-card-modern" style={{ '--accent-soft': 'transparent', border: '1px solid var(--border, #e2e8f0)' }}>
                <div className="stat-value" style={{ fontSize: '1rem' }}>₹{paymentAnalytics.weekCollection.toFixed(2)}</div>
                <div className="stat-label" style={{ fontSize: '0.7rem' }}>Weekly Collection</div>
              </div>
              <div className="stat-card-modern" style={{ '--accent-soft': 'transparent', border: '1px solid var(--border, #e2e8f0)' }}>
                <div className="stat-value" style={{ fontSize: '1rem' }}>₹{paymentAnalytics.monthCollection.toFixed(2)}</div>
                <div className="stat-label" style={{ fontSize: '0.7rem' }}>Monthly Collection</div>
              </div>
              <div className="stat-card-modern" style={{ '--accent-soft': 'transparent', border: '1px solid var(--border, #e2e8f0)' }}>
                <div className="stat-value" style={{ fontSize: '1rem' }}>₹{paymentAnalytics.yearCollection.toFixed(2)}</div>
                <div className="stat-label" style={{ fontSize: '0.7rem' }}>Yearly Collection</div>
              </div>
            </div>

            <div style={{ marginTop: '1.5rem' }}>
              <div className="card-modern-header" style={{ padding: '0 0 0.75rem 0', borderBottom: '1px solid var(--border, #e2e8f0)', marginBottom: '0.75rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {'\u{1F4CB}'} Payment Collection Records
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted, #64748b)', fontWeight: 400 }}>
                    ({filteredEntries.length} entries)
                  </span>
                </h3>
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                  {['Approved Only', 'Today', 'This Week', 'This Month'].map(f => (
                    <button key={f}
                      className={`btn-modern btn-modern-xs ${analyticsFilter === f ? 'btn-modern-primary' : 'btn-modern-ghost'}`}
                      onClick={() => setAnalyticsFilter(f)}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <div className="table-wrap-modern table-section">
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
                      <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted, #64748b)', padding: '2rem' }}>No approved entries found</td></tr>
                    ) : filteredEntries.slice(0, 100).map((e, i) => (
                      <tr key={e.transactionId + '-' + e.userId + '-' + i}>
                        <td data-label="User ID"><code style={{ fontSize: '0.75rem' }}>{e.userId ? e.userId.substring(0, 12) + '...' : '—'}</code></td>
                        <td data-label="User Name" className="font-semibold">{e.userName || '—'}</td>
                        <td data-label="Transaction ID" style={{ fontSize: '0.8rem' }}>{e.transactionId}</td>
                        <td data-label="Amount" className="font-bold">₹{e.amount.toFixed(2)}</td>
                        <td data-label="Payment Date" style={{ fontSize: '0.8rem' }}>
                          {e.paymentDate ? new Date(e.paymentDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                        </td>
                        <td data-label="Approval Status"><span className="badge badge-paid badge-xs">Approved</span></td>
                      </tr>
                    ))}
                    {filteredEntries.length > 100 && (
                      <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted, #64748b)', padding: '0.5rem', fontSize: '0.8rem' }}>
                        Showing 100 of {filteredEntries.length} entries
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="stats-grid-modern" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: '1rem', gap: '0.5rem' }}>
              <div style={{ textAlign: 'center', padding: '0.5rem', background: 'var(--success-soft, rgba(34, 197, 94, 0.08))', borderRadius: '0.5rem' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--muted, #64748b)', marginBottom: '0.15rem' }}>Payments</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--success)' }}>{paymentAnalytics.approvedPaymentsCount}</div>
              </div>
              <div style={{ textAlign: 'center', padding: '0.5rem', background: 'var(--accent-soft, rgba(139, 92, 246, 0.08))', borderRadius: '0.5rem' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--muted, #64748b)', marginBottom: '0.15rem' }}>Topups</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent)' }}>{paymentAnalytics.approvedTopupsCount}</div>
              </div>
              <div style={{ textAlign: 'center', padding: '0.5rem', background: 'var(--info-soft, rgba(59, 130, 246, 0.08))', borderRadius: '0.5rem' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--muted, #64748b)', marginBottom: '0.15rem' }}>Collection Growth</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--info, #3b82f6)' }}>
                  {paymentAnalytics.totalCollectionAmount > 0
                    ? ((paymentAnalytics.monthCollection / paymentAnalytics.totalCollectionAmount) * 100).toFixed(1) + '%'
                    : '0%'}
                </div>
              </div>
              <div style={{ textAlign: 'center', padding: '0.5rem', background: 'rgba(234, 179, 8, 0.08)', borderRadius: '0.5rem' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--muted, #64748b)', marginBottom: '0.15rem' }}>Total Users Paid</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#eab308' }}>{paymentAnalytics.approvedPaymentsCount}</div>
              </div>
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
                          <span className="muted text-xs">Auto-managed</span>
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
                          <button className="btn-modern btn-modern-danger btn-modern-xs"
                            onClick={() => { setActionUser(u); setActionReason(''); }}>
                            {'\u2715'} Delete
                          </button>
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
                  <h2>Permanently Delete User</h2>
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

                  <div className="alert alert-error" style={{ margin: '1rem 0' }}>
                    <strong>⚠️ Permanent Data Loss Warning:</strong><br />
                    This will permanently delete this user and ALL associated data including topups, transactions, payments, screenshots, messages, chat history, and notifications. This action CANNOT be undone!
                  </div>

                  <div className="field modal-field-mb">
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
                    <div className={`alert ${actionMsg.includes('\u2713') ? 'alert-success' : 'alert-error'} modal-alert-mb`}>
                      {actionMsg}
                    </div>
                  )}
                </div>
                <div className="modal-modern-footer">
                  <button className={`btn-modern btn-modern-danger${actionLoading ? ' btn-loading' : ''}`}
                    onClick={() => handleDeleteInactive(actionUser.id, actionReason)}
                    disabled={actionLoading}>
                    {actionLoading ? 'Deleting...' : '\u2715 Confirm Delete'}
                  </button>
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