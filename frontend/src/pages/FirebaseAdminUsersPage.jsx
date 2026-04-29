import React, { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FirebaseUser } from '../db/firebase-db.js';
import { getAuthRef, getDb } from '../firebase/config.js';
import { sendPasswordResetEmail } from 'firebase/auth';

const ADMIN_KEY = 'fb_admin_token';

const getImageUrl = (url) => {
  if (!url) return null;
  if (url.includes('alt=media')) return url;
  if (url.startsWith('data:')) return url;
  return url + (url.includes('?') ? '&' : '?') + 'alt=media';
};

function UserDetailModal({ user, onClose, onDelete, onDeleteReferral }) {
  const [deleting, setDeleting] = useState(false);
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState('');

  useEffect(() => {
    if (user?.id) {
      setLoading(true);
      FirebaseUser.getReferralsByReferrerCode(user.referral_code).then(setReferrals).finally(() => setLoading(false));
    }
  }, [user?.id, user?.referral_code]);

  async function handleResetPassword() {
    if (!window.confirm(`Send password reset email to "${user.email}"?`)) return;
    setResetting(true);
    setResetMsg('');
    try {
      const auth = getAuthRef();
      await sendPasswordResetEmail(auth, user.email);
      setResetMsg('Password reset email sent!');
    } catch (err) {
      console.error('Reset error:', err);
      setResetMsg('Error: ' + err.message);
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '550px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2>User Details</h2>
          <button onClick={onClose} className="btn btn-ghost">✕</button>
        </div>
        
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Name</div>
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
            <div style={{ fontFamily: 'monospace' }}>{user.utr_number || '—'}</div>
          </div>
          
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Payment Status</div>
            <span className={`badge ${user.payment_status === 'approved' ? 'badge-paid' : user.payment_status === 'rejected' ? 'badge-rejected' : 'badge-pending'}`}>
              {user.payment_status || 'pending'}
            </span>
          </div>
          
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Referral Code</div>
            <code style={{ fontSize: '1rem' }}>{user.referral_code}</code>
            <button 
              className="btn btn-ghost" 
              style={{ marginLeft: '0.5rem', padding: '0.25rem 0.5rem' }}
              onClick={() => navigator.clipboard.writeText(user.referral_code)}
            >
              Copy
            </button>
          </div>
          
          {user.referred_by && (
            <div>
              <div className="muted" style={{ fontSize: '0.85rem' }}>Referred By</div>
              <div>{user.referred_by}</div>
            </div>
          )}
        </div>
        
        <div>
          {loading ? (
              <div className="muted">Loading...</div>
            ) : referrals.length > 0 ? (
              <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.5rem', background: '#f1f5f9', padding: '0.5rem', borderRadius: '4px' }}>
                {referrals.map((ref) => (
                  <div key={ref.id} style={{ padding: '0.5rem', background: '#1e293b', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#e8eaef' }}>
                    <div>
                      <div style={{ fontWeight: 'bold', color: '#e8eaef' }}>{ref.name}</div>
                      <div style={{ fontSize: '0.85rem', color: '#8b93a7' }}>{ref.email}</div>
                      <div style={{ fontSize: '0.85rem', color: '#8b93a7' }}>{ref.phone || '—'}</div>
                    </div>
                    <button 
                      className="btn btn-danger btn-sm"
                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                      onClick={() => handleDeleteReferral(ref)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {referrals.length > 0 && (
                  <button 
                    className="btn btn-danger"
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                    onClick={handleDeleteAllReferrals}
                  >
                    Remove All Referrals
                  </button>
                )}
              </div>
            ) : (
              <div className="muted">No referrals yet</div>
            )}
        </div>
        
        <div>
          <div className="muted" style={{ fontSize: '0.85rem' }}>Payment Screenshot</div>
          {user.upi_screenshot_url ? (
            <div>
              <button 
                className="btn btn-primary"
                style={{ marginBottom: '0.5rem' }}
                onClick={() => window.open(getImageUrl(user.upi_screenshot_url), '_blank')}
              >
                Open Image
              </button>
              <img 
                src={getImageUrl(user.upi_screenshot_url)} 
                alt="Payment" 
                style={{ maxWidth: '100%', borderRadius: '8px', marginTop: '0.5rem' }} 
              />
            </div>
          ) : (
            <div className="muted">No screenshot uploaded</div>
          )}
        </div>
        
        <div>
          <div className="muted" style={{ fontSize: '0.85rem' }}>Created At</div>
          <div>{user.created_at ? new Date(user.created_at).toLocaleString() : '—'}</div>
        </div>
        
        <div style={{ marginTop: '1.5rem', borderTop: '1px solid #ddd', paddingTop: '1rem' }}>
          <button 
            className="btn btn-primary" 
            onClick={handleResetPassword}
            disabled={resetting}
          >
            {resetting ? 'Sending...' : 'Reset Password'}
          </button>
        </div>
        {resetMsg && <div className="alert alert-success" style={{ marginTop: '0.5rem' }}>{resetMsg}</div>}
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
      const referrals = await FirebaseUser.getReferralsByReferrerCode(user.referral_code);
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
      console.log('Admin received all users:', allUsers.length);
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
    await FirebaseUser.deleteUser(userId);
    const allUsers = await FirebaseUser.getAllUsers();
    setUsers(allUsers);
  };

  const handleDeleteReferral = async (referralCode, referredUserId) => {
    const db = getDb();
    const { doc, updateDoc, getDoc } = await import('firebase/firestore');
    try {
      const userRef = doc(db, 'users_new', referredUserId);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const data = snap.data();
        const currentReferredBy = data.referred_by;
        const referrer = await FirebaseUser.findByReferralCode(referralCode);
        if (referrer) {
          const newCount = Math.max(0, (referrer.referrals_count || 0) - 1);
          await updateDoc(doc(db, 'users_new', referrer.id), {
            referrals_count: newCount,
            referral_limit_reached: newCount >= 2,
          });
        }
        await updateDoc(userRef, { referred_by: null, referral_limit_reached: false });
      }
      console.log('Referral removed:', referredUserId);
    } catch (err) {
      console.error('Delete referral error:', err);
      throw err;
    }
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
        (u.referral_code && u.referral_code.toLowerCase().includes(q.toLowerCase())) ||
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
        <div className="brand">User Management</div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Link className="btn btn-ghost" to="/fb-admin/dashboard">
            Dashboard
          </Link>
          <Link className="btn btn-ghost" to="/fb-admin/payments">
            Payments
          </Link>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2>Search & Filter</h2>
        <div className="copy-row" style={{ marginTop: '0.75rem', gap: '1rem', flexWrap: 'wrap' }}>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search by name, email, referral_code, or UTR..."
            style={{ maxWidth: '300px' }}
          />
          <select
            value={statusFilter}
            onChange={e => updateStatusFilter(e.target.value)}
            style={{ maxWidth: '180px' }}
          >
            <option value="">All Users</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      <div className="card">
        <h2>All Users ({filteredUsers.length})</h2>
        <p className="muted" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
          Total users: {users.length} | Approved: {users.filter(u => u.payment_status === 'approved').length} | Pending: {users.filter(u => u.payment_status === 'pending').length}
        </p>
        
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>UTR</th>
                <th>Referral Code</th>
                <th>Referred Users</th>
                <th>Total Refs</th>
                <th>View Count</th>
                <th>Qualified</th>
                <th>Account Status</th>
                <th>Screenshot</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody onMouseMove={handleDragMove} onMouseUp={handleDragEnd} onTouchEnd={handleDragEnd}>
              {filteredUsers.map((u) => (
                <React.Fragment key={u.id}>
                  <tr 
                    onMouseDown={(e) => handleDragStart(e, u)}
                    onTouchStart={(e) => handleDragStart(e, u)}
                    style={{ cursor: 'grab', userSelect: 'none' }}
                  >
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td>{u.phone || '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{u.utr_number || '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{u.referral_code || '—'}</td>
                    <td>
                      <button 
                        className="btn btn-ghost" 
                        onClick={(e) => { e.stopPropagation(); handleToggleUserExpand(u.id); }}
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                      >
                        {expandedUserId === u.id ? 'Hide' : `View${u.payment_status === 'approved' ? ` (${u.referrals_count || 0})` : ''}`}
                      </button>
                    </td>
                    <td>{u.total_referral_count || 0}</td>
                    <td>
                      <span className="badge badge-paid" style={{ fontSize: '0.75rem' }}>
                        {u.referral_view_count || 0}
                        {u.referral_view_cycle !== u.referral_cycle && (
                          <span style={{ marginLeft: '0.25rem', color: 'var(--warning)' }} title="Cycle mismatch">*</span>
                        )}
                      </span>
                    </td>
                    <td>
                      {u.is_qualified ? (
                        <span style={{ color: 'var(--success)', fontWeight: 'bold', fontSize: '0.8rem' }}>Qualified</span>
                      ) : (
                        <span className="muted" style={{ fontSize: '0.75rem' }}>—</span>
                      )}
                    </td>
                    <td>
                      {u.account_status === 'inactive' ? (
                        <span className="badge badge-rejected">Inactive</span>
                      ) : (
                        <span className="badge badge-paid">Active</span>
                      )}
                    </td>
                    <td>
                      {u.upi_screenshot_url ? (
                        <button 
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                          onClick={(e) => { e.stopPropagation(); const url = getImageUrl(u.upi_screenshot_url); window.open(url, '_blank'); }}
                        >
                          view
                        </button>
                      ) : (
                        <span className="muted" style={{ fontSize: '0.75rem' }}>—</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${u.payment_status === 'approved' ? 'badge-paid' : u.payment_status === 'rejected' ? 'badge-rejected' : 'badge-pending'}`}>
                        {u.payment_status || 'pending'}
                      </span>
                    </td>
                    <td>
                      <div onClick={(e) => e.stopPropagation()}>
                        <button className="btn btn-primary" onClick={() => setSelectedUser(u)} style={{ padding: '0.35rem 0.65rem', fontSize: '0.85rem' }}>View</button>
                        <button className="btn btn-danger" onClick={async () => { if (window.confirm(`Delete "${u.name}"?`)) { await handleDelete(u.id); } }} style={{ padding: '0.35rem 0.65rem', fontSize: '0.85rem' }}>Delete</button>
                      </div>
                    </td>
                  </tr>
                  {expandedUserId === u.id && (
                    <tr>
                      <td colSpan={12} style={{ padding: '0.75rem', background: 'var(--bg)', borderTop: '2px solid var(--primary)' }}>
                        {u.payment_status === 'approved' ? (
                          <>
                            <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>Referred by {u.name}:</div>
                            {loadingReferrals ? <div className="muted">Loading...</div> : 
                             expandedReferrals.length > 0 ? (
                               <div style={{ display: 'flex', gap: '0.75rem' }}>
                                 {expandedReferrals.map((ref) => (
                                 <div key={ref.id} style={{ padding: '0.5rem', background: '#1e293b', borderRadius: '4px', border: '1px solid var(--border)', color: '#e8eaef' }}>
                                   <div style={{ fontWeight: 'bold', color: '#e8eaef' }}>{ref.name}</div>
                                   <div style={{ fontSize: '0.8rem', color: '#8b93a7' }}>{ref.phone || '—'}</div>
                                 </div>
                               ))}
                               </div>
                             ) : <div className="muted">No referrals yet</div>}
                          </>
                        ) : (
                          <div className="muted">Referral data available after payment approval</div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {filteredUsers.length === 0 && (
                <tr><td colSpan={12} className="muted">No users found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedUser && (
        <UserDetailModal
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onDelete={handleDelete}
          onDeleteReferral={handleDeleteReferral}
        />
      )}
    </div>
  );
}