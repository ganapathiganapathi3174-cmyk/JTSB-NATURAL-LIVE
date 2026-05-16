import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FirebaseUser } from '../db/firebase-db.js';

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
      const tempEmail = `temp_${Date.now()}@temp.com`;
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
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%' }}>
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
  const [showAddUser, setShowAddUser] = useState(false);

  const stats = useMemo(() => ({
    totalUsers: users.length,
    pendingPayments: users.filter(u => u.payment_status === 'pending').length,
    approvedPayments: users.filter(u => u.payment_status === 'approved').length,
    rejectedPayments: users.filter(u => u.payment_status === 'rejected').length,
    totalReferrals: users.reduce((sum, u) => sum + (u.referrals_count || 0), 0),
  }), [users]);

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
    </div>
  );
}