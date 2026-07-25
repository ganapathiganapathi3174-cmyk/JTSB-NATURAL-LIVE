import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminSidebar from '../components/AdminSidebar.jsx';

const ADMIN_KEY = 'fb_admin_token';
const API_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';

function authHeaders() {
  const t = localStorage.getItem(ADMIN_KEY);
  return t ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t } : { 'Content-Type': 'application/json' };
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(10px)'; el.style.transition = 'all 0.3s'; setTimeout(() => el.remove(), 300); }, 3000);
}

function Badge({ type, children }) {
  const colors = {
    success: { bg: 'rgba(16,185,129,0.12)', color: '#059669' },
    warning: { bg: 'rgba(245,158,11,0.12)', color: '#d97706' },
    danger: { bg: { color: '#dc2626' }, color: '#dc2626' },
    info: { bg: 'rgba(79,70,229,0.12)', color: '#4F46E5' },
    muted: { bg: 'rgba(107,114,128,0.12)', color: '#6B7280' },
  };
  const c = colors[type] || colors.info;
  return <span style={{ padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600, background: c.bg, color: c.color, whiteSpace: 'nowrap' }}>{children}</span>;
}

function SectionHeader({ title, count, icon }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
      <h3 style={{ fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {icon} {title}
      </h3>
      {count !== undefined && <Badge type="info">{count}</Badge>}
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={{ background: 'var(--bg-alt, #fff)', borderRadius: 'var(--radius-lg, 12px)', padding: '1rem', border: '1px solid var(--border, #e5e7eb)', textAlign: 'center' }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: color || 'var(--text, #1a1d26)' }}>{value}</div>
      <div style={{ fontSize: '0.8rem', color: 'var(--muted, #6B7280)', marginTop: '0.25rem' }}>{label}</div>
    </div>
  );
}

export default function FirebaseAdminCyclesPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('referral');
  const [reactivating, setReactivating] = useState(null);
  const [reactivateReason, setReactivateReason] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(API_BASE + '/getCycleDashboard', { headers: authHeaders() });
      if (res.status === 401) { navigate('/fb-admin'); return; }
      if (!res.ok) throw new Error('Failed to load cycle data');
      const json = await res.json();
      setData(json);
      setError('');
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [navigate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const id = setInterval(fetchData, 15000);
    return () => clearInterval(id);
  }, [fetchData]);

  async function handleReactivate(userId) {
    if (!window.confirm('Reactivate this user? They will start a new cycle.')) return;
    setReactivating(userId);
    try {
      const res = await fetch(API_BASE + '/reactivateUser', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ userId, reason: reactivateReason || 'Admin reactivation' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      toast('User reactivated successfully');
      setReactivateReason('');
      fetchData();
    } catch (e) { toast(e.message, 'error'); }
    finally { setReactivating(null); }
  }

  if (loading) return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <AdminSidebar />
      <main style={{ flex: 1, padding: '2rem' }}>
        <div className="loading-spinner loading-spinner-lg" />
      </main>
    </div>
  );

  const { referralMonitor = [], sponsorTopupPending = [], inactiveUsers = [], history = [], summary = {} } = data || {};

  const tabs = [
    { id: 'referral', label: 'Referral Monitor', count: referralMonitor.length },
    { id: 'sponsor', label: 'Sponsor Topup Pending', count: sponsorTopupPending.length },
    { id: 'inactive', label: 'Inactive Users', count: inactiveUsers.length },
    { id: 'history', label: 'Cycle History', count: history.length },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <AdminSidebar />
      <main style={{ flex: 1, padding: '1.5rem', maxWidth: '1200px', overflowX: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Cycle Management</h1>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted, #6B7280)' }}>Referral cycles, topup cycles, and user reactivation</p>
          </div>
          <button onClick={fetchData} className="btn btn-ghost btn-sm" style={{ border: '1px solid var(--border, #e5e7eb)', borderRadius: '8px', padding: '0.4rem 0.8rem' }}>Refresh</button>
        </div>

        {error && <div className="alert-error mb-md">{error}</div>}

        {/* Summary Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <StatCard label="Active Users" value={summary.totalActive || 0} color="#059669" />
          <StatCard label="Inactive Users" value={summary.totalInactive || 0} color="#d97706" />
          <StatCard label="Referral Cycles Done" value={summary.totalReferralCyclesCompleted || 0} color="#4F46E5" />
          <StatCard label="Topup Cycles Done" value={summary.totalTopupCyclesCompleted || 0} color="#7C3AED" />
          <StatCard label="Sponsor Pending" value={sponsorTopupPending.length} color="#F59E0B" />
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', overflowX: 'auto', paddingBottom: '0.25rem' }}>
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              style={{ padding: '0.5rem 1rem', borderRadius: '8px', border: activeTab === tab.id ? '2px solid #4F46E5' : '1px solid var(--border, #e5e7eb)', background: activeTab === tab.id ? '#EEF2FF' : 'var(--bg-alt, #fff)', color: activeTab === tab.id ? '#4F46E5' : 'var(--text, #1a1d26)', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s' }}>
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>

        {/* Referral Monitor Tab */}
        {activeTab === 'referral' && (
          <div style={{ background: 'var(--bg-alt, #fff)', borderRadius: 'var(--radius-lg, 12px)', border: '1px solid var(--border, #e5e7eb)', overflow: 'hidden' }}>
            <SectionHeader title="Referral Monitor" count={referralMonitor.length}
              icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>} />
            {referralMonitor.length === 0 ? (
              <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted, #6B7280)' }}>No active referral cycles</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg, #F8F9FC)', borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600 }}>Sponsor</th>
                      <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>Cycle #</th>
                      <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>Referral Count</th>
                      <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>Remaining Slots</th>
                      <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>Status</th>
                      <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>Total Referrals</th>
                      <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>Referral Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {referralMonitor.map(u => (
                      <tr key={u.id} style={{ borderBottom: '1px solid var(--border-light, #f3f4f6)' }}>
                        <td style={{ padding: '0.6rem 0.75rem' }}>
                          <div style={{ fontWeight: 600 }}>{u.name || 'Unknown'}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--muted, #6B7280)' }}>{u.email}</div>
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                          <Badge type="info">#{u.referral_cycle_number}</Badge>
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                          <span style={{ fontWeight: 700, color: u.current_cycle_referral_count >= 2 ? '#059669' : '#4F46E5' }}>
                            {u.current_cycle_referral_count}/2
                          </span>
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                          <span style={{ color: u.remaining_slots === 0 ? '#dc2626' : '#059669', fontWeight: 600 }}>{u.remaining_slots}</span>
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                          <Badge type={u.referral_active ? 'success' : 'warning'}>{u.referral_active ? 'Active' : 'Limit Reached'}</Badge>
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', fontWeight: 600 }}>{u.total_referrals}</td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                          <Badge type={u.referral_active ? 'success' : 'muted'}>{u.referral_active ? 'Active' : 'Disabled'}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Sponsor Topup Pending Tab */}
        {activeTab === 'sponsor' && (
          <div style={{ background: 'var(--bg-alt, #fff)', borderRadius: 'var(--radius-lg, 12px)', border: '1px solid var(--border, #e5e7eb)', overflow: 'hidden' }}>
            <SectionHeader title="Sponsor Topup Pending" count={sponsorTopupPending.length}
              icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>} />
            {sponsorTopupPending.length === 0 ? (
              <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted, #6B7280)' }}>No pending sponsor topups</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg, #F8F9FC)', borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600 }}>Sponsor</th>
                      <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>Topup Cycle #</th>
                      <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>Own Topup</th>
                      <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sponsorTopupPending.map(u => (
                      <tr key={u.id} style={{ borderBottom: '1px solid var(--border-light, #f3f4f6)' }}>
                        <td style={{ padding: '0.6rem 0.75rem' }}>
                          <div style={{ fontWeight: 600 }}>{u.name || 'Unknown'}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--muted, #6B7280)' }}>{u.email}</div>
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}><Badge type="info">#{u.topup_cycle_number}</Badge></td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                          <Badge type={u.sponsor_topup_completed ? 'success' : 'warning'}>{u.sponsor_topup_completed ? 'Completed' : 'Pending'}</Badge>
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                          <Badge type="warning">Awaiting Topup</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Inactive Users Tab */}
        {activeTab === 'inactive' && (
          <div style={{ background: 'var(--bg-alt, #fff)', borderRadius: 'var(--radius-lg, 12px)', border: '1px solid var(--border, #e5e7eb)', overflow: 'hidden' }}>
            <SectionHeader title="Inactive Users" count={inactiveUsers.length}
              icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>} />
            {inactiveUsers.length === 0 ? (
              <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted, #6B7280)' }}>No inactive users</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg, #F8F9FC)', borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600 }}>User</th>
                      <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>Inactive Reason</th>
                      <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>Inactive Since</th>
                      <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>Referral Cycle</th>
                      <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>Topup Cycle</th>
                      <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inactiveUsers.map(u => (
                      <tr key={u.id} style={{ borderBottom: '1px solid var(--border-light, #f3f4f6)' }}>
                        <td style={{ padding: '0.6rem 0.75rem' }}>
                          <div style={{ fontWeight: 600 }}>{u.name || 'Unknown'}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--muted, #6B7280)' }}>{u.email}</div>
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                          <Badge type={u.inactive_reason === 'REFERRAL_LIMIT_COMPLETED' ? 'warning' : u.inactive_reason === 'TOPUP_CYCLE_COMPLETED' ? 'info' : 'danger'}>
                            {u.inactive_reason === 'REFERRAL_LIMIT_COMPLETED' ? 'Referral Cycle Done' : u.inactive_reason === 'TOPUP_CYCLE_COMPLETED' ? 'Topup Cycle Done' : u.inactive_reason || 'Unknown'}
                          </Badge>
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', fontSize: '0.8rem' }}>
                          {u.inactive_at ? new Date(u.inactive_at).toLocaleDateString() : '—'}
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}><Badge type="info">#{u.referral_cycle_number}</Badge></td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}><Badge type="info">#{u.topup_cycle_number}</Badge></td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                          <button onClick={() => handleReactivate(u.id)} disabled={reactivating === u.id}
                            style={{ padding: '0.35rem 0.75rem', borderRadius: '6px', border: 'none', background: '#059669', color: '#fff', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', opacity: reactivating === u.id ? 0.6 : 1 }}>
                            {reactivating === u.id ? '...' : 'Reactivate'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Cycle History Tab */}
        {activeTab === 'history' && (
          <div style={{ background: 'var(--bg-alt, #fff)', borderRadius: 'var(--radius-lg, 12px)', border: '1px solid var(--border, #e5e7eb)', overflow: 'hidden' }}>
            <SectionHeader title="Cycle History" count={history.length}
              icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>} />
            {history.length === 0 ? (
              <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted, #6B7280)' }}>No cycle history yet</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg, #F8F9FC)', borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600 }}>Date</th>
                      <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>User ID</th>
                      <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>Cycle Type</th>
                      <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>Cycle #</th>
                      <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>Action</th>
                      <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600 }}>Admin</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600 }}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(h => (
                      <tr key={h.id} style={{ borderBottom: '1px solid var(--border-light, #f3f4f6)' }}>
                        <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.8rem' }}>{h.created_at ? new Date(h.created_at).toLocaleString() : '—'}</td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', fontSize: '0.75rem', fontFamily: 'monospace' }}>{h.user_id ? h.user_id.slice(0, 8) + '...' : '—'}</td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                          <Badge type={h.cycle_type === 'referral' ? 'info' : 'success'}>{h.cycle_type}</Badge>
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}><Badge type="info">#{h.cycle_number}</Badge></td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                          <Badge type={h.action === 'completed' ? 'warning' : h.action === 'reactivated' ? 'success' : 'info'}>{h.action}</Badge>
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', fontSize: '0.8rem' }}>{h.admin_id || '—'}</td>
                        <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.75rem', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {h.details ? JSON.stringify(h.details) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
