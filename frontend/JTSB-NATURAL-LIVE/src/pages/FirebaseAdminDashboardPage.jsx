import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FirebaseUser, FirebaseTopup } from '../db/firebase-db.js';

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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '450px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2>Add New User</h2>
          <button onClick={onClose} className="btn btn-ghost">✕</button>
        </div>

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
          <button className={`btn btn-primary${loading ? ' btn-loading' : ''}`} type="submit" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Creating...' : 'Create User'}
          </button>
        </form>
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
  }), [users, topups]);

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

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">Admin Dashboard</div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Link className="btn btn-ghost" to="/fb-admin/payments">
            Payments
          </Link>
          <Link className="btn btn-ghost" to="/fb-admin/topups">
            Topups {stats.pendingTopups > 0 && <span className="badge badge-pending" style={{ marginLeft: '0.25rem' }}>{stats.pendingTopups}</span>}
          </Link>
          <Link className="btn btn-ghost" to="/fb-admin/users">
            Users
          </Link>
          <button type="button" className="btn btn-ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </div>

      <div className="grid-stats">
        <div className="stat">
          <div className="value">{stats.totalUsers}</div>
          <div className="label">Total Users</div>
        </div>
        <div className="stat">
          <div className="value">{stats.pendingPayments}</div>
          <div className="label">Pending Payments</div>
        </div>
        <div className="stat">
          <div className="value">{stats.approvedPayments}</div>
          <div className="label">Approved Payments</div>
        </div>
        <div className="stat">
          <div className="value">{stats.totalReferrals}</div>
          <div className="label">Total Referrals</div>
        </div>
        <div className="stat">
          <div className="value" style={{ color: 'var(--warning)' }}>{stats.pendingTopups}</div>
          <div className="label">Pending Topups</div>
        </div>
        <div className="stat">
          <div className="value" style={{ color: 'var(--accent)' }}>₹{stats.totalTopupAmount.toFixed(2)}</div>
          <div className="label">Total Topup Amount</div>
        </div>
        <div className="stat">
          <div className="value" style={{ color: 'var(--warning)' }}>{stats.eligibleSponsors}</div>
          <div className="label">Eligible Sponsors</div>
        </div>
        <div className="stat">
          <div className="value" style={{ color: 'var(--danger)' }}>{stats.awaitingCredit}</div>
          <div className="label">Awaiting Credit</div>
        </div>
        <div className="stat">
          <div className="value" style={{ color: 'var(--success)' }}>₹{stats.totalCredited.toFixed(2)}</div>
          <div className="label">Total Credited</div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Payments by Status</h2>
          <button className="btn btn-primary" onClick={() => setShowAddUser(true)}>
            + Add User
          </button>
        </div>
        <div className="table-wrap" style={{ marginTop: '1rem' }}>
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
                  <Link to="/fb-admin/payments?status=pending" style={{ color: '#ffd200', fontWeight: 'bold' }}>
                    {stats.pendingPayments}
                  </Link>
                </td>
                <td>
                  <Link to="/fb-admin/payments?status=approved" style={{ color: 'var(--success)', fontWeight: 'bold' }}>
                    {stats.approvedPayments}
                  </Link>
                </td>
                <td>
                  <Link to="/fb-admin/payments?status=rejected" style={{ color: 'var(--error)', fontWeight: 'bold' }}>
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
        <div className="card">
          <h2>Sponsor Status & Topup Eligibility ({eligibleSponsorsList.length})</h2>
          <div className="table-wrap" style={{ marginTop: '1rem' }}>
            <table>
              <thead>
                <tr>
                  <th>Sponsor No</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Mobile</th>
                  <th>Normal Refs</th>
                  <th>Topup Refs</th>
                  <th>Total</th>
                  <th>Own Topup</th>
                  <th>Account Status</th>
                  <th>Credit Status</th>
                  <th>Credited Amount</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {eligibleSponsorsList.map(s => (
                  <tr key={s.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem', fontWeight: 600, color: 'var(--primary)' }}>{s.referral_code || '—'}</td>
                    <td style={{ fontWeight: 600 }}>{s.name}</td>
                    <td style={{ fontSize: '0.85rem' }}>{s.email}</td>
                    <td style={{ fontSize: '0.85rem' }}>{s.phone || '—'}</td>
                    <td>{s.referrals_count}</td>
                    <td>{s.topup_referrals_count}</td>
                    <td style={{ fontWeight: 700 }}>{s.referrals_count + s.topup_referrals_count}</td>
                    <td>
                      {s.sponsor_topup_completed ? (
                        <span className="badge badge-paid" style={{ fontSize: '0.7rem' }}>Completed</span>
                      ) : (
                        <span className="badge badge-pending" style={{ fontSize: '0.7rem' }}>Pending</span>
                      )}
                    </td>
                    <td>
                      {s.account_status === 'inactive' ? (
                        <span className="badge badge-rejected" style={{ fontSize: '0.7rem' }}>Inactive</span>
                      ) : (
                        <span className="badge badge-paid" style={{ fontSize: '0.7rem' }}>Active</span>
                      )}
                      {s.sponsor_awaiting_credit && !s.sponsor_credited && (
                        <span className="badge badge-pending" style={{ fontSize: '0.7rem', marginLeft: '0.25rem' }}>Due to Topup</span>
                      )}
                    </td>
                    <td>
                      {s.sponsor_credited ? (
                        <span className="badge badge-paid" style={{ fontSize: '0.7rem' }}>Credited</span>
                      ) : s.sponsor_awaiting_credit ? (
                        <span className="badge badge-pending" style={{ fontSize: '0.7rem' }}>Awaiting Credit</span>
                      ) : (
                        <span className="badge badge-pending" style={{ fontSize: '0.7rem' }}>Not Yet</span>
                      )}
                    </td>
                    <td style={{ fontWeight: 700 }}>
                      {s.sponsor_credited ? (
                        <span style={{ color: 'var(--success)' }}>₹{Number(s.sponsor_credited_amount || 0).toFixed(2)}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {s.account_status === 'inactive' && (
                        <button className="btn btn-primary"
                          onClick={() => handleReactivate(s.id)}
                          disabled={reactivatingId === s.id}
                          style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem', background: 'var(--success)' }}>
                          {reactivatingId === s.id ? 'Activating...' : 'Active User'}
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
        <div className="card">
          <h2>Inactive Users & Reasons ({inactiveUsersList.length})</h2>
          <div className="table-wrap" style={{ marginTop: '1rem' }}>
            <table>
              <thead>
                <tr>
                  <th>Sponsor No</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Reason</th>
                  <th>Normal Refs</th>
                  <th>Topup Refs</th>
                </tr>
              </thead>
              <tbody>
                {inactiveUsersList.map(u => (
                  <tr key={u.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem', fontWeight: 600, color: 'var(--primary)' }}>{u.referral_code || '—'}</td>
                    <td style={{ fontWeight: 600 }}>{u.name}</td>
                    <td style={{ fontSize: '0.85rem' }}>{u.email}</td>
                    <td>
                      <span className="badge badge-rejected" style={{ fontSize: '0.7rem' }}>Inactive</span>
                    </td>
                    <td>
                      <span className={`badge ${u.inactiveReason === 'Own Topup Completed' ? 'badge-pending' : 'badge-rejected'}`} style={{ fontSize: '0.7rem' }}>
                        {u.inactiveReason}
                      </span>
                    </td>
                    <td>{u.referrals_count}</td>
                    <td>{u.topup_referrals_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}