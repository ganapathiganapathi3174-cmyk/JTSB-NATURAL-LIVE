import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';

export default function AdminSponsorTransfersPage() {
  const navigate = useNavigate();
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState({ pending: 0, approved: 0, rejected: 0 });

  async function loadTransfers(statusFilter, searchQuery) {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('fb_admin_token');
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (searchQuery) params.set('search', searchQuery);

      const res = await fetch(`${API_BASE}/getAdminSponsorTransfers?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!data.success) { setError(data.error || 'Failed to load'); }
      else { setTransfers(data.transfers || []); setStats(data.counts || { pending: 0, approved: 0, rejected: 0 }); }
    } catch (e) { setError('Connection error: ' + e.message); }
    setLoading(false);
  }

  useEffect(() => { loadTransfers(filter, search); }, [filter, search]);

  function handleSearch() { loadTransfers(filter, search); }

  return (
    <div className="admin-page" style={{ padding: '2rem' }}>
      <div className="admin-header">
        <h1>Sponsor Transfers</h1>
        <button onClick={() => navigate('/fb-admin/dashboard')} className="btn btn-secondary">Back to Dashboard</button>
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ flex: 1, padding: '1rem', background: '#f59e0b20', borderRadius: '0.5rem' }}>
          <strong style={{ color: '#f59e0b' }}>Pending</strong>
          <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{stats.pending}</div>
        </div>
        <div style={{ flex: 1, padding: '1rem', background: '#22c55e20', borderRadius: '0.5rem' }}>
          <strong style={{ color: '#22c55e' }}>Approved</strong>
          <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{stats.approved}</div>
        </div>
        <div style={{ flex: 1, padding: '1rem', background: '#ef444420', borderRadius: '0.5rem' }}>
          <strong style={{ color: '#ef4444' }}>Rejected</strong>
          <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{stats.rejected}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setFilter('')} className={`btn ${!filter ? 'btn-primary' : 'btn-secondary'}`}>All</button>
        <button onClick={() => setFilter('pending')} className={`btn ${filter === 'pending' ? 'btn-primary' : 'btn-secondary'}`}>Pending</button>
        <button onClick={() => setFilter('approved')} className={`btn ${filter === 'approved' ? 'btn-primary' : 'btn-secondary'}`}>Approved</button>
        <button onClick={() => setFilter('rejected')} className={`btn ${filter === 'rejected' ? 'btn-primary' : 'btn-secondary'}`}>Rejected</button>
        <div style={{ flex: 1 }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or email" style={{ padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.25rem' }} />
        <button onClick={handleSearch} className="btn btn-secondary">Search</button>
      </div>

      {loading ? <div className="loading-spinner loading-spinner-lg" /> :
      error ? <div className="error-message">{error}</div> :
      transfers.length === 0 ? <p>No transfers found</p> :
      <div style={{ overflowX: 'auto' }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Old Sponsor</th>
              <th>New Sponsor</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Requested</th>
              <th>Responded</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {transfers.map(t => (
              <tr key={t.id}>
                <td>{t.userName}</td>
                <td style={{ fontSize: '0.875rem' }}>{t.userEmail}</td>
                <td>{t.oldSponsorName}</td>
                <td>{t.newSponsorName}</td>
                <td>₹{t.plan}</td>
                <td>
                  <span className={`badge badge-${t.status === 'approved' ? 'success' : t.status === 'rejected' ? 'danger' : 'warning'}`}>
                    {t.status}
                  </span>
                </td>
                <td style={{ fontSize: '0.875rem' }}>{t.requestedAt ? new Date(t.requestedAt).toLocaleString() : '-'}</td>
                <td style={{ fontSize: '0.875rem' }}>{t.respondedAt ? new Date(t.respondedAt).toLocaleString() : '-'}</td>
                <td style={{ fontSize: '0.875rem', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.rejectionReason || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </div>
  );
}
