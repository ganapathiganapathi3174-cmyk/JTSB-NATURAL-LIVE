import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FirebaseTopup, FirebaseTopupReferral, FirebaseUser } from '../db/firebase-db.js';

const ADMIN_KEY = 'fb_admin_token';

function getInactiveReasonLabel(reason) {
  if (reason === 'own_topup_completed') return 'Own Topup Completed';
  return reason || '—';
}

function getImageUrl(url) {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  return url + (url.includes('?') ? '&' : '?') + 'alt=media';
}

function TopupModal({ topup, onClose, onVerify, onDelete, userData }) {
  const [verifying, setVerifying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState('');

  const isInactive = userData?.account_status === 'inactive';
  const inactiveReason = userData ? getInactiveReasonLabel(userData.inactive_reason) : null;

  async function handleVerify(status) {
    setVerifying(true);
    setMsg('');
    try {
      await onVerify(topup.id, status);
      setMsg(status === 'approved' ? 'Topup Approved!' : 'Topup Rejected!');
      setTimeout(onClose, 1000);
    } catch (err) {
      setMsg(err.message);
    } finally {
      setVerifying(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this topup record permanently?')) return;
    setDeleting(true);
    try {
      await onDelete(topup.id);
      onClose();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setDeleting(false);
    }
  }

  if (!topup) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2>Topup Details</h2>
          <button onClick={onClose} className="btn btn-ghost">✕</button>
        </div>

        <div style={{ display: 'grid', gap: '1rem' }}>
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>User</div>
            <div style={{ fontWeight: 'bold' }}>{topup.userName}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Email</div>
            <div>{topup.userEmail}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Phone</div>
            <div>{topup.userPhone || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Amount</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--success)' }}>₹{Number(topup.amount || 0).toFixed(2)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Transaction ID</div>
            <div style={{ fontFamily: 'monospace', fontSize: '1rem', fontWeight: 'bold' }}>{topup.transactionId || '—'}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Referral Code</div>
            <div style={{ fontFamily: 'monospace' }}>{topup.userReferralCode || '—'}</div>
          </div>
          {topup.referred_by && (
            <div>
              <div className="muted" style={{ fontSize: '0.85rem' }}>Referred By</div>
              <div>{topup.referred_by}</div>
            </div>
          )}
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Current Status</div>
            <span className={`badge ${topup.status === 'approved' ? 'badge-paid' : topup.status === 'rejected' ? 'badge-rejected' : 'badge-pending'}`}>
              {topup.status ? topup.status.charAt(0).toUpperCase() + topup.status.slice(1) : 'Pending'}
            </span>
          </div>
          {isInactive && (
            <div>
              <div className="muted" style={{ fontSize: '0.85rem' }}>Account Status</div>
              <div>
                <span className="badge badge-rejected" style={{ fontSize: '0.7rem' }}>Inactive</span>
                <span className="badge badge-pending" style={{ fontSize: '0.7rem', marginLeft: '0.25rem' }}>
                  {inactiveReason}
                </span>
              </div>
            </div>
          )}
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Payment Screenshot</div>
            {topup.screenshotData ? (
              <div>
                <button type="button" className="btn btn-primary" style={{ marginBottom: '0.5rem' }}
                  onClick={() => window.open(getImageUrl(topup.screenshotData), '_blank')}>
                  Open Image
                </button>
                <br />
                <img src={getImageUrl(topup.screenshotData)} alt="Topup Screenshot"
                  style={{ maxWidth: '100%', borderRadius: '8px', marginTop: '0.5rem', border: '1px solid var(--border)' }}
                  loading="lazy"
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              </div>
            ) : (
              <div className="muted">No screenshot uploaded</div>
            )}
          </div>
          <div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Submitted At</div>
            <div>{topup.createdAt ? new Date(topup.createdAt).toLocaleString() : '—'}</div>
          </div>
        </div>

        {topup.status === 'pending' && (
          <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className={`btn btn-primary${verifying ? ' btn-loading' : ''}`}
              onClick={() => handleVerify('approved')} disabled={verifying}
              style={{ background: 'var(--success)' }}>
              ✓ Approve Topup
            </button>
            <button className={`btn btn-danger${verifying ? ' btn-loading' : ''}`}
              onClick={() => handleVerify('rejected')} disabled={verifying}>
              ✕ Reject Topup
            </button>
          </div>
        )}
        {topup.status !== 'pending' && (
          <div style={{ marginTop: '1.5rem' }}>
            <button className={`btn btn-danger${deleting ? ' btn-loading' : ''}`}
              onClick={handleDelete} disabled={deleting}
              style={{ background: 'rgba(243, 18, 96, 0.15)', color: '#ff6b9d', border: '1px solid rgba(243, 18, 96, 0.35)' }}>
              🗑 Delete Record
            </button>
          </div>
        )}

        {msg && (
          <p style={{ marginTop: '1rem', color: msg.includes('Approved') ? 'var(--success)' : 'var(--danger)' }}>
            {msg}
          </p>
        )}
      </div>
    </div>
  );
}

export default function FirebaseAdminTopupsPage() {
  const navigate = useNavigate();
  const [topups, setTopups] = useState([]);
  const [selectedTopup, setSelectedTopup] = useState(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sponsors, setSponsors] = useState([]);
  const [creditModal, setCreditModal] = useState(null);
  const [creditAmount, setCreditAmount] = useState('');
  const [crediting, setCrediting] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem(ADMIN_KEY);
    if (!token) {
      navigate('/fb-admin', { replace: true });
      return;
    }
    const unsubscribe = FirebaseTopup.subscribeToTopups((data) => {
      setTopups(data || []);
    });
    return () => { if (unsubscribe) unsubscribe(); };
  }, [navigate]);

  useEffect(() => {
    FirebaseTopup.getSponsorsAwaitingCredit().then(setSponsors).catch(() => {});
  }, []);

  const handleReview = async (topup) => {
    setSelectedTopup(topup);
    try {
      const user = await FirebaseUser.findById(topup.userId);
      setSelectedUser(user);
    } catch {
      setSelectedUser(null);
    }
  };

  const refreshSponsors = async () => {
    const list = await FirebaseTopup.getSponsorsAwaitingCredit();
    setSponsors(list);
  };

  const handleVerify = async (topupId, status) => {
    await FirebaseTopup.updateStatus(topupId, status, 'admin');
  };

  const handleDelete = async (topupId) => {
    await FirebaseTopup.delete(topupId);
  };

  const handleCreditSponsor = async () => {
    if (!creditModal || !creditAmount || Number(creditAmount) <= 0) return;
    setCrediting(true);
    try {
      await FirebaseTopup.creditSponsor(creditModal.id, Number(creditAmount), 'admin');
      setCreditModal(null);
      setCreditAmount('');
      await refreshSponsors();
    } catch (err) {
      alert(err.message);
    } finally {
      setCrediting(false);
    }
  };

  const filteredTopups = useMemo(() => {
    let filtered = topups;
    if (statusFilter) {
      filtered = filtered.filter(t => t.status === statusFilter);
    }
    if (q) {
      const ql = q.toLowerCase();
      filtered = filtered.filter(t =>
        (t.userName && t.userName.toLowerCase().includes(ql)) ||
        (t.userEmail && t.userEmail.toLowerCase().includes(ql)) ||
        (t.transactionId && t.transactionId.toLowerCase().includes(ql))
      );
    }
    return filtered;
  }, [topups, statusFilter, q]);

  const stats = useMemo(() => ({
    pending: topups.filter(t => t.status === 'pending').length,
    approved: topups.filter(t => t.status === 'approved').length,
    rejected: topups.filter(t => t.status === 'rejected').length,
    total: topups.reduce((sum, t) => sum + (Number(t.amount) || 0), 0),
  }), [topups]);

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">Topup Management</div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Link className="btn btn-ghost" to="/fb-admin/dashboard">Dashboard</Link>
          <Link className="btn btn-ghost" to="/fb-admin/payments">Payments</Link>
          <Link className="btn btn-ghost" to="/fb-admin/users">Users</Link>
        </div>
      </div>

      {sponsors.filter(s => !s.sponsor_credited).length > 0 && (
        <div className="card" style={{ marginBottom: '1rem', borderLeft: '4px solid var(--accent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h2>Sponsors Awaiting Credit ({sponsors.filter(s => !s.sponsor_credited).length})</h2>
            <button className="btn btn-ghost" onClick={refreshSponsors} style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}>Refresh</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sponsor No</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Topup Referrals</th>
                  <th>Sponsor Topup Amount</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {sponsors.filter(s => !s.sponsor_credited).map(s => (
                  <tr key={s.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem', fontWeight: 600, color: 'var(--primary)' }}>{s.referral_code || '—'}</td>
                    <td style={{ fontWeight: 600 }}>{s.name}</td>
                    <td style={{ fontSize: '0.85rem' }}>{s.email}</td>
                    <td>{s.topup_referrals_count}</td>
                    <td style={{ fontWeight: 700, color: 'var(--success)' }}>₹{Number(s.sponsor_topup_amount || 0).toFixed(2)}</td>
                    <td><span className="badge badge-pending">Awaiting Credit</span></td>
                    <td>
                      <button className="btn btn-primary" onClick={() => { setCreditModal(s); setCreditAmount(s.sponsor_topup_amount || ''); }}
                        style={{ padding: '0.35rem 0.65rem', fontSize: '0.85rem' }}>
                        Credit Now
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sponsors.filter(s => s.sponsor_credited).length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2>Credit History</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Amount Credited</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {sponsors.filter(s => s.sponsor_credited).map(s => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.name}</td>
                    <td style={{ fontSize: '0.85rem' }}>{s.email}</td>
                    <td style={{ fontWeight: 700, color: 'var(--success)' }}>₹{Number(s.sponsor_credited_amount || 0).toFixed(2)}</td>
                    <td style={{ fontSize: '0.8rem' }}>{s.sponsor_credited_at ? new Date(s.sponsor_credited_at).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid-stats">
        <div className="stat">
          <div className="value">{stats.pending}</div>
          <div className="label">Pending Topups</div>
        </div>
        <div className="stat">
          <div className="value" style={{ color: 'var(--success)' }}>{stats.approved}</div>
          <div className="label">Approved Topups</div>
        </div>
        <div className="stat">
          <div className="value" style={{ color: 'var(--danger)' }}>{stats.rejected}</div>
          <div className="label">Rejected Topups</div>
        </div>
        <div className="stat">
          <div className="value" style={{ color: 'var(--accent)' }}>₹{stats.total.toFixed(2)}</div>
          <div className="label">Total Topup Amount</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2>Search & Filter</h2>
        <div className="copy-row" style={{ marginTop: '0.75rem', gap: '1rem', flexWrap: 'wrap' }}>
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search by name, email, or transaction ID..."
            style={{ maxWidth: '250px' }}
          />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ maxWidth: '180px' }}>
            <option value="">All Topups</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      <div className="card">
        <h2>Topup Requests ({filteredTopups.length})</h2>
        <p className="muted" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
          Real-time updates enabled. Click "Review" to view details and approve/reject.
        </p>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>User</th>
                <th>Email</th>
                <th>Amount</th>
                <th>Transaction ID</th>
                <th>Sponsor No</th>
                <th>Sponsor Benefit</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTopups.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                    {t.createdAt ? new Date(t.createdAt).toLocaleDateString() : '—'}
                  </td>
                  <td style={{ fontWeight: 600 }}>{t.userName}</td>
                  <td style={{ fontSize: '0.85rem' }}>{t.userEmail}</td>
                  <td style={{ fontWeight: 700 }}>₹{Number(t.amount || 0).toFixed(2)}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{t.transactionId || '—'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{t.referred_by || '—'}</td>
                  <td>
                    {t.status === 'approved' ? (
                      <span className="badge badge-paid" style={{ fontSize: '0.7rem' }}>Done</span>
                    ) : (
                      <span className="muted" style={{ fontSize: '0.7rem' }}>—</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${t.status === 'approved' ? 'badge-paid' : t.status === 'rejected' ? 'badge-rejected' : 'badge-pending'}`}>
                      {t.status ? t.status.charAt(0).toUpperCase() + t.status.slice(1) : 'Pending'}
                    </span>
                  </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.3rem' }}>
                        <button className="btn btn-primary" onClick={() => handleReview(t)}
                          style={{ padding: '0.35rem 0.65rem', fontSize: '0.85rem' }}>
                          Review
                        </button>
                        {t.status !== 'pending' && (
                          <button className="btn btn-danger"
                            onClick={() => { if (window.confirm('Delete topup for ' + t.userName + '?')) { handleDelete(t.id); } }}
                            style={{ padding: '0.35rem 0.65rem', fontSize: '0.85rem' }}>
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                </tr>
              ))}
              {filteredTopups.length === 0 && (
                <tr><td colSpan={9} className="muted">No topup requests found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedTopup && (
        <TopupModal
          topup={selectedTopup}
          userData={selectedUser}
          onClose={() => { setSelectedTopup(null); setSelectedUser(null); }}
          onVerify={handleVerify}
          onDelete={handleDelete}
        />
      )}

      {creditModal && (
        <div className="modal-overlay" onClick={() => { if (!crediting) { setCreditModal(null); } }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2>Credit Sponsor</h2>
              <button onClick={() => setCreditModal(null)} className="btn btn-ghost" disabled={crediting}>✕</button>
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <div className="muted" style={{ fontSize: '0.85rem' }}>Sponsor</div>
              <div style={{ fontWeight: 600 }}>{creditModal.name}</div>
              <div className="muted">{creditModal.email}</div>
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <div className="muted" style={{ fontSize: '0.85rem' }}>Topup Referrals</div>
              <div>{creditModal.topup_referrals_count}</div>
            </div>
            <div className="field" style={{ marginBottom: '1rem' }}>
              <label>Credit Amount (INR)</label>
              <input type="number" value={creditAmount} onChange={e => setCreditAmount(e.target.value)}
                placeholder="Enter amount" min="1" disabled={crediting} />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className={`btn btn-primary${crediting ? ' btn-loading' : ''}`}
                onClick={handleCreditSponsor} disabled={crediting || !creditAmount || Number(creditAmount) <= 0}
                style={{ background: 'var(--success)' }}>
                {crediting ? 'Crediting...' : '✓ Credit Amount'}
              </button>
              <button className="btn btn-ghost" onClick={() => setCreditModal(null)} disabled={crediting}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
