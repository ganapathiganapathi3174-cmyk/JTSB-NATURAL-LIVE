import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminSidebar from '../components/AdminSidebar.jsx';

const FUNCTIONS_URL = import.meta.env.VITE_FUNCTIONS_URL || '';
const ADMIN_KEY = 'fb_admin_token';

export default function FirebaseAdminUPIPaymentsPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem(ADMIN_KEY);
    if (!token) { navigate('/fb-admin', { replace: true }); return; }
    try {
      const d = JSON.parse(atob(token));
      if (!d.expiresAt || Date.now() > d.expiresAt) {
        localStorage.removeItem(ADMIN_KEY);
        navigate('/fb-admin', { replace: true });
      }
    } catch { navigate('/fb-admin', { replace: true }); }
  }, [navigate]);

  const [payments, setPayments] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(null);
  const [deleteMsg, setDeleteMsg] = useState('');
  const deleteMsgTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (deleteMsgTimeoutRef.current) clearTimeout(deleteMsgTimeoutRef.current);
    };
  }, []);
  const [processingResult, setProcessingResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [logs, setLogs] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteError, setDeleteError] = useState('');

  const processPending = useCallback(async () => {
    setProcessing(true);
    try {
      const res = await fetch(`${FUNCTIONS_URL}/processPendingPayments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await res.json();
      if (res.ok) {
        setProcessingResult(data);
        if (data.processed > 0) {
          const entry = {
            time: new Date().toLocaleTimeString(),
            processed: data.processed,
            approved: data.approved,
            rejected: data.rejected,
            manualReview: data.manualReview,
          };
          setLogs(prev => [entry, ...prev].slice(0, 50));
        }
      }
    } catch {}
    setProcessing(false);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [payRes, statsRes] = await Promise.all([
        fetch(`${FUNCTIONS_URL}/getUPIPayments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(typeFilter && { type: typeFilter }),
            ...(statusFilter && { status: statusFilter }),
            ...(searchText.trim() && { search: searchText.trim() }),
          }),
        }),
        fetch(`${FUNCTIONS_URL}/getUPIDashboardStats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }),
      ]);
      const payData = await payRes.json();
      if (!payRes.ok) throw new Error(payData.error || 'Failed to load payments');
      const statsData = await statsRes.json();
      if (!statsRes.ok) throw new Error(statsData.error || 'Failed to load stats');
      setPayments(payData.payments || []);
      setStats(statsData);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, statusFilter, searchText]);

  useEffect(() => {
    Promise.all([processPending(), fetchData()]).catch(() => {});
    const t = setInterval(() => { processPending().catch(() => {}); fetchData().catch(() => {}); }, 30000);
    return () => clearInterval(t);
  }, [processPending, fetchData]);

  function getAdminToken() {
    return localStorage.getItem(ADMIN_KEY);
  }

  async function handleDelete(utr) {
    setDeleteTarget(utr);
    setDeleteReason('');
    setDeleteError('');
  }

  async function confirmDelete() {
    const utr = deleteTarget;
    if (!utr) return;
    if (!deleteReason.trim()) {
      setDeleteError('Please enter a reason for deletion');
      return;
    }
    setDeleteLoading(utr);
    setError('');
    setDeleteMsg('');
    setDeleteError('');
    try {
      const adminToken = getAdminToken();
      if (!adminToken) {
        setDeleteError('Session expired. Please re-login.');
        setDeleteLoading(null);
        setDeleteTarget(null);
        return;
      }
      const res = await fetch(`${FUNCTIONS_URL}/adminDeleteRecord`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: utr,
          recordType: 'upi_payment',
          reason: deleteReason.trim(),
          adminToken,
        }),
      });
      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error('Server returned an empty response. Check that the API server is running (port 3001).');
      }
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setPayments(prev => prev.filter(p => p.utr !== utr));
      setDeleteMsg('Deleted: ' + utr);
      setDeleteTarget(null);
      setDeleteReason('');
      fetchData();
      if (deleteMsgTimeoutRef.current) clearTimeout(deleteMsgTimeoutRef.current);
      deleteMsgTimeoutRef.current = setTimeout(() => setDeleteMsg(''), 3000);
    } catch (e) {
      const msg = e.message || 'Delete failed';
      if (msg.includes('Authentication required') || msg.includes('Token verification failed')) {
        setDeleteError('Authentication error. Please re-login as admin.');
      } else if (msg.includes('Permission denied')) {
        setDeleteError('Permission denied. Only admins can delete records.');
      } else if (msg.includes('not found')) {
        setDeleteError('Record not found. It may have been already deleted.');
      } else {
        setDeleteError(msg);
      }
    } finally {
      setDeleteLoading(null);
    }
  }

  function handleExport() {
    const headers = ['UTR', 'Type', 'Amount', 'Payment Date', 'User ID', 'Status', 'Verified At', 'Rejection Reasons'];
    const rows = payments.map(p => [
      p.utr, p.type, p.amount, p.paymentDate, p.userId || '—', p.status, p.verifiedAt || '—',
      (p.rejectionReasons || []).join('; '),
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `upi-payments-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function getStatusBadgeClass(status) {
    if (status === 'verified') return 'badge badge-success';
    if (status === 'rejected') return 'badge badge-error';
    if (status === 'manual_review') return 'badge badge-warning';
    return 'badge badge-pending';
  }

  return (
    <div className="admin-layout">
      <AdminSidebar />
      <main className="admin-main">
        <div className="admin-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>UPI Payment Monitor</h1>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {processing && <span style={{ fontSize: '0.85rem', color: '#f59e0b' }}>⏳ Processing...</span>}
            {processingResult && processingResult.processed > 0 && (
              <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                +{processingResult.approved} approved / {processingResult.rejected} rejected
                {processingResult.manualReview > 0 && (
                  <> / <span style={{ color: '#f59e0b' }}>{processingResult.manualReview} manual review</span></>
                )}
              </span>
            )}
            {deleteMsg && <span style={{ color: 'var(--success, #16a34a)', fontSize: '0.85rem' }}>{deleteMsg}</span>}
            <button onClick={handleExport} className="btn btn-secondary" style={{ fontSize: '0.85rem' }}>Export CSV</button>
            <button onClick={() => processPending().then(fetchData)} className="btn btn-primary" style={{ fontSize: '0.85rem' }}>
              {processing ? '...' : 'Refresh'}
            </button>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {stats && (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem',
          }}>
            {[
              { label: 'Total Users', value: stats.totalUsers, color: '#4f46e5' },
              { label: 'Pending', value: stats.pendingPayments, color: '#f59e0b' },
              { label: 'Approved', value: stats.verifiedPayments, color: '#16a34a' },
              { label: 'Rejected', value: stats.rejectedPayments, color: '#dc2626' },
              { label: 'Manual Review', value: stats.manualReviewPayments, color: '#f97316' },
              { label: 'Registration', value: stats.registrationPayments, color: '#0891b2' },
              { label: 'Topup', value: stats.topupPayments, color: '#7c3aed' },
            ].map(s => (
              <div key={s.label} style={{
                background: '#fff', borderRadius: '10px', padding: '1rem', border: '1px solid var(--border, #e5e7eb)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              }}>
                <div style={{ fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {logs.length > 0 && (
          <details style={{ marginBottom: '1rem' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem', color: '#374151' }}>
              Verification Logs ({logs.length})
            </summary>
            <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: '0.5rem', fontSize: '0.8rem' }}>
              {logs.map((l, i) => (
                <div key={i} style={{ padding: '0.25rem 0.5rem', borderBottom: '1px solid #f3f4f6' }}>
                  <span style={{ color: '#6b7280' }}>[{l.time}]</span>{' '}
                  Processed {l.processed} →{' '}
                  <span style={{ color: '#16a34a' }}>{l.approved} approved</span>
                  {' / '}
                  <span style={{ color: '#dc2626' }}>{l.rejected} rejected</span>
                  {l.manualReview > 0 && (
                    <> / <span style={{ color: '#f97316' }}>{l.manualReview} manual review</span></>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}

        <div className="filter-bar" style={{
          display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center',
        }}>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={selectStyle}>
            <option value="">All Types</option>
            <option value="registration">Registration</option>
            <option value="topup">Topup</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
            <option value="">All Status</option>
            <option value="verified">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="manual_review">Manual Review</option>
            <option value="pending">Pending</option>
          </select>
          <input
            type="text"
            placeholder="Search by UTR or User ID..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') fetchData(); }}
            style={{ ...inputStyle, flex: 1, minWidth: '200px' }}
          />
        </div>

        {loading && <div className="loading-spinner loading-spinner-lg" />}

        {!loading && !error && (
          <div style={{ overflowX: 'auto' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>UTR</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Date</th>
                  <th>User</th>
                  <th>Screenshot</th>
                  <th>Status</th>
                  <th>Reasons</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 && (
                  <tr><td colSpan={9} style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>No payments found</td></tr>
                )}
                {payments.map(p => {
                  const reasons = p.rejectionReasons || [];
                  return (
                    <tr key={p.utr}>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{p.utr}</td>
                      <td><span className={`badge badge-${p.type}`}>{p.type}</span></td>
                      <td>₹{p.amount}</td>
                      <td style={{ fontSize: '0.85rem' }}>{p.paymentDate}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.85rem', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.userId || '—'}
                      </td>
                      <td>
                        {p.screenshotUrl ? (
                          <img
                            src={p.screenshotUrl}
                            alt="Screenshot"
                            onClick={() => setLightboxUrl(p.screenshotUrl)}
                            style={{
                              width: 48, height: 48, objectFit: 'cover', borderRadius: '6px',
                              cursor: 'pointer', border: '1px solid var(--border, #d1d5db)',
                            }}
                          />
                        ) : (
                          <span style={{ color: '#999', fontSize: '0.85rem' }}>—</span>
                        )}
                      </td>
                      <td><span className={getStatusBadgeClass(p.status)}>{p.status === 'verified' ? 'Approved' : p.status === 'manual_review' ? 'Manual Review' : p.status}</span></td>
                      <td style={{ fontSize: '0.8rem', maxWidth: '200px' }}>
                        {reasons.length > 0 ? (
                          <ul style={{ margin: 0, paddingLeft: '1rem' }}>
                            {reasons.map((r, i) => <li key={i}>{r}</li>)}
                          </ul>
                        ) : <span style={{ color: '#999' }}>—</span>}
                      </td>
                      <td>
                        <button
                          onClick={() => handleDelete(p.utr)}
                          disabled={deleteLoading === p.utr}
                          className="btn btn-ghost btn-sm"
                          style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', color: '#ef4444' }}
                        >
                          {deleteLoading === p.utr ? '...' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {deleteTarget && (
          <div
            className="modal-modern-overlay"
            onClick={() => { if (!deleteLoading) { setDeleteTarget(null); setDeleteError(''); } }}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 9998, padding: '1rem',
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: '#fff', borderRadius: '12px', padding: '1.5rem',
                maxWidth: '480px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Confirm Delete</h2>
                <button
                  onClick={() => { setDeleteTarget(null); setDeleteError(''); }}
                  disabled={deleteLoading}
                  style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#888' }}
                >
                  {'\u2715'}
                </button>
              </div>
              <p style={{ fontSize: '0.95rem', color: '#374151', marginBottom: '0.5rem' }}>
                Are you sure you want to delete this record?
              </p>
              <div style={{
                background: '#fef2f2', borderRadius: '8px', padding: '0.75rem',
                marginBottom: '1rem', fontSize: '0.85rem', color: '#991b1b',
              }}>
                <strong>{'\u26A0\uFE0F'} Warning:</strong> This will permanently delete the record
                <strong> {deleteTarget}</strong> from the database.
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#374151', marginBottom: '0.3rem' }}>
                  Reason for deletion *
                </label>
                <textarea
                  value={deleteReason}
                  onChange={e => { setDeleteReason(e.target.value); setDeleteError(''); }}
                  placeholder="Why is this record being deleted?"
                  rows={3}
                  disabled={deleteLoading}
                  style={{
                    width: '100%', padding: '0.5rem 0.75rem', borderRadius: '8px',
                    border: '1px solid var(--border, #d1d5db)', fontSize: '0.9rem',
                    resize: 'vertical', boxSizing: 'border-box',
                  }}
                />
              </div>
              {deleteError && (
                <div style={{
                  background: '#fef2f2', color: '#dc2626', borderRadius: '8px',
                  padding: '0.5rem 0.75rem', marginBottom: '0.75rem', fontSize: '0.85rem',
                }}>
                  {deleteError}
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => { setDeleteTarget(null); setDeleteError(''); }}
                  disabled={deleteLoading}
                  className="btn btn-ghost"
                  style={{ fontSize: '0.9rem' }}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={deleteLoading || !deleteReason.trim()}
                  className="btn"
                  style={{
                    fontSize: '0.9rem',
                    background: deleteLoading ? '#ccc' : '#dc2626',
                    color: '#fff', border: 'none', borderRadius: '8px',
                    padding: '0.5rem 1.25rem', cursor: deleteLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {deleteLoading ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {lightboxUrl && (
          <div
            onClick={() => setLightboxUrl(null)}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 9999, cursor: 'pointer', padding: '2rem',
            }}
          >
            <img
              src={lightboxUrl}
              alt="Screenshot full view"
              style={{ maxWidth: '90%', maxHeight: '90%', borderRadius: '8px' }}
            />
          </div>
        )}
      </main>
    </div>
  );
}

const selectStyle = {
  padding: '0.5rem 0.75rem',
  borderRadius: '8px',
  border: '1px solid var(--border, #d1d5db)',
  background: '#fff',
  fontSize: '0.9rem',
};
const inputStyle = {
  padding: '0.5rem 0.75rem',
  borderRadius: '8px',
  border: '1px solid var(--border, #d1d5db)',
  fontSize: '0.9rem',
};
