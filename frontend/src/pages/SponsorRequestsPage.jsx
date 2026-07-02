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

      const res = await fetch(`${API_BASE}/handleSponsorTransfer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #0f0c29, #302b63, #24243e)', color: '#fff', padding: '2rem' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 'bold', margin: 0 }}>Sponsor Transfer Requests</h1>
          <button onClick={() => navigate('/fb/dashboard')}
            style={{ padding: '0.5rem 1rem', background: '#374151', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer' }}>
            Back to Dashboard
          </button>
        </div>

        {error && <div style={{ padding: '1rem', background: 'rgba(239,68,68,0.2)', border: '1px solid #ef4444', borderRadius: '0.5rem', marginBottom: '1rem' }}>{error}</div>}
        {successMsg && <div style={{ padding: '1rem', background: 'rgba(34,197,94,0.2)', border: '1px solid #22c55e', borderRadius: '0.5rem', marginBottom: '1rem' }}>{successMsg}</div>}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '4rem' }}><div className="loading-spinner loading-spinner-lg" /></div>
        ) : requests.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem', background: '#1e1b4b', borderRadius: '1rem' }}>
            <p style={{ fontSize: '1.25rem', color: '#9ca3af' }}>No pending transfer requests</p>
            <p style={{ color: '#6b7280', marginTop: '0.5rem' }}>Users will appear here when they request you as their sponsor</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {requests.map(req => (
              <div key={req.id} style={{ background: '#1e1b4b', borderRadius: '1rem', padding: '1.5rem', border: '1px solid #4c1d95' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                  <div>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: '600', margin: 0 }}>{req.userName || 'User'}</h3>
                    <p style={{ color: '#9ca3af', margin: '0.25rem 0 0 0' }}>{req.userEmail}</p>
                  </div>
                  <span style={{ background: '#f59e0b20', color: '#f59e0b', padding: '0.25rem 0.75rem', borderRadius: '1rem', fontSize: '0.875rem' }}>
                    Plan: ₹{req.userPlan}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.25rem', fontSize: '0.875rem' }}>
                  <div><span style={{ color: '#9ca3af' }}>Phone:</span> {req.userPhone || 'N/A'}</div>
                  <div><span style={{ color: '#9ca3af' }}>Referral Code:</span> <span style={{ fontFamily: 'monospace' }}>{req.userReferralCode || 'N/A'}</span></div>
                  <div><span style={{ color: '#9ca3af' }}>Requested:</span> {req.requestedAt ? new Date(req.requestedAt).toLocaleString() : 'N/A'}</div>
                  <div><span style={{ color: '#9ca3af' }}>Old Sponsor Code:</span> {req.oldSponsorCode || 'None'}</div>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button onClick={() => handleAction(req.id, 'accept')} disabled={processingId === req.id}
                    style={{ flex: 1, padding: '0.75rem', background: processingId === req.id ? '#6b7280' : '#22c55e', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: '600' }}>
                    {processingId === req.id ? 'Processing...' : 'Accept'}
                  </button>
                  <button onClick={() => setShowRejectInput(showRejectInput === req.id ? null : req.id)}
                    style={{ flex: 1, padding: '0.75rem', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: '600' }}>
                    Reject
                  </button>
                </div>
                {showRejectInput === req.id && (
                  <div style={{ marginTop: '1rem' }}>
                    <textarea value={rejectionReason} onChange={e => setRejectionReason(e.target.value)}
                      placeholder="Reason for rejection (optional)"
                      style={{ width: '100%', padding: '0.75rem', background: '#2e1065', color: '#fff', border: '1px solid #4c1d95', borderRadius: '0.5rem', marginBottom: '0.5rem', resize: 'vertical' }} rows={2} />
                    <button onClick={() => handleAction(req.id, 'reject')} disabled={processingId === req.id}
                      style={{ padding: '0.5rem 1.5rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer' }}>
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
