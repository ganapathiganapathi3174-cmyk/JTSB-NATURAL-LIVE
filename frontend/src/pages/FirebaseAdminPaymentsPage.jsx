import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FirebaseUser } from '../db/firebase-db.js';

const ADMIN_KEY = 'fb_admin_token';

function PaymentModal({ user, onClose, onVerify }) {
  const [verifying, setVerifying] = useState(false);
  const [msg, setMsg] = useState('');

  const getImageUrl = (url) => {
    if (!url) return null;
    if (url.includes('alt=media')) return url;
    if (url.startsWith('data:')) return url;
    return url + (url.includes('?') ? '&' : '?') + 'alt=media';
  };

  async function handleVerify(status) {
    setVerifying(true);
    setMsg('');
    try {
      await onVerify(user.id, status);
      setMsg(status === 'approved' ? 'Approved!' : 'Rejected!');
      setTimeout(onClose, 1000);
    } catch (err) {
      setMsg(err.message);
    } finally {
      setVerifying(false);
    }
  }

  if (!user) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2>Verify Payment</h2>
          <button onClick={onClose} className="btn btn-ghost">✕</button>
        </div>
        
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>User</div>
            <div style={{ fontWeight: 'bold' }}>{user.name}</div>
          </div>
          
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Email</div>
            <div>{user.email}</div>
          </div>
          
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Phone</div>
            <div>{user.phone || '—'}</div>
          </div>
          
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>UTR Number</div>
            <div style={{ fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: 'bold' }}>{user.utr_number || '—'}</div>
          </div>
          
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Current Status</div>
            <span className={`badge ${user.payment_status === 'approved' ? 'badge-paid' : user.payment_status === 'rejected' ? 'badge-rejected' : 'badge-pending'}`}>
              {user.payment_status || 'pending'}
            </span>
          </div>
          
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Payment Screenshot</div>
            {user.upi_screenshot_url ? (
              <div>
                <button 
                  type="button"
                  className="btn btn-primary"
                  style={{ marginBottom: '0.5rem' }}
                  onClick={() => window.open(getImageUrl(user.upi_screenshot_url), '_blank')}
                >
                  Open Image
                </button>
                <br />
                <img 
                  src={getImageUrl(user.upi_screenshot_url)} 
                  alt="Payment Screenshot" 
                  style={{ maxWidth: '100%', borderRadius: '8px', marginTop: '0.5rem', border: '1px solid #ccc' }} 
                  onError={(e) => {
                    console.error('Image load error:', e);
                    e.target.style.display = 'none';
                  }}
                />
              </div>
            ) : (
              <div className="muted">No screenshot uploaded</div>
            )}
          </div>
          
          {user.referred_by && (
            <div>
              <div className="muted" style={{ fontSize: '0.85rem' }}>Referred By</div>
              <div>{user.referred_by}</div>
            </div>
          )}
          
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Referral Code</div>
            <div style={{ fontFamily: 'monospace' }}>{user.referral_code}</div>
          </div>
        </div>
        
        <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button 
            className="btn btn-primary" 
            onClick={() => handleVerify('approved')}
            disabled={verifying}
            style={{ background: 'var(--success)' }}
          >
            ✓ Approve
          </button>
          <button 
            className="btn btn-danger" 
            onClick={() => handleVerify('rejected')}
            disabled={verifying}
          >
            ✕ Reject
          </button>
          <button 
            className="btn btn-ghost" 
            onClick={() => handleVerify('pending')}
            disabled={verifying}
          >
            ⏳ Pending
          </button>
        </div>
        
        {msg && (
          <p style={{ marginTop: '1rem', color: msg.includes('!') ? 'var(--success)' : 'var(--error)' }}>
            {msg}
          </p>
        )}
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
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    const token = localStorage.getItem(ADMIN_KEY);
    if (!token) {
      navigate('/fb-admin', { replace: true });
      return;
    }

    const unsubscribe = FirebaseUser.subscribeToPayments((usersWithPayment) => {
      console.log('Admin received users with payment:', usersWithPayment.length);
      setUsers(usersWithPayment);
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [navigate]);

  useEffect(() => {
    const status = searchParams.get('status');
    if (status) setStatusFilter(status);
  }, [searchParams]);

  const handleVerify = async (userId, status) => {
    await FirebaseUser.updatePaymentStatus(userId, status);
  };

  const filteredUsers = useMemo(() => {
    let filtered = users;
    
    if (statusFilter) {
      filtered = filtered.filter(u => u.payment_status === statusFilter);
    }
    
    if (q) {
      filtered = filtered.filter(u => 
        u.name.toLowerCase().includes(q.toLowerCase()) ||
        u.email.toLowerCase().includes(q.toLowerCase()) ||
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

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">Payment Verification</div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Link className="btn btn-ghost" to="/fb-admin/dashboard">
            Dashboard
          </Link>
          <Link className="btn btn-ghost" to="/fb-admin/users">
            Users
          </Link>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2>Search & Filter</h2>
        <div className="copy-row" style={{ marginTop: '0.75rem', gap: '1rem', flexWrap: 'wrap' }}>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search by name, email, or UTR..."
            style={{ maxWidth: '250px' }}
          />
          <select
            value={statusFilter}
            onChange={e => updateStatusFilter(e.target.value)}
            style={{ maxWidth: '180px' }}
          >
            <option value="">All Payments</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      <div className="card">
        <h2>Payments ({filteredUsers.length})</h2>
        <p className="muted" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
          Showing users with payment submissions. Real-time updates enabled.
        </p>
        
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>UTR</th>
                <th>Screenshot</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td style={{ fontFamily: 'monospace' }}>{u.utr_number || '—'}</td>
                  <td>
                    {u.upi_screenshot_url && (
                      <button 
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
                        onClick={() => {
                          const url = u.upi_screenshot_url + (u.upi_screenshot_url.includes('?') ? '&' : '?') + 'alt=media';
                          window.open(url, '_blank');
                        }}
                      >
                        view
                      </button>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${u.payment_status === 'approved' ? 'badge-paid' : u.payment_status === 'rejected' ? 'badge-rejected' : 'badge-pending'}`}>
                      {u.payment_status || 'pending'}
                    </span>
                  </td>
                  <td>
                    <button
                      className="btn btn-primary"
                      onClick={() => setSelectedUser(u)}
                      style={{ padding: '0.35rem 0.65rem', fontSize: '0.85rem' }}
                    >
                      Verify
                    </button>
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No payments found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedUser && (
        <PaymentModal
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onVerify={handleVerify}
        />
      )}
    </div>
  );
}