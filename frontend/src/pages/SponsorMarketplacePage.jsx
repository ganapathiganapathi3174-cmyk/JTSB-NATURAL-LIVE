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
    <div className="page-wrap">
      <div className="card-glass" style={{ maxWidth: '1200px', margin: '0 auto', padding: '1.5rem' }}>
        <div className="flex items-center justify-between mb-lg" style={{ flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 className="text-xl font-bold m-0">Sponsor Marketplace</h1>
            {plan > 0 && <p className="text-sm text-muted mt-sm" style={{ color: '#A5B4FC' }}>Your Plan: ₹{plan}</p>}
          </div>
          <div className="flex gap-sm">
            <button onClick={() => setShowMyRequests(!showMyRequests)} className="btn btn-primary btn-sm">
              My Requests {myRequests.length > 0 && `(${myRequests.length})`}
            </button>
            <button onClick={() => navigate('/fb/dashboard')} className="btn btn-ghost btn-sm">
              Back to Dashboard
            </button>
          </div>
        </div>

        {error && <div className="card-dim mb-md" style={{ borderColor: 'rgba(239,68,68,0.3)', color: 'var(--danger)' }}>{error}</div>}
        {successMsg && <div className="card-dim mb-md" style={{ borderColor: 'rgba(34,197,94,0.3)', color: 'var(--success)' }}>{successMsg}</div>}

        {showMyRequests && (
          <div className="card-glass mb-lg">
            <h2 className="text-lg font-semibold mb-md">My Pending Transfer Requests</h2>
            {myRequests.length === 0 ? (
              <p className="text-muted text-sm">No pending requests</p>
            ) : (
              myRequests.map(r => (
                <div key={r.id} className="flex items-center justify-between card-dim mb-sm">
                  <span>Sponsor: {r.newSponsorName} — ₹{r.plan}</span>
                  <span className="badge badge-warning">Pending</span>
                </div>
              ))
            )}
          </div>
        )}

        {loading ? (
          <div className="text-center p-xl"><div className="loading-spinner loading-spinner-lg" /><p className="text-muted mt-md">Loading sponsors...</p></div>
        ) : sponsors.length === 0 ? (
          <div className="card-glass text-center p-xl">
            <p className="text-lg text-muted">No sponsors available for ₹{plan} plan</p>
            <p className="text-sm text-muted-2 mt-sm">Check back later or upgrade your plan</p>
            <button onClick={() => navigate('/fb/dashboard')} className="btn btn-primary mt-lg">
              Back to Dashboard
            </button>
          </div>
        ) : (
          <div className="card-grid">
            {sponsors.map(sponsor => (
              <div key={sponsor.id} className="card-glass">
                <h3 className="text-lg font-semibold mb-md">{sponsor.name || 'Sponsor'}</h3>
                <div className="flex flex-col gap-sm mb-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">User ID</span>
                    <span className="text-xs" style={{ fontFamily: 'monospace' }}>{sponsor.id?.slice(0, 8)}...</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">Plan</span>
                    <span className="font-semibold" style={{ color: '#A5B4FC' }}>₹{sponsor.plan}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">Referrals</span>
                    <span>{sponsor.referralsCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">Status</span>
                    <span className="badge badge-success">{sponsor.status}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">Joined</span>
                    <span className="text-sm">{sponsor.joinedDate ? new Date(sponsor.joinedDate).toLocaleDateString() : 'N/A'}</span>
                  </div>
                </div>
                <button onClick={() => handleRequest(sponsor.id)} disabled={requestingId === sponsor.id}
                  className="btn btn-primary btn-block btn-sm">
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
