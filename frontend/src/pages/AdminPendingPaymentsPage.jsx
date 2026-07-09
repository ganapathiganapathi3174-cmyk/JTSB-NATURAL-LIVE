import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';

export default function AdminPendingPaymentsPage() {
  const navigate = useNavigate();
  const [payments, setPayments] = useState([]);
  const [stats, setStats] = useState({ pending: 0, expired: 0, verified: 0, rejected: 0, manual_review: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [timeoutMinutes, setTimeoutMinutes] = useState(10);
  const [isLive, setIsLive] = useState(false);
  const [filter, setFilter] = useState('');

  const sseRef = useRef(null);
  const loadTimerRef = useRef(null);

  const getToken = useCallback(() => localStorage.getItem('fb_admin_token'), []);

  async function loadPayments() {
    try {
      const token = getToken();
      const res = await fetch(`${API_BASE}/getPendingPaymentsQueue`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setPayments(data.payments || []);
        setStats(data.stats || { pending: 0, expired: 0, verified: 0, rejected: 0, manual_review: 0 });
        setTimeoutMinutes(data.timeoutMinutes || 10);
      }
    } catch (e) { setError('Failed to load: ' + e.message); }
    setLoading(false);
  }

  useEffect(() => {
    loadPayments();
    const token = getToken();
    if (!token) return;

    const eventSource = new EventSource(`${API_BASE}/sse/dashboard?token=${encodeURIComponent(token)}`);

    eventSource.addEventListener('paymentCreated', () => { loadPayments(); });
    eventSource.addEventListener('paymentUpdated', () => { loadPayments(); });
    eventSource.addEventListener('paymentExpired', () => { loadPayments(); });
    eventSource.addEventListener('paymentApproved', () => { loadPayments(); });
    eventSource.addEventListener('open', () => { setIsLive(true); });
    eventSource.addEventListener('error', () => { setIsLive(false); });

    sseRef.current = eventSource;
    loadTimerRef.current = setInterval(loadPayments, 30000);

    return () => {
      if (sseRef.current) sseRef.current.close();
      if (loadTimerRef.current) clearInterval(loadTimerRef.current);
    };
  }, []);

  const statusStyle = (status) => {
    const s = status?.toLowerCase() || '';
    if (s === 'verified' || s === 'approved') return { background: '#22c55e20', color: '#22c55e', border: '1px solid #22c55e' };
    if (s === 'expired') return { background: '#ef444420', color: '#ef4444', border: '1px solid #ef4444' };
    if (s === 'rejected') return { background: '#ef444420', color: '#ef4444', border: '1px solid #ef4444' };
    if (s === 'pending') return { background: '#f59e0b20', color: '#f59e0b', border: '1px solid #f59e0b' };
    if (s === 'manual_review') return { background: '#f9731620', color: '#f97316', border: '1px solid #f97316' };
    return { background: '#6b728020', color: '#6b7280' };
  };

  const displayStatus = (s) => {
    if (s === 'verified') return 'Approved';
    if (s === 'manual_review') return 'Manual Review';
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Unknown';
  };

  const filteredPayments = filter
    ? payments.filter(p => p.status === filter)
    : payments;

  const statCards = [
    { label: 'Pending', value: stats.pending || 0, color: '#f59e0b' },
    { label: 'Verified', value: stats.verified || 0, color: '#22c55e' },
    { label: 'Manual Review', value: stats.manual_review || 0, color: '#f97316' },
    { label: 'Expired', value: stats.expired || 0, color: '#ef4444' },
    { label: 'Rejected', value: stats.rejected || 0, color: '#dc2626' },
  ];

  return (
    <div className="admin-page" style={{ padding: '2rem' }}>
      <div className="admin-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>Pending Payment Queue</h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Auto-expires after {timeoutMinutes} minutes
            {isLive
              ? <span style={{ color: '#22c55e', marginLeft: '0.5rem' }}>● Live</span>
              : <span style={{ color: '#ef4444', marginLeft: '0.5rem' }}>○ Disconnected</span>
            }
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={loadPayments} className="btn btn-secondary">Refresh</button>
          <button onClick={() => navigate('/fb-admin/dashboard')} className="btn btn-secondary">Dashboard</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {statCards.map(card => (
          <div key={card.label} style={{
            flex: 1, minWidth: 120, padding: '1rem', borderRadius: '0.5rem',
            background: `${card.color}15`, border: `1px solid ${card.color}40`,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: card.color }}>{card.value}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.25rem' }}>{card.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setFilter('')} className={`btn ${!filter ? 'btn-primary' : 'btn-secondary'}`}>All</button>
        <button onClick={() => setFilter('pending')} className={`btn ${filter === 'pending' ? 'btn-primary' : 'btn-secondary'}`}>Pending</button>
        <button onClick={() => setFilter('verified')} className={`btn ${filter === 'verified' ? 'btn-primary' : 'btn-secondary'}`}>Approved</button>
        <button onClick={() => setFilter('manual_review')} className={`btn ${filter === 'manual_review' ? 'btn-primary' : 'btn-secondary'}`}>Manual Review</button>
        <button onClick={() => setFilter('expired')} className={`btn ${filter === 'expired' ? 'btn-primary' : 'btn-secondary'}`}>Expired</button>
        <button onClick={() => setFilter('rejected')} className={`btn ${filter === 'rejected' ? 'btn-primary' : 'btn-secondary'}`}>Rejected</button>
      </div>

      {loading ? <div className="loading-spinner loading-spinner-lg" /> :
      error ? <div className="error-message">{error}</div> :
      filteredPayments.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
          <p style={{ fontSize: '1.1rem' }}>No payments found</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Type</th>
                <th>Plan</th>
                <th>UTR</th>
                <th>Status</th>
                <th>Created</th>
                <th>Elapsed</th>
                <th>Remaining</th>
              </tr>
            </thead>
            <tbody>
              {filteredPayments.map(p => (
                <tr key={p.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{p.userName}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{p.userEmail}</div>
                    <div style={{ fontSize: '0.7rem', fontFamily: 'monospace', color: '#9ca3af' }}>
                      {p.userId?.slice(0, 12)}...
                    </div>
                  </td>
                  <td>
                    <span className="badge" style={{ background: p.type === 'registration' ? '#3b82f620' : '#8b5cf620', color: p.type === 'registration' ? '#3b82f6' : '#8b5cf6' }}>
                      {p.type}
                    </span>
                  </td>
                  <td><strong>₹{p.amount}</strong></td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{p.utr?.slice(0, 16) || '-'}</td>
                  <td>
                    <span className="badge" style={statusStyle(p.status)}>
                      {displayStatus(p.status)}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.85rem' }}>
                    {p.createdAt ? new Date(p.createdAt).toLocaleString() : '-'}
                  </td>
                  <td style={{ fontSize: '0.85rem' }}>
                    {p.elapsedMinutes?.toFixed(1)}m
                  </td>
                  <td style={{ fontSize: '0.85rem', color: p.remainingMinutes <= 2 ? '#ef4444' : 'var(--muted)' }}>
                    {p.status === 'pending' ? `${p.remainingMinutes?.toFixed(1)}m` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
