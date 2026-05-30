import { useEffect, useState, useMemo, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FirebaseUser } from '../db/firebase-db.js';
import { getDb } from '../firebase/config.js';
import { doc, updateDoc, deleteDoc } from 'firebase/firestore';

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

  const isCyclePayment = user.cycle_payment_status === 'pending';
  const isQualified = user.is_qualified && user.account_status === 'inactive';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2>{isCyclePayment ? 'Verify Cycle Payment' : 'Verify Payment'}</h2>
          <button onClick={onClose} className="btn btn-ghost">✕</button>
        </div>
        
        <div style={{ display: 'grid', gap: '1rem' }}>
          {isQualified && (
            <div className="alert alert-warning">
              <strong>Cycle Payment Required</strong> — User has completed 2 referrals and needs reactivation.
            </div>
          )}
          
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
            <div style={{ fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: 'bold' }}>
              {isCyclePayment ? (user.cycle_payment_utr || '—') : (user.utr_number || '—')}
            </div>
          </div>
          
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Current Status</div>
            <span className={`badge ${(isCyclePayment ? user.cycle_payment_status : user.payment_status) === 'approved' ? 'badge-paid' : (isCyclePayment ? user.cycle_payment_status : user.payment_status) === 'rejected' ? 'badge-rejected' : 'badge-pending'}`}>
              {isCyclePayment ? (user.cycle_payment_status ? user.cycle_payment_status.charAt(0).toUpperCase() + user.cycle_payment_status.slice(1) : 'Pending') : (user.payment_status ? user.payment_status.charAt(0).toUpperCase() + user.payment_status.slice(1) : 'Pending')}
            </span>
            {isCyclePayment && user.cycle_payment_status === 'pending' && (
              <span style={{ marginLeft: '0.5rem', color: 'var(--warning)', fontSize: '0.8rem' }}>(Cycle Payment)</span>
            )}
          </div>
          
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Payment Screenshot</div>
            {(isCyclePayment ? user.cycle_upi_screenshot_url : user.upi_screenshot_url) ? (
              <div>
                <button 
                  type="button"
                  className="btn btn-primary"
                  style={{ marginBottom: '0.5rem' }}
                  onClick={() => window.open(getImageUrl(isCyclePayment ? user.cycle_upi_screenshot_url : user.upi_screenshot_url), '_blank')}
                >
                  Open Image
                </button>
                <br />
                <img 
                  src={getImageUrl(isCyclePayment ? user.cycle_upi_screenshot_url : user.upi_screenshot_url)} 
                  alt="Payment Screenshot" 
                  style={{ maxWidth: '100%', borderRadius: '8px', marginTop: '0.5rem', border: '1px solid #ccc' }} 
                  loading="lazy"
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
          
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Total Referrals</div>
            <div>{user.total_referral_count || 0} (Cycle: {user.referrals_count || 0})</div>
          </div>
        </div>
        
        <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button 
            className={`btn btn-primary${verifying ? ' btn-loading' : ''}`}
            onClick={() => handleVerify('approved')}
            disabled={verifying}
            style={{ background: 'var(--success)' }}
          >
            ✓ Approve
          </button>
          <button 
            className={`btn btn-danger${verifying ? ' btn-loading' : ''}`}
            onClick={() => handleVerify('rejected')}
            disabled={verifying}
          >
            ✕ Reject
          </button>
          <button 
            className={`btn btn-ghost${verifying ? ' btn-loading' : ''}`}
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
  const [combinedFilter, setCombinedFilter] = useState('');
  const [draggedUser, setDraggedUser] = useState(null);
  const [combinedDropOver, setCombinedDropOver] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem(ADMIN_KEY);
    if (!token) {
      navigate('/fb-admin', { replace: true });
      return;
    }

    const unsubscribe = FirebaseUser.subscribeToPayments((usersWithPayment) => {
      setUsers(usersWithPayment);
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [navigate]);

  useEffect(() => {
    const status = searchParams.get('status');
    if (status) setCombinedFilter(status);
  }, [searchParams]);

  const handleVerify = async (userId, status) => {
    const user = users.find(u => u.id === userId);
    const isCycle = user?.cycle_payment_status === 'pending' || user?.cycle_payment_utr;
    
    if (isCycle) {
      if (status === 'approved') {
        await FirebaseUser.reactivate(userId);
      } else {
        await FirebaseUser.updateCyclePaymentStatus(userId, status);
      }
    } else {
      if (status === 'approved') {
        await FirebaseUser.updatePaymentStatus(userId, 'approved');
      } else {
        await FirebaseUser.updatePaymentStatus(userId, status);
      }
    }
  };

  const filteredUsers = useMemo(() => {
    let filtered = users;

    if (combinedFilter) {
      const [prefix, value] = combinedFilter.startsWith('payment_')
        ? ['payment', combinedFilter.slice(8)]
        : combinedFilter.startsWith('account_')
        ? ['account', combinedFilter.slice(8)]
        : [null, null];

      if (prefix === 'payment') {
        filtered = filtered.filter(u => {
          const isCycle = u.cycle_payment_status === 'pending' || u.cycle_payment_utr;
          return isCycle ? u.cycle_payment_status === value : u.payment_status === value;
        });
      } else if (prefix === 'account') {
        filtered = filtered.filter(u => u.account_status === value);
      }
    }

    if (q) {
      const ql = q.toLowerCase();
      filtered = filtered.filter(u => {
        const matchesName = u.name && u.name.toLowerCase().includes(ql);
        const matchesEmail = u.email && u.email.toLowerCase().includes(ql);
        const isCycle = u.cycle_payment_status === 'pending' || u.cycle_payment_utr;
        const utr = isCycle ? u.cycle_payment_utr : u.utr_number;
        const matchesUtr = utr && utr.includes(q);
        return matchesName || matchesEmail || matchesUtr;
      });
    }

    return filtered;
  }, [users, combinedFilter, q]);

  const handleDeleteUser = async (userId) => {
    if (!window.confirm('Delete this user permanently?')) return;
    try {
      const db = getDb();
      await deleteDoc(doc(db, 'users_new', userId));
    } catch (err) {
      console.error('Delete error:', err);
      alert('Delete failed: ' + (err.message || 'Unknown error'));
    }
  };

  const handleDragStart = useCallback((e, user) => {
    setDraggedUser(user);
    e.dataTransfer.setData('text/plain', user.id);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedUser(null);
    setCombinedDropOver(false);
  }, []);

  const handleCombinedDrop = useCallback(async () => {
    if (!draggedUser || !combinedFilter) return;
    const { id } = draggedUser;
    const isCycle = draggedUser.cycle_payment_status === 'pending' || draggedUser.cycle_payment_utr;
    const [prefix, value] = combinedFilter.startsWith('payment_')
      ? ['payment', combinedFilter.slice(8)]
      : ['account', combinedFilter.slice(8)];
    try {
      if (prefix === 'payment') {
        if (isCycle) {
          if (value === 'approved') {
            await FirebaseUser.reactivate(id);
          } else {
            await FirebaseUser.updateCyclePaymentStatus(id, value);
          }
        } else {
          await FirebaseUser.updatePaymentStatus(id, value);
        }
      } else {
        const db = getDb();
        const ref = doc(db, 'users_new', id);
        await updateDoc(ref, { account_status: value });
      }
    } catch (err) {
      console.error('Drop error:', err);
    }
    setDraggedUser(null);
    setCombinedDropOver(false);
  }, [draggedUser, combinedFilter]);

  const updateCombinedFilter = (value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('status', value);
    else next.delete('status');
    setSearchParams(next, { replace: true });
    setCombinedFilter(value);
  };

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">Payment Verification</div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Link className="btn btn-ghost" to="/fb-admin/dashboard">
            Dashboard
          </Link>
          <Link className="btn btn-ghost" to="/fb-admin/topups">
            Topups
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
          <div
            className={`drop-select-wrap ${combinedDropOver ? 'drop-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setCombinedDropOver(true); }}
            onDragLeave={() => setCombinedDropOver(false)}
            onDrop={() => { setCombinedDropOver(false); handleCombinedDrop(); }}
          >
            <select
              value={combinedFilter}
              onChange={e => updateCombinedFilter(e.target.value)}
              style={{ maxWidth: '200px' }}
            >
              <option value="">All</option>
              <optgroup label="Payment">
                <option value="payment_pending">Pending</option>
                <option value="payment_approved">Approved</option>
                <option value="payment_rejected">Rejected</option>
              </optgroup>
              <optgroup label="Account">
                <option value="account_active">Active</option>
                <option value="account_inactive">Inactive</option>
                <option value="account_pending">Pending</option>
                <option value="account_suspicious">Suspicious</option>
              </optgroup>
            </select>
            {combinedDropOver && <span className="drop-hint">Drop to apply</span>}
          </div>
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
                <th>Type</th>
                <th>Payment</th>
                <th>Account</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => {
                const isCycle = u.cycle_payment_status === 'pending' || u.cycle_payment_utr;
                const displayUtr = isCycle ? u.cycle_payment_utr : u.utr_number;
                const displayStatus = isCycle ? u.cycle_payment_status : u.payment_status;
                const displayUrl = isCycle ? u.cycle_upi_screenshot_url : u.upi_screenshot_url;
                return (
                  <tr
                    key={u.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, u)}
                    onDragEnd={handleDragEnd}
                    style={{ opacity: draggedUser?.id === u.id ? 0.4 : 1, cursor: 'grab' }}
                  >
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td style={{ fontFamily: 'monospace' }}>{displayUtr || '—'}</td>
                    <td>
                      {isCycle ? (
                        <span className="badge badge-rejected" style={{ fontSize: '0.7rem' }}>Cycle</span>
                      ) : (
                        <span className="muted" style={{ fontSize: '0.7rem' }}>Initial</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${displayStatus === 'approved' ? 'badge-paid' : displayStatus === 'rejected' ? 'badge-rejected' : 'badge-pending'}`}>
                        {displayStatus ? displayStatus.charAt(0).toUpperCase() + displayStatus.slice(1) : 'Pending'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${u.account_status === 'active' ? 'badge-paid' : u.account_status === 'inactive' ? 'badge-rejected' : 'badge-pending'}`}>
                        {u.account_status ? u.account_status.charAt(0).toUpperCase() + u.account_status.slice(1) : '—'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.3rem' }}>
                        <button
                          className="btn btn-primary"
                          onClick={() => setSelectedUser(u)}
                          style={{ padding: '0.35rem 0.65rem', fontSize: '0.85rem' }}
                        >
                          Verify
                        </button>
                        <button
                          className="btn btn-danger"
                          onClick={() => handleDeleteUser(u.id)}
                          style={{ padding: '0.35rem 0.65rem', fontSize: '0.85rem' }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
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