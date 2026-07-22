import { useState, useEffect, useMemo } from 'react';
import AdminSidebar from '../components/AdminSidebar.jsx';
import { Link } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';

export default function AdminUpgradeRequestsPage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('pending');
  const [processingId, setProcessingId] = useState(null);
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  function authHeaders() {
    const t = localStorage.getItem('fb_admin_token');
    return t ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t } : { 'Content-Type': 'application/json' };
  }

  async function fetchRequests(status) {
    setLoading(true);
    setError('');
    try {
      const params = status && status !== 'all' ? '?status=' + status : '';
      const res = await fetch(`${API_BASE}/getUpgradeRequests${params}`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) setRequests(data.requests || []);
      else setError(data.error || 'Failed to fetch');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchRequests(filter); }, [filter]);

  async function handleApprove(id) {
    if (!confirm('Approve this upgrade request?')) return;
    setProcessingId(id);
    try {
      const res = await fetch(`${API_BASE}/approveUpgradeRequest`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ upgradeId: id }),
      });
      const data = await res.json();
      if (data.success) {
        fetchRequests(filter);
      } else {
        alert('Error: ' + (data.error || 'Failed to approve'));
      }
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setProcessingId(null);
    }
  }

  async function handleReject(id) {
    setProcessingId(id);
    try {
      const res = await fetch(`${API_BASE}/rejectUpgradeRequest`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ upgradeId: id, reason: rejectReason || 'Not specified' }),
      });
      const data = await res.json();
      if (data.success) {
        setRejectModal(null);
        setRejectReason('');
        fetchRequests(filter);
      } else {
        alert('Error: ' + (data.error || 'Failed to reject'));
      }
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setProcessingId(null);
    }
  }

  const stats = useMemo(() => {
    const total = requests.length;
    const approved = requests.filter(r => r.status === 'approved').length;
    const rejected = requests.filter(r => r.status === 'rejected').length;
    const pending = requests.filter(r => r.status === 'pending').length;
    return { total, approved, rejected, pending };
  }, [requests]);

  return (
    <div className="admin-layout">
      <AdminSidebar pendingCounts={{}} />
      <main className="admin-main">
        <div className="admin-page-header">
          <h1>Upgrade Requests</h1>
          <div className="flex gap-sm" style={{ fontSize: '0.85rem' }}>
            <span className="stat-badge" style={{ background: 'var(--info-bg)' }}>Total: {stats.total}</span>
            <span className="stat-badge" style={{ background: 'var(--success-bg)' }}>Approved: {stats.approved}</span>
            <span className="stat-badge" style={{ background: 'var(--danger-bg)' }}>Rejected: {stats.rejected}</span>
            <span className="stat-badge" style={{ background: 'var(--warning-bg)' }}>Pending: {stats.pending}</span>
          </div>
        </div>

        <div className="card" style={{ marginTop: '1rem' }}>
          <div className="flex gap-sm mb-md" style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>
            {['pending', 'approved', 'rejected', 'all'].map(s => (
              <button key={s} className={`btn btn-sm ${filter === s ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFilter(s)}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
            <button className="btn btn-sm btn-outline" onClick={() => fetchRequests(filter)} style={{ marginLeft: 'auto' }}>
              Refresh
            </button>
          </div>

          {error && <div className="alert alert-error mx-md">{error}</div>}

          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center' }}>
              <div className="loading-spinner loading-spinner-lg" />
              <p className="text-muted mt-sm">Loading upgrade requests...</p>
            </div>
          ) : requests.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center' }}>
              <p className="text-muted">No upgrade requests found</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Current Plan</th>
                    <th>Requested Plan</th>
                    <th>Amount</th>
                    <th>Referral</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map(req => (
                    <tr key={req.id}>
                      <td>
                        <div className="font-semibold">{req.user_name || 'Unknown'}</div>
                        <div className="text-xs text-muted">{req.user_email || ''}</div>
                        <div className="text-xs text-muted">{req.user_phone || ''}</div>
                      </td>
                      <td><span className="badge badge-outline">₹{req.current_plan}</span></td>
                      <td><span className="badge badge-success">₹{req.requested_plan}</span></td>
                      <td>₹{parseFloat(req.amount || 0).toFixed(2)}</td>
                      <td className="text-xs">{req.referral_code || '-'}</td>
                      <td className="text-xs">{req.created_at ? new Date(req.created_at).toLocaleDateString() : '-'}</td>
                      <td>
                        <span className={`badge ${
                          req.status === 'approved' ? 'badge-success' :
                          req.status === 'rejected' ? 'badge-danger' :
                          'badge-warning'
                        }`}>{req.status}</span>
                      </td>
                      <td>
                        {req.status === 'pending' ? (
                          <div className="flex gap-xs">
                            <button
                              className="btn btn-sm btn-success"
                              onClick={() => handleApprove(req.id)}
                              disabled={processingId === req.id}
                            >{processingId === req.id ? '...' : 'Approve'}</button>
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={() => setRejectModal(req.id)}
                              disabled={processingId === req.id}
                            >Reject</button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted">{req.admin_id ? `by ${req.admin_id}` : ''}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {rejectModal && (
          <div className="modal-overlay" onClick={() => { setRejectModal(null); setRejectReason(''); }}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
              <div className="modal-header">
                <h3>Reject Upgrade Request</h3>
                <button className="modal-close" onClick={() => { setRejectModal(null); setRejectReason(''); }}>✕</button>
              </div>
              <div className="modal-body">
                <div className="field">
                  <label>Reason for rejection</label>
                  <textarea
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    placeholder="Enter rejection reason..."
                    rows={3}
                  />
                </div>
                <div className="flex gap-sm" style={{ marginTop: '1rem' }}>
                  <button className="btn btn-danger" onClick={() => handleReject(rejectModal)} disabled={processingId === rejectModal}>
                    {processingId === rejectModal ? 'Rejecting...' : 'Confirm Reject'}
                  </button>
                  <button className="btn btn-outline" onClick={() => { setRejectModal(null); setRejectReason(''); }}>Cancel</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
