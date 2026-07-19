import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminSidebar from '../components/AdminSidebar.jsx';

const FUNCTIONS_URL = import.meta.env.VITE_FUNCTIONS_URL || '';
const ADMIN_KEY = 'fb_admin_token';

function authHeaders() {
  const t = localStorage.getItem(ADMIN_KEY);
  return t ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t } : { 'Content-Type': 'application/json' };
}

export default function FirebaseAdminUPIPaymentsPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem(ADMIN_KEY);
    if (!token) { navigate('/fb-admin', { replace: true }); return; }
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
  const [actionLoading, setActionLoading] = useState(null);
  const [detailPayment, setDetailPayment] = useState(null);

  const processPending = useCallback(async () => {
    setProcessing(true);
    try {
      const res = await fetch(`${FUNCTIONS_URL}/processPendingPayments`, {
        method: 'POST',
        headers: authHeaders(),
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
    } catch (e) { console.error('[UPI-Payments] processPending error:', e); }
    setProcessing(false);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [payRes, statsRes] = await Promise.all([
        fetch(`${FUNCTIONS_URL}/getUPIPayments`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            ...(typeFilter && { type: typeFilter }),
            ...(statusFilter && { status: statusFilter }),
            ...(searchText.trim() && { search: searchText.trim() }),
          }),
        }),
        fetch(`${FUNCTIONS_URL}/getUPIDashboardStats`, {
          method: 'POST',
          headers: authHeaders(),
          body: '{}',
        }),
      ]);
      const payData = await payRes.json();
      if (!payRes.ok) throw new Error(payData.error || 'Failed to load payments');
      const statsData = await statsRes.json();
      if (!statsRes.ok) throw new Error(statsData.error || 'Failed to load stats');
      const raw = Array.isArray(payData) ? payData : (payData.payments || []);
      setPayments(raw.map(p => ({
        ...p, userId: p.userId || p.user_id, type: p.type || p.payment_type,
        paymentDate: p.paymentDate || p.payment_date, screenshotUrl: p.screenshotUrl || p.screenshot_url,
        userName: p.userName, userEmail: p.userEmail, userPhone: p.userPhone,
        rejectionReasons: (() => {
          const val = p.rejectionReasons ?? p.rejection_reasons ?? [];
          if (Array.isArray(val)) return val;
          if (typeof val === 'string') {
            try { const parsed = JSON.parse(val); return Array.isArray(parsed) ? parsed : [val]; } catch { return [val]; }
          }
          return [];
        })(),
      })));
      setStats(statsData);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, statusFilter, searchText]);

  useEffect(() => {
    fetchData();
    const t = setInterval(() => { fetchData(); }, 30000);
    return () => clearInterval(t);
  }, [fetchData]);

  async function handleRestore(paymentId) {
    setActionLoading(paymentId);
    try {
      const res = await fetch(`${FUNCTIONS_URL}/restoreUPIPayment`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ paymentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Restore failed');
      setDeleteMsg('Restored: ' + paymentId);
      fetchData();
    } catch (e) {
      setError('Restore error: ' + e.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleApprove(paymentId) {
    setActionLoading(paymentId);
    try {
      const res = await fetch(`${FUNCTIONS_URL}/approveUPIPayment`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ paymentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Approve failed');
      setDeleteMsg('Approved: ' + (data.utr || paymentId));
      fetchData();
    } catch (e) {
      setError('Approve error: ' + e.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject(paymentId) {
    const reason = prompt('Reason for rejection:');
    if (reason === null) return;
    if (!reason.trim()) { setError('Please enter a reason for rejection.'); return; }
    setActionLoading(paymentId);
    try {
      const res = await fetch(`${FUNCTIONS_URL}/rejectUPIPayment`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ paymentId, reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reject failed');
      setDeleteMsg('Rejected: ' + paymentId);
      fetchData();
    } catch (e) {
      setError('Reject error: ' + e.message);
    } finally {
      setActionLoading(null);
    }
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
      const res = await fetch(`${FUNCTIONS_URL}/adminDeleteRecord`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          recordId: utr,
          recordType: 'upi_payment',
          reason: deleteReason.trim(),
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
    if (status === 'rejected') return 'badge badge-danger';
    if (status === 'manual_review') return 'badge badge-pending';
    return 'badge badge-pending';
  }

  return (
    <div className="page-wrap animate-fade-in-up">
      <AdminSidebar />
      <main className="layout-inner">
        <div className="page-header">
          <h1 className="page-title text-gradient">
            {'\u{1F4B5}'}
            UPI Payment Monitor
          </h1>
          <div className="page-actions">
            {processing && <span className="badge badge-pending">{'\u23F3'} Processing...</span>}
            {processingResult && processingResult.processed > 0 && (
              <span className="text-sm text-muted">
                +{processingResult.approved} approved / {processingResult.rejected} rejected
                {processingResult.manualReview > 0 && (
                  <> / <span style={{ color: 'var(--warning)' }}>{processingResult.manualReview} manual review</span></>
                )}
              </span>
            )}
            {deleteMsg && <span className="text-sm" style={{ color: 'var(--success)' }}>{deleteMsg}</span>}
            <button onClick={handleExport} className="btn btn-ghost btn-sm">Export CSV</button>
            <button onClick={fetchData} className="btn btn-primary btn-sm">
              {loading ? '...' : 'Refresh'}
            </button>
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {stats && (
          <div className="stats-grid">
            {[
              { label: 'Total Users', value: stats.totalUsers, accent: 'accent-primary' },
              { label: 'Pending', value: stats.pendingPayments, accent: 'accent-warning' },
              { label: 'Approved', value: stats.verifiedPayments, accent: 'accent-success' },
              { label: 'Rejected', value: stats.rejectedPayments, accent: 'accent-danger' },
              { label: 'Manual Review', value: stats.manualReviewPayments, accent: 'accent-warning' },
              { label: 'Registration', value: stats.registrationPayments, accent: 'accent-info' },
              { label: 'Topup', value: stats.topupPayments, accent: 'accent-primary' },
            ].map(s => (
              <div key={s.label} className={`stat-card ${s.accent}`}>
                <div className="stat-label">{s.label}</div>
                <div className="stat-value">{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {logs.length > 0 && (
          <details className="mb-md">
            <summary className="text-sm font-semibold" style={{ cursor: 'pointer', color: 'var(--text)' }}>
              Verification Logs ({logs.length})
            </summary>
            <div className="card-dim mt-sm" style={{ maxHeight: 200, overflowY: 'auto' }}>
              {logs.map((l, i) => (
                <div key={i} className="text-xs mb-xs" style={{ padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--border-light)' }}>
                  <span className="text-muted">[{l.time}]</span>{' '}
                  Processed {l.processed} →{' '}
                  <span style={{ color: 'var(--success)' }}>{l.approved} approved</span>
                  {' / '}
                  <span style={{ color: 'var(--danger)' }}>{l.rejected} rejected</span>
                  {l.manualReview > 0 && (
                    <> / <span style={{ color: 'var(--warning)' }}>{l.manualReview} manual review</span></>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}

        <div className="filters mb-md">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All Types</option>
            <option value="registration">Registration</option>
            <option value="topup">Topup</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
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
            className="search-input glass-input"
          />
          <button onClick={processPending} disabled={processing} className="btn btn-primary btn-sm">
            {processing ? '\u23F3 Processing...' : '\u{1F504} Process Pending'}
          </button>
        </div>

        {loading && <div className="loading-spinner loading-spinner-lg" />}

        {!loading && !error && (
          <div className="card glass-card">
            <div className="card-header">
              <h2 className="card-title">{'\u{1F4CB}'} Payments ({payments.length})</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Name</th>
                    <th>Email / Mobile</th>
                    <th>Amount</th>
                    <th>UTR</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Verify Reason</th>
                    <th>Screenshot</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.length === 0 && (
                    <tr><td colSpan={10} className="text-center text-muted" style={{ padding: '2rem' }}>No payments found</td></tr>
                  )}
                  {payments.map(p => {
                    const reasons = p.rejectionReasons || [];
                    const reasonText = reasons.length > 0 ? reasons.join('; ') : (p.verificationReason || '—');
                    const canModify = p.status === 'pending' || p.status === 'manual_review';
                    const isRejected = p.status === 'rejected';
                    return (
                      <tr key={p.id || p.utr}>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <div className="text-sm">{p.created_at ? new Date(p.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</div>
                        </td>
                        <td>
                          <div className="font-semibold text-sm">{p.userName || p.fullName || '—'}</div>
                        </td>
                        <td className="text-xs">
                          <div>{p.userEmail || p.userEmail || ''}</div>
                          <div className="text-muted">{p.userPhone || p.userMobile || ''}</div>
                        </td>
                        <td className="font-semibold">₹{p.amount}</td>
                        <td className="font-mono text-sm">{p.utr}</td>
                        <td><span className={`badge badge-${p.paymentType || p.type}`}>{p.paymentType || p.type}</span></td>
                        <td><span className={getStatusBadgeClass(p.status)}>
                          {p.status === 'verified' ? 'Approved' : p.status === 'manual_review' ? 'Manual Review' : p.status}
                        </span></td>
                        <td className="text-sm" style={{ maxWidth: '160px', wordBreak: 'break-word' }}>{reasonText}</td>
                        <td>
                          {p.screenshotUrl || p.screenshot_url ? (
                            <img
                              src={p.screenshotUrl || p.screenshot_url}
                              alt="Screenshot"
                              onClick={() => setLightboxUrl(p.screenshotUrl || p.screenshot_url)}
                              className="btn-icon"
                              style={{ width: 48, height: 48, objectFit: 'cover', cursor: 'pointer' }}
                            />
                          ) : (
                            <span className="text-muted text-sm">—</span>
                          )}
                        </td>
                        <td>
                          <div className="flex flex-col gap-xs" style={{ alignItems: 'stretch' }}>
                            <button
                              onClick={() => setDetailPayment(p)}
                              className="btn btn-primary btn-xs"
                            >Details</button>
                            {canModify && (
                              <>
                                <button onClick={() => handleApprove(p.id)} disabled={actionLoading === p.id}
                                className="btn btn-success btn-xs"
                                >{actionLoading === p.id ? '...' : 'Approve'}</button>
                                <button onClick={() => handleReject(p.id)} disabled={actionLoading === p.id}
                                  className="btn btn-danger btn-xs"
                                >{actionLoading === p.id ? '...' : 'Reject'}</button>
                              </>
                            )}
                            {(isRejected || p.status === 'failed') && (
                              <button onClick={() => handleRestore(p.id)} disabled={actionLoading === p.id}
                                className="btn btn-warning btn-xs"
                              >{actionLoading === p.id ? '...' : 'Restore'}</button>
                            )}
                            <button onClick={() => handleDelete(p.utr)} disabled={deleteLoading === p.utr}
                              className="btn btn-ghost btn-xs"
                              style={{ color: 'var(--danger)' }}
                            >{deleteLoading === p.utr ? '...' : 'Delete'}</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {deleteTarget && (
          <div
            className="modal-overlay"
            onClick={() => { if (!deleteLoading) { setDeleteTarget(null); setDeleteError(''); } }}
          >
            <div
              onClick={e => e.stopPropagation()}
              className="modal"
            >
              <div className="modal-header">
                <h2>Confirm Delete</h2>
                <button
                  onClick={() => { setDeleteTarget(null); setDeleteError(''); }}
                  disabled={deleteLoading}
                  className="modal-close"
                >
                  {'\u2715'}
                </button>
              </div>
              <div className="modal-body">
                <p className="text-sm mb-md">
                  Are you sure you want to delete this record?
                </p>
                <div className="alert alert-error">
                  <strong>{'\u26A0\uFE0F'} Warning:</strong> This will permanently delete the record
                  <strong> {deleteTarget}</strong> from the database.
                </div>
                <div className="field">
                  <label>Reason for deletion *</label>
                  <textarea
                    value={deleteReason}
                    onChange={e => { setDeleteReason(e.target.value); setDeleteError(''); }}
                    placeholder="Why is this record being deleted?"
                    rows={3}
                    disabled={deleteLoading}
                    className="input"
                  />
                </div>
                {deleteError && (
                  <div className="alert alert-error">{deleteError}</div>
                )}
              </div>
              <div className="modal-footer">
                <button
                  onClick={() => { setDeleteTarget(null); setDeleteError(''); }}
                  disabled={deleteLoading}
                  className="btn btn-ghost"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={deleteLoading || !deleteReason.trim()}
                  className="btn btn-danger"
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
            className="modal-overlay"
            style={{ background: 'rgba(0,0,0,0.85)' }}
          >
            <img
              src={lightboxUrl}
              alt="Screenshot full view"
              style={{ maxWidth: '90%', maxHeight: '90%', borderRadius: '8px' }}
            />
          </div>
        )}

        {detailPayment && (
          <div className="modal-overlay" onClick={() => setDetailPayment(null)}>
            <div onClick={e => e.stopPropagation()} className="modal" style={{ maxWidth: '560px' }}>
              <div className="modal-header">
                <h2>Payment Details</h2>
                <button onClick={() => setDetailPayment(null)} className="modal-close">{'\u2715'}</button>
              </div>
              <div className="modal-body">
                <div className="detail-grid" style={{ gap: '0' }}>
                  {[
                    ['Name', detailPayment.userName || detailPayment.fullName || '—'],
                    ['Email', detailPayment.userEmail || ''],
                    ['Mobile', detailPayment.userPhone || detailPayment.userMobile || ''],
                    ['Amount', '\u20B9' + (detailPayment.amount || '—')],
                    ['UTR', detailPayment.utr || '—'],
                    ['Type', detailPayment.paymentType || detailPayment.type || '—'],
                    ['Status', detailPayment.status],
                    ['Date', detailPayment.created_at ? new Date(detailPayment.created_at).toLocaleString() : '—'],
                    ['Verified At', detailPayment.verifiedAt || detailPayment.verified_at || '—'],
                    ['Reason', (detailPayment.rejectionReasons || []).join('; ') || detailPayment.verificationReason || '—'],
                  ].map(([label, value]) => (
                    <div key={label} className="detail-row">
                      <span className="detail-label">{label}</span>
                      <span className="detail-value" style={{ textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
                    </div>
                  ))}
                  {detailPayment.screenshotUrl || detailPayment.screenshot_url ? (
                    <div className="detail-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                      <span className="detail-label">Screenshot</span>
                      <img src={detailPayment.screenshotUrl || detailPayment.screenshot_url} alt="Payment Screenshot"
                        onClick={() => setLightboxUrl(detailPayment.screenshotUrl || detailPayment.screenshot_url)}
                        style={{ maxWidth: '100%', maxHeight: '200px', borderRadius: '6px', cursor: 'pointer' }} />
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="modal-footer">
                <button onClick={() => setDetailPayment(null)} className="btn btn-ghost">Close</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
