import { useEffect, useState, useMemo } from 'react';
import { ClaimEngine } from '../db/firebase-claim-engine.js';
import { FirebaseNotification } from '../db/firebase-db.js';
import AdminSidebar from '../components/AdminSidebar.jsx';

function ClaimModal({ claim, onClose }) {
  const [adminMessage, setAdminMessage] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleAction(status) {
    if (!adminMessage || !adminMessage.trim()) {
      setMsg('Message to user is required');
      return;
    }
    setLoading(true);
    setMsg('');
    try {
      const adminName = sessionStorage.getItem('fb_admin_name') || localStorage.getItem('fb_admin_name') || 'Admin';
      if (status === 'approved') {
        await ClaimEngine.approveClaim(claim.id, adminName);
      } else {
        await ClaimEngine.rejectClaim(claim.id, adminName, adminMessage);
      }
      await FirebaseNotification.send({
        receiverId: claim.userId,
        receiverName: claim.userName || '',
        message: adminMessage,
        type: status === 'approved' ? 'claim_approved' : 'claim_rejected',
        senderId: adminName,
        senderName: adminName,
      });
      setMsg(status === 'approved' ? 'Claim Approved & Wallet Credited!' : 'Claim Rejected!');
      setTimeout(onClose, 1200);
    } catch (err) {
      setMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  const badges = {
    approved: 'badge-paid', rejected: 'badge-rejected', pending: 'badge-pending', manual_review: 'badge-warning',
  };

  return (
    <div className="modal-modern-overlay" onClick={onClose}>
      <div className="modal-modern" onClick={e => e.stopPropagation()} style={{ maxWidth: '520px' }}>
        <div className="modal-modern-header">
          <h2>Claim Review</h2>
          <button onClick={onClose} className="btn-modern btn-modern-ghost btn-modern-sm">{'\u2715'}</button>
        </div>
        <div className="modal-modern-body">
          <div className="detail-grid-sm">
            <div className="detail-row-bordered">
              <span className="detail-label">User</span>
              <span className="detail-value font-semibold">{claim.userName || '—'}</span>
            </div>
            <div className="detail-row-bordered">
              <span className="detail-label">Email</span>
              <span className="detail-value text-sm">{claim.userEmail || '—'}</span>
            </div>
            <div className="detail-row-bordered">
              <span className="detail-label">Amount</span>
              <span className="detail-value font-bold">₹{Number(claim.amount || 0).toFixed(2)}</span>
            </div>
            <div className="detail-row-bordered">
              <span className="detail-label">Transaction ID</span>
              <span className="detail-value font-mono text-sm">{claim.transactionId || '—'}</span>
            </div>
            <div className="detail-row-bordered">
              <span className="detail-label">Status</span>
              <span className={`badge ${badges[claim.status] || 'badge-pending'} badge-xs`}>{claim.status}</span>
            </div>
          </div>

          {claim.screenshotData && (
            <div style={{ margin: '0.75rem 0' }}>
              <div className="detail-label" style={{ marginBottom: '0.35rem' }}>Screenshot</div>
              <img src={claim.screenshotData} alt="Payment proof" style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: '0.5rem', border: '1px solid var(--border)' }} />
            </div>
          )}

          {claim.verification_details?.length > 0 && (
            <div className="verify-section" style={{ margin: '0.5rem 0' }}>
              <div className="validation-pills">
                {claim.verification_details.map((v, i) => (
                  <span key={i} className={`validation-pill ${v.passed === true ? 'valid' : v.passed === false ? 'invalid' : 'skipped'}`}>
                    {v.check}: {v.passed === true ? 'PASS' : v.passed === false ? 'FAIL' : 'SKIP'}
                  </span>
                ))}
              </div>
            </div>
          )}

          {claim.rejection_reason && claim.status === 'rejected' && (
            <div className="alert alert-error" style={{ margin: '0.5rem 0' }}>
              Reason: {claim.rejection_reason}
            </div>
          )}

          {claim.wallet_credited && (
            <div className="alert alert-success" style={{ margin: '0.5rem 0' }}>
              Wallet credited on {new Date(claim.wallet_credited_at || claim.approved_at).toLocaleString('en-IN')}
            </div>
          )}

          <div className="field" style={{ marginTop: '0.75rem' }}>
            <label>Message to user {claim.status === 'pending' || claim.status === 'manual_review' ? '(required)' : ''}</label>
            <textarea
              className="input" rows={2}
              placeholder={claim.wallet_credited ? 'Already approved' : 'Enter message to notify the user'}
              value={adminMessage} onChange={e => setAdminMessage(e.target.value)}
              disabled={loading || claim.wallet_credited}
            />
          </div>

          {msg && (
            <div className={`alert ${msg.includes('Approved') || msg.includes('Credited') ? 'alert-success' : 'alert-error'} modal-alert-mb`}>
              {msg}
            </div>
          )}
        </div>
        {(claim.status === 'pending' || claim.status === 'manual_review') && !claim.wallet_credited && (
          <div className="modal-modern-footer">
            <button className={`btn-modern btn-modern-success${loading ? ' btn-loading' : ''}`}
              onClick={() => handleAction('approved')} disabled={loading}>
              {'\u2713'} Approve & Credit Wallet
            </button>
            <button className={`btn-modern btn-modern-danger${loading ? ' btn-loading' : ''}`}
              onClick={() => handleAction('rejected')} disabled={loading}>
              {'\u2715'} Reject
            </button>
          </div>
        )}
        {(claim.status === 'approved' || claim.status === 'rejected' || claim.wallet_credited) && (
          <div className="modal-modern-footer">
            <button className="btn-modern btn-modern-ghost" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminClaimPage() {
  const [claims, setClaims] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [q, setQ] = useState('');
  const [selectedClaim, setSelectedClaim] = useState(null);

  useEffect(() => {
    const unsub = ClaimEngine.subscribeToAllClaims((data) => {
      setClaims(data || []);
    });
    return () => { if (unsub) unsub(); };
  }, []);

  const stats = useMemo(() => {
    let pending = 0, approved = 0, rejected = 0, manualReview = 0, totalAmount = 0;
    for (const c of claims) {
      if (c.status === 'pending') pending++;
      else if (c.status === 'approved') { approved++; totalAmount += Number(c.amount || 0); }
      else if (c.status === 'rejected') rejected++;
      else if (c.status === 'manual_review' || c.review_status === 'needs_review') manualReview++;
    }
    return { pending, approved, rejected, manualReview, totalAmount };
  }, [claims]);

  const filteredClaims = useMemo(() => {
    let filtered = claims;
    if (statusFilter) {
      if (statusFilter === 'needs_review') {
        filtered = filtered.filter(c => c.review_status === 'needs_review' || c.status === 'manual_review');
      } else {
        filtered = filtered.filter(c => c.status === statusFilter);
      }
    }
    if (q) {
      const ql = q.toLowerCase();
      filtered = filtered.filter(c =>
        (c.userName && c.userName.toLowerCase().includes(ql)) ||
        (c.userEmail && c.userEmail.toLowerCase().includes(ql)) ||
        (c.transactionId && c.transactionId.toLowerCase().includes(ql))
      );
    }
    return filtered;
  }, [claims, statusFilter, q]);

  function getBadgeClass(status) {
    switch (status) {
      case 'approved': return 'badge-paid';
      case 'rejected': return 'badge-rejected';
      case 'pending': return 'badge-pending';
      case 'manual_review': return 'badge-warning';
      default: return 'badge-pending';
    }
  }

  return (
    <div className="admin-layout">
      <AdminSidebar userName="Admin" />
      <main className="admin-content">
        <div className="admin-content-inner">
          <div className="admin-page-header">
            <h1 className="admin-page-title">
              <span className="admin-page-title-icon">{'\u{1F4B0}'}</span>
              Top-Up Claims
            </h1>
          </div>

          <div className="stats-grid-modern">
            <div className="stat-card-modern warning">
              <div className="stat-bg-icon">{'\u23F3'}</div>
              <div className="stat-value">{stats.pending + stats.manualReview}</div>
              <div className="stat-label">Pending + Manual Review</div>
              <div className="stat-sub">Awaiting action</div>
            </div>
            <div className="stat-card-modern success">
              <div className="stat-bg-icon">{'\u2705'}</div>
              <div className="stat-value">{stats.approved}</div>
              <div className="stat-label">Approved</div>
              <div className="stat-sub">Wallet credited</div>
            </div>
            <div className="stat-card-modern danger">
              <div className="stat-bg-icon">{'\u2715'}</div>
              <div className="stat-value">{stats.rejected}</div>
              <div className="stat-label">Rejected</div>
              <div className="stat-sub">Denied</div>
            </div>
            <div className="stat-card-modern accent">
              <div className="stat-bg-icon">{'\u{1F4B8}'}</div>
              <div className="stat-value">₹{stats.totalAmount.toFixed(2)}</div>
              <div className="stat-label">Total Approved Amount</div>
              <div className="stat-sub">Credited to wallets</div>
            </div>
          </div>

          <div className="card-modern card-section">
            <div className="card-modern-header">
              <h2 className="card-modern-title">{'\u{1F4CB}'} Claim Requests ({filteredClaims.length})</h2>
              <div className="admin-page-actions" style={{ gap: '0.5rem' }}>
                <input className="input" style={{ width: '200px', padding: '0.4rem 0.6rem', fontSize: '0.8rem' }}
                  placeholder="Search user, email, TX ID..." value={q} onChange={e => setQ(e.target.value)} />
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                  style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem', borderRadius: '0.4rem', border: '1px solid var(--border)' }}>
                  <option value="">All Claims</option>
                  <option value="pending">Pending</option>
                  <option value="manual_review">Manual Review</option>
                  <option value="needs_review">Needs Review</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
            </div>
            <div className="table-wrap-modern table-section">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Email</th>
                    <th>Amount</th>
                    <th>Transaction ID</th>
                    <th>Status</th>
                    <th>Wallet</th>
                    <th>Date</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClaims.length === 0 ? (
                    <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>No claims found</td></tr>
                  ) : filteredClaims.map(c => (
                    <tr key={c.id}>
                      <td data-label="User" className="font-semibold">{c.userName || '—'}</td>
                      <td data-label="Email" className="text-sm">{c.userEmail || '—'}</td>
                      <td data-label="Amount" className="font-bold">₹{Number(c.amount || 0).toFixed(2)}</td>
                      <td data-label="TX ID" className="font-mono text-sm" style={{ fontSize: '0.75rem' }}>{c.transactionId || '—'}</td>
                      <td data-label="Status"><span className={`badge ${getBadgeClass(c.status)} badge-xs`}>{c.status}</span></td>
                      <td data-label="Wallet">{c.wallet_credited ? <span className="badge badge-paid badge-xs">Credited</span> : <span className="badge badge-pending badge-xs">—</span>}</td>
                      <td data-label="Date" className="text-sm">{c.created_at ? new Date(c.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
                      <td data-label="Action">
                        <button className="btn-modern btn-modern-primary btn-modern-xs" onClick={() => setSelectedClaim(c)}>
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {selectedClaim && (
            <ClaimModal claim={selectedClaim} onClose={() => { setSelectedClaim(null); }} />
          )}
        </div>
      </main>
    </div>
  );
}
