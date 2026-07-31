import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';

export default function SponsorRequestsPage() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [processingId, setProcessingId] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(null);

  useEffect(() => {
    const uid = localStorage.getItem('fb_user_id');
    if (!uid) { navigate('/fb/login'); return; }
    setUserId(uid);
    loadRequests(uid);
  }, []);

  async function loadRequests(uid) {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/getSponsorRequests`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sponsorId: uid }),
      });
      const data = await res.json();
      if (data.success) setRequests(data.requests || []);
      else setError(data.error || 'Failed to load requests');
    } catch (e) { setError('Connection error: ' + e.message); }
    setLoading(false);
  }

  async function handleAction(requestId, action) {
    setProcessingId(requestId);
    setError('');
    setSuccessMsg('');
    try {
      const body = { requestId, action };
      if (action === 'reject') body.rejectionReason = rejectionReason || 'Declined';

      const headers = { 'Content-Type': 'application/json' };
      const adminToken = localStorage.getItem('fb_admin_token');
      if (adminToken) headers['Authorization'] = 'Bearer ' + adminToken;
      const uid = localStorage.getItem('fb_user_id');
      if (uid) headers['x-user-id'] = uid;

      const res = await fetch(`${API_BASE}/handleSponsorTransfer`, {
        method: 'POST', headers,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) { setError(data.error || 'Action failed'); }
      else {
        setSuccessMsg(action === 'accept' ? 'Transfer approved successfully!' : 'Transfer request declined.');
        setRequests(prev => prev.filter(r => r.id !== requestId));
        setShowRejectInput(null);
        setRejectionReason('');
      }
    } catch (e) { setError('Connection error: ' + e.message); }
    setProcessingId(null);
  }

  return (
    <div className="page-wrap animate-fade-in-up">
      <div className="glass-strong" style={{ maxWidth: '900px', margin: '0 auto', padding: '1.5rem', borderRadius: 'var(--radius-lg)' }}>
        <div className="flex items-center justify-between mb-lg" style={{ flexWrap: 'wrap', gap: '1rem' }}>
          <h1 className="text-xl font-bold m-0 text-gradient">Sponsor Transfer Requests</h1>
          <button onClick={() => navigate('/fb/dashboard')} className="btn btn-ghost btn-sm">Back to Dashboard</button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {successMsg && <div className="alert alert-success">{successMsg}</div>}

        {loading ? (
          <div className="flex flex-col items-center gap-md" style={{ padding: '2rem' }}>
            <div className="loading-spinner loading-spinner-lg" />
          </div>
        ) : requests.length === 0 ? (
          <div className="glass card text-center" style={{ padding: '2.5rem' }}>
            <p className="text-lg text-muted">No pending transfer requests</p>
            <p className="text-sm text-muted mt-sm">Users will appear here when they request you as their sponsor</p>
          </div>
        ) : (
          <div className="flex flex-col gap-md">
            {requests.map(req => (
                <div key={req.id} className="glass card">
                  <div className="flex items-start justify-between mb-md" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                      <h3 className="text-lg font-semibold m-0 text-gradient">{req.userName || 'User'}</h3>
                    <p className="text-sm text-muted m-0 mt-xs">{req.userEmail}</p>
                  </div>
                  <span className="badge badge-warning">Plan: ₹{req.userPlan}</span>
                </div>
                <div className="detail-grid-sm mb-lg" style={{ fontSize: '0.875rem' }}>
                  <div className="detail-item"><span className="detail-label">Phone</span><span>{req.userPhone || 'N/A'}</span></div>
                  <div className="detail-item"><span className="detail-label">Referral Code</span><span style={{ fontFamily: 'monospace' }}>{req.userReferralCode || 'N/A'}</span></div>
                  <div className="detail-item"><span className="detail-label">Requested</span><span>{req.requestedAt ? new Date(req.requestedAt).toLocaleString() : 'N/A'}</span></div>
                  <div className="detail-item"><span className="detail-label">Old Sponsor Code</span><span>{req.oldSponsorCode || 'None'}</span></div>
                </div>
                <div className="flex gap-md">
                  <button onClick={() => handleAction(req.id, 'accept')} disabled={processingId === req.id}
                    className="btn btn-success flex-1 btn-sm">
                    {processingId === req.id ? 'Processing...' : 'Accept'}
                  </button>
                  <button onClick={() => setShowRejectInput(showRejectInput === req.id ? null : req.id)}
                    className="btn btn-danger flex-1 btn-sm">
                    Reject
                  </button>
                </div>
                {showRejectInput === req.id && (
                  <div className="mt-md">
                    <textarea value={rejectionReason} onChange={e => setRejectionReason(e.target.value)}
                      placeholder="Reason for rejection (optional)"
                      className="field-glass" rows={2} />
                    <button onClick={() => handleAction(req.id, 'reject')} disabled={processingId === req.id}
                      className="btn btn-danger btn-sm mt-sm">
                      Confirm Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
