import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';

export default function SponsorMarketplacePage() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState(null);
  const [plan, setPlan] = useState(0);
  const [sponsors, setSponsors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [requestingId, setRequestingId] = useState(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [myRequests, setMyRequests] = useState([]);
  const [showMyRequests, setShowMyRequests] = useState(false);

  useEffect(() => {
    const uid = localStorage.getItem('fb_user_id');
    if (!uid) { navigate('/fb/login'); return; }
    setUserId(uid);
    loadMarketplace(uid);
    loadMyRequests(uid);
  }, []);

  async function loadMarketplace(uid) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/getSponsorMarketplace`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: uid }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.error || 'Failed to load marketplace'); }
      else { setSponsors(data.sponsors || []); setPlan(data.plan || 0); }
    } catch (e) { setError('Connection error: ' + e.message); }
    setLoading(false);
  }

  async function loadMyRequests(uid) {
    try {
      const res = await fetch(`${API_BASE}/getUserSponsorInfo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: uid }),
      });
      const data = await res.json();
      if (data.success) {
        setMyRequests((data.transferHistory || []).filter(r => r.status === 'pending'));
      }
    } catch (e) {}
  }

  async function handleRequest(sponsorId) {
    setRequestingId(sponsorId);
    setError('');
    setSuccessMsg('');
    try {
      const res = await fetch(`${API_BASE}/createSponsorTransfer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, newSponsorId: sponsorId }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.error || 'Request failed'); }
      else {
        setSuccessMsg('Sponsor transfer request sent successfully!');
        setSponsors(prev => prev.filter(s => s.id !== sponsorId));
      }
    } catch (e) { setError('Connection error: ' + e.message); }
    setRequestingId(null);
  }

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #0f0c29, #302b63, #24243e)', color: '#fff', padding: '2rem' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <div>
            <h1 style={{ fontSize: '2rem', fontWeight: 'bold', margin: 0 }}>Sponsor Marketplace</h1>
            {plan > 0 && <p style={{ color: '#a78bfa', marginTop: '0.5rem' }}>Your Plan: ₹{plan}</p>}
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button onClick={() => setShowMyRequests(!showMyRequests)}
              style={{ padding: '0.5rem 1rem', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer' }}>
              My Requests {myRequests.length > 0 && `(${myRequests.length})`}
            </button>
            <button onClick={() => navigate('/fb/dashboard')}
              style={{ padding: '0.5rem 1rem', background: '#374151', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer' }}>
              Back to Dashboard
            </button>
          </div>
        </div>

        {error && <div style={{ padding: '1rem', background: 'rgba(239,68,68,0.2)', border: '1px solid #ef4444', borderRadius: '0.5rem', marginBottom: '1rem' }}>{error}</div>}
        {successMsg && <div style={{ padding: '1rem', background: 'rgba(34,197,94,0.2)', border: '1px solid #22c55e', borderRadius: '0.5rem', marginBottom: '1rem' }}>{successMsg}</div>}

        {showMyRequests && (
          <div style={{ background: '#1e1b4b', borderRadius: '1rem', padding: '1.5rem', marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '1rem' }}>My Pending Transfer Requests</h2>
            {myRequests.length === 0 ? (
              <p style={{ color: '#9ca3af' }}>No pending requests</p>
            ) : (
              myRequests.map(r => (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem', background: '#2e1065', borderRadius: '0.5rem', marginBottom: '0.5rem' }}>
                  <span>Sponsor: {r.newSponsorName} — ₹{r.plan}</span>
                  <span style={{ color: '#f59e0b' }}>Pending</span>
                </div>
              ))
            )}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '4rem' }}><div className="loading-spinner loading-spinner-lg" /><p style={{ marginTop: '1rem', color: '#9ca3af' }}>Loading sponsors...</p></div>
        ) : sponsors.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem', background: '#1e1b4b', borderRadius: '1rem' }}>
            <p style={{ fontSize: '1.25rem', color: '#9ca3af' }}>No sponsors available for ₹{plan} plan</p>
            <p style={{ color: '#6b7280', marginTop: '0.5rem' }}>Check back later or upgrade your plan</p>
            <button onClick={() => navigate('/fb/dashboard')}
              style={{ marginTop: '1rem', padding: '0.75rem 2rem', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer' }}>
              Back to Dashboard
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
            {sponsors.map(sponsor => (
              <div key={sponsor.id} style={{ background: '#1e1b4b', borderRadius: '1rem', padding: '1.5rem', border: '1px solid #4c1d95' }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '1rem' }}>{sponsor.name || 'Sponsor'}</h3>
                <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#9ca3af' }}>User ID</span>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>{sponsor.id?.slice(0, 8)}...</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#9ca3af' }}>Plan</span>
                    <span style={{ color: '#a78bfa', fontWeight: '600' }}>₹{sponsor.plan}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#9ca3af' }}>Referrals</span>
                    <span>{sponsor.referralsCount}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#9ca3af' }}>Status</span>
                    <span style={{ color: '#22c55e' }}>{sponsor.status}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#9ca3af' }}>Joined</span>
                    <span style={{ fontSize: '0.875rem' }}>{sponsor.joinedDate ? new Date(sponsor.joinedDate).toLocaleDateString() : 'N/A'}</span>
                  </div>
                </div>
                <button onClick={() => handleRequest(sponsor.id)} disabled={requestingId === sponsor.id}
                  style={{ width: '100%', padding: '0.75rem', background: requestingId === sponsor.id ? '#6b7280' : '#7c3aed', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: '600' }}>
                  {requestingId === sponsor.id ? 'Sending...' : 'Request Sponsor Transfer'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
