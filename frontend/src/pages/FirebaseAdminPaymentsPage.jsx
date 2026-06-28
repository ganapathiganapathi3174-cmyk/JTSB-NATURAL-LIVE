import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AdminSidebar from '../components/AdminSidebar.jsx';

const ADMIN_KEY = 'fb_admin_token';
const API_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';

function authHeaders() {
  const t = localStorage.getItem(ADMIN_KEY);
  return t ? { 'Cache-Control': 'no-cache', 'Authorization': 'Bearer ' + t } : { 'Cache-Control': 'no-cache' };
}

function getRelativeTime(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getStatusBadge(s) {
  if (s === 'approved' || s === 'success') return 'badge badge-paid';
  if (s === 'rejected') return 'badge badge-error';
  if (s === 'manual_review') return 'badge badge-warning';
  return 'badge badge-pending';
}

function getStatusLabel(s) {
  if (s === 'approved' || s === 'success') return 'Approved';
  if (s === 'rejected') return 'Rejected';
  if (s === 'manual_review') return 'Manual Review';
  return 'Pending';
}

function MatchBadge({ matched }) {
  return matched === true ? <span className="badge badge-paid" style={{ fontSize: '0.7rem' }}>{'\u2713'} Match</span>
    : matched === false ? <span className="badge badge-error" style={{ fontSize: '0.7rem' }}>{'\u2715'} Mismatch</span>
    : <span className="badge badge-pending" style={{ fontSize: '0.7rem' }}>{'\u2014'}</span>;
}

function VerificationTimeline({ payment }) {
  const steps = [
    { label: 'Payment Created', done: !!payment.created_at, time: payment.created_at },
    { label: 'OCR Verification', done: !!(payment.ocr_result || payment.ocrConfidence), time: payment.verified_at },
    { label: 'Amount Check', done: payment.matchedAmount !== undefined, time: payment.verified_at },
    { label: 'UPI Receiver Check', done: payment.matchedReceiver !== undefined, time: payment.verified_at },
    { label: 'Duplicate Check', done: !!(payment.ocr_result || payment.rejection_reasons?.length), time: payment.verified_at },
    { label: 'Decision', done: !!payment.payment_status && payment.payment_status !== 'pending', time: payment.verified_at },
  ];
  return (
    <div className="verification-timeline">
      {steps.map((s, i) => (
        <div key={i} className={`timeline-step ${s.done ? 'done' : 'pending'}`}>
          <div className="timeline-dot" />
          <div className="timeline-content">
            <div className="timeline-label">{s.label}</div>
            {s.time && <div className="timeline-time">{formatDateTime(s.time)}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function PaymentDetailModal({ payment, onClose }) {
  if (!payment) return null;
  const ocr = payment.ocr_result || {};
  return (
    <div className="modal-modern-overlay" onClick={onClose}>
      <div className="modal-modern" onClick={e => e.stopPropagation()} style={{ maxWidth: '640px' }}>
        <div className="modal-modern-header">
          <h2>Payment Details</h2>
          <button onClick={onClose} className="btn-modern btn-modern-ghost btn-modern-sm">{'\u2715'}</button>
        </div>
        <div className="modal-modern-body">
          {/* Verification Status Banner */}
          <div className={`verification-banner ${payment.payment_status}`} style={{ padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem', fontWeight: 600, fontSize: '0.9rem', textAlign: 'center' }}>
            {getStatusLabel(payment.payment_status)}
            {payment.final_score ? <span style={{ marginLeft: '0.5rem', opacity: 0.8 }}>(Score: {payment.final_score}%)</span> : null}
            {payment.ocrConfidence ? <span style={{ marginLeft: '0.5rem', opacity: 0.8 }}>OCR: {payment.ocrConfidence}%</span> : null}
          </div>

          {/* OCR Results Section */}
          {(payment.ocrConfidence > 0 || ocr.extractedAmount) && (
            <div className="card-section-sm" style={{ marginBottom: '1rem' }}>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>OCR Extraction Results</h4>
              <div className="detail-grid-sm" style={{ gap: '0.35rem' }}>
                <div className="detail-row"><span className="detail-label">OCR Confidence</span><span className="detail-value">{payment.ocrConfidence || 0}%</span></div>
                <div className="detail-row"><span className="detail-label">Extracted Amount</span><span className="detail-value">{ocr.extractedAmount ? '\u20B9' + ocr.extractedAmount : 'Not found'}</span></div>
                <div className="detail-row"><span className="detail-label">Extracted UTR</span><span className="detail-value" style={{ fontFamily: 'monospace' }}>{ocr.extractedUtr || 'Not found'}</span></div>
                <div className="detail-row"><span className="detail-label">Receiver UPI</span><span className="detail-value">{ocr.extractedReceiverUpi || 'Not found'}</span></div>
                <div className="detail-row"><span className="detail-label">Sender UPI</span><span className="detail-value">{ocr.extractedSenderUpi || 'Not found'}</span></div>
                <div className="detail-row"><span className="detail-label">Date</span><span className="detail-value">{ocr.extractedDate || 'Not found'}</span></div>
                <div className="detail-row"><span className="detail-label">Time</span><span className="detail-value">{ocr.extractedTime || 'Not found'}</span></div>
                <div className="detail-row"><span className="detail-label">Bank/App</span><span className="detail-value">{ocr.extractedBankName || 'Not detected'}</span></div>
                <div className="detail-row"><span className="detail-label">Status</span><span className="detail-value">{ocr.extractedStatus || 'Not detected'}</span></div>
              </div>
            </div>
          )}

          {/* Match Indicators */}
          <div className="card-section-sm" style={{ marginBottom: '1rem' }}>
            <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Field Matching</h4>
            <div className="detail-grid-sm" style={{ gap: '0.35rem' }}>
              <div className="detail-row"><span className="detail-label">Amount</span><MatchBadge matched={payment.matchedAmount} /></div>
              <div className="detail-row"><span className="detail-label">Receiver UPI</span><MatchBadge matched={payment.matchedReceiver} /></div>
              <div className="detail-row"><span className="detail-label">UTR</span><MatchBadge matched={payment.matchedUtr} /></div>
              <div className="detail-row"><span className="detail-label">Date</span><MatchBadge matched={payment.matchedDate} /></div>
            </div>
          </div>

          {/* Verdict / Rejection Reasons */}
          {payment.rejection_reasons && payment.rejection_reasons.length > 0 && (
            <div className="card-section-sm" style={{ marginBottom: '1rem' }}>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Decision Reason</h4>
              <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.85rem', color: '#dc2626' }}>
                {(Array.isArray(payment.rejection_reasons) ? payment.rejection_reasons : [payment.rejection_reasons]).map((r, i) => (
                  <li key={i} style={{ marginBottom: '0.25rem' }}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Timeline */}
          <div className="card-section-sm" style={{ marginBottom: '1rem' }}>
            <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Verification Timeline</h4>
            <VerificationTimeline payment={payment} />
          </div>

          {/* Basic Info */}
          <div className="card-section-sm">
            <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Payment Info</h4>
            <div className="detail-grid-sm">
              <div className="detail-row"><span className="detail-label">Name</span><span className="detail-value">{payment.name}</span></div>
              <div className="detail-row"><span className="detail-label">Email</span><span className="detail-value">{payment.email || '\u2014'}</span></div>
              <div className="detail-row"><span className="detail-label">Phone</span><span className="detail-value">{payment.phone || '\u2014'}</span></div>
              <div className="detail-row"><span className="detail-label">Amount</span><span className="detail-value">{payment.amount ? '\u20B9' + payment.amount : '\u2014'}</span></div>
              <div className="detail-row"><span className="detail-label">UTR</span><span className="detail-value" style={{ fontFamily: 'monospace' }}>{payment.utr || '\u2014'}</span></div>
              <div className="detail-row"><span className="detail-label">UPI ID</span><span className="detail-value">{payment.upi_id || '\u2014'}</span></div>
              <div className="detail-row"><span className="detail-label">Status</span><span className={getStatusBadge(payment.payment_status)}>{getStatusLabel(payment.payment_status)}</span></div>
              <div className="detail-row"><span className="detail-label">Created</span><span className="detail-value">{formatDateTime(payment.created_at)}</span></div>
              {payment.verified_at && <div className="detail-row"><span className="detail-label">Verified</span><span className="detail-value">{formatDateTime(payment.verified_at)}</span></div>}
            </div>
          </div>

          {payment.screenshot_url && (
            <div className="card-section-sm" style={{ marginTop: '1rem' }}>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Screenshot</h4>
              <a href={payment.screenshot_url} target="_blank" rel="noopener noreferrer">
                <img src={payment.screenshot_url} alt="Payment Screenshot"
                  style={{ maxWidth: '100%', maxHeight: '200px', borderRadius: '6px', cursor: 'pointer', border: '1px solid var(--border, #d1d5db)' }} />
              </a>
            </div>
          )}

          {/* Raw OCR Text Collapsible */}
          {ocr.rawText && (
            <details style={{ marginTop: '1rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: '#6b7280', fontWeight: 600 }}>Raw OCR Text</summary>
              <pre style={{ fontSize: '0.75rem', background: '#f9fafb', padding: '0.5rem', borderRadius: '6px', maxHeight: '150px', overflow: 'auto', width: '100%', marginTop: '0.5rem', whiteSpace: 'pre-wrap' }}>
                {ocr.rawText}
              </pre>
            </details>
          )}
        </div>
        <div className="modal-modern-footer">
          <button className="btn-modern btn-modern-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({ payment, onConfirm, onCancel, loading }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  return (
    <div className="modal-modern-overlay" onClick={onCancel}>
      <div className="modal-modern" onClick={e => e.stopPropagation()}>
        <div className="modal-modern-header">
          <h2>Confirm Delete Payment</h2>
          <button onClick={onCancel} className="btn-modern btn-modern-ghost btn-modern-sm">{'\u2715'}</button>
        </div>
        <div className="modal-modern-body">
          <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
            <strong>{'\u26A0\uFE0F'} Warning:</strong> This will permanently delete the payment <strong>{payment.utr || payment.id}</strong>, remove the uploaded screenshot from storage, and log this action. This CANNOT be undone!
          </div>
          <div className="detail-grid card-section-sm" style={{ marginBottom: '1rem' }}>
            <div className="detail-row">
              <span className="detail-label">UTR</span>
              <span className="detail-value" style={{ fontFamily: 'monospace' }}>{payment.utr || '—'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">User</span>
              <span className="detail-value">{payment.name}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Amount</span>
              <span className="detail-value">{payment.amount ? '\u20B9' + payment.amount : '—'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Status</span>
              <span className={getStatusBadge(payment.payment_status)}>{getStatusLabel(payment.payment_status)}</span>
            </div>
          </div>
          <textarea className="input w-full mb-sm"
            placeholder="Reason for deletion (required)"
            value={reason} onChange={e => { setReason(e.target.value); setError(''); }}
            rows={2} style={{ resize: 'vertical' }} />
          {error && <div className="alert alert-error" style={{ marginBottom: '0.5rem', fontSize: '0.85rem' }}>{error}</div>}
        </div>
        <div className="modal-modern-footer">
          <button className={`btn-modern btn-modern-danger${loading ? ' btn-loading' : ''}`}
            onClick={() => { if (!reason.trim()) { setError('Please enter a reason'); return; } onConfirm(reason.trim()); }}
            disabled={loading}>
            {loading ? 'Deleting...' : 'Delete Permanently'}
          </button>
          <button className="btn-modern btn-modern-ghost" onClick={onCancel} disabled={loading}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function FirebaseAdminPaymentsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [payments, setPayments] = useState([]);
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(null);
  const [q, setQ] = useState('');
  const [smartFilter, setSmartFilter] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [fetchError, setFetchError] = useState('');
  const [diagnostics, setDiagnostics] = useState(null);
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const msgTimeoutRef = useRef(null);
  const fetchIntervalRef = useRef(null);

  useEffect(() => {
    return () => {
      if (msgTimeoutRef.current) clearTimeout(msgTimeoutRef.current);
      if (fetchIntervalRef.current) clearInterval(fetchIntervalRef.current);
    };
  }, []);

  const showSuccess = useCallback((msg) => {
    setSuccessMsg(msg);
    if (msgTimeoutRef.current) clearTimeout(msgTimeoutRef.current);
    msgTimeoutRef.current = setTimeout(() => setSuccessMsg(''), 3000);
  }, []);

  const fetchPayments = useCallback(async () => {
    setFetchError('');
    try {
      const res = await fetch(`${API_BASE}/getAdminDashboardData`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      if (result._diagnostics) setDiagnostics(result._diagnostics);
      if (result.success) {
        setPayments(result.pendingPayments || []);
      } else {
        setFetchError(result.error || 'Dashboard returned failure');
        if (result.diagnostics) {
          const diag = result.diagnostics;
          const failed = [];
          if (!diag.usersSuccess) failed.push('users');
          if (!diag.topupsSuccess) failed.push('topups');
          if (!diag.pendingSuccess) failed.push('pending_registrations');
          if (!diag.paymentsSuccess) failed.push('upi_payments');
          setFetchError(`DB query failed: ${failed.join(', ')}`);
          setDiagnostics(diag);
        }
      }
    } catch (err) {
      console.error('[ADMIN PAYMENTS] Failed to fetch:', err);
      setFetchError('API server unreachable: ' + err.message);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem(ADMIN_KEY);
    if (!token) { navigate('/fb-admin', { replace: true }); return; }
    fetchPayments();
    fetchIntervalRef.current = setInterval(() => fetchPayments(), 5000);
    return () => { if (fetchIntervalRef.current) clearInterval(fetchIntervalRef.current); };
  }, [navigate, fetchPayments]);

  useEffect(() => {
    const status = searchParams.get('status');
    if (status) setSmartFilter(status);
  }, [searchParams]);

  const filteredPayments = useMemo(() => {
    let filtered = payments;
    if (smartFilter) {
      switch (smartFilter) {
        case 'pending': filtered = filtered.filter(p => p.payment_status === 'pending'); break;
        case 'approved': filtered = filtered.filter(p => p.payment_status === 'approved' || p.payment_status === 'success'); break;
        case 'rejected': filtered = filtered.filter(p => p.payment_status === 'rejected'); break;
        case 'manual_review': filtered = filtered.filter(p => p.payment_status === 'manual_review'); break;
        case 'today': filtered = filtered.filter(p => p.created_at && new Date(p.created_at).toDateString() === new Date().toDateString()); break;
        case 'week': filtered = filtered.filter(p => p.created_at && new Date(p.created_at) >= new Date(Date.now() - 7 * 86400000)); break;
        default: break;
      }
    }
    if (dateFrom) {
      const from = new Date(dateFrom);
      filtered = filtered.filter(p => p.created_at && new Date(p.created_at) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      filtered = filtered.filter(p => p.created_at && new Date(p.created_at) <= to);
    }
    if (q) {
      const ql = q.toLowerCase();
      filtered = filtered.filter(p => (p.name && p.name.toLowerCase().includes(ql)) || (p.email && p.email.toLowerCase().includes(ql)) || (p.utr && p.utr.toLowerCase().includes(ql)));
    }
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'created_at') cmp = new Date(a.created_at || 0) - new Date(b.created_at || 0);
      else if (sortBy === 'amount') cmp = (Number(a.amount) || 0) - (Number(b.amount) || 0);
      else if (sortBy === 'name') cmp = (a.name || '').localeCompare(b.name || '');
      else if (sortBy === 'status') cmp = (a.payment_status || '').localeCompare(b.payment_status || '');
      return sortOrder === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [payments, smartFilter, q, dateFrom, dateTo, sortBy, sortOrder]);

  const stats = useMemo(() => {
    let pending = 0, approved = 0, rejected = 0, manualReview = 0;
    for (const p of payments) {
      const s = p.payment_status;
      if (s === 'pending') pending++;
      else if (s === 'approved' || s === 'success') approved++;
      else if (s === 'rejected') rejected++;
      else if (s === 'manual_review') manualReview++;
    }
    return { pending, approved, rejected, manualReview };
  }, [payments]);

  const handleDelete = useCallback(async (reason) => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const recordId = deleteTarget.utr || deleteTarget.id;
      const res = await fetch(`${API_BASE}/adminDeleteRecord`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ recordId, recordType: 'upi_payment', reason, adminName: getAdminName() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setPayments(prev => prev.filter(p => (p.utr || p.id) !== recordId));
      setDeleteTarget(null);
      showSuccess('Payment deleted successfully');
    } catch (err) {
      alert('Delete failed: ' + (err.message || 'Unknown error'));
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteTarget, showSuccess]);

  const handleRestore = useCallback(async (payment) => {
    if (!window.confirm(`Restore payment ${payment.utr || payment.id} back to Pending?`)) return;
    setRestoreLoading(payment.id);
    try {
      const res = await fetch(`${API_BASE}/restoreUPIPayment`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ paymentId: payment.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Restore failed');
      setPayments(prev => prev.map(p => p.id === payment.id ? { ...p, status: 'pending', payment_status: 'pending', rejection_reasons: [] } : p));
      showSuccess('Payment restored to Pending');
    } catch (err) {
      alert('Restore failed: ' + (err.message || 'Unknown error'));
    } finally {
      setRestoreLoading(null);
    }
  }, [showSuccess]);

  const updateSmartFilter = (value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('status', value);
    else next.delete('status');
    setSearchParams(next, { replace: true });
    setSmartFilter(value);
  };

  const pendingCounts = useMemo(() => ({ pendingPayments: stats.pending, pendingTopups: 0 }), [stats]);

  function getAdminName() {
    try { return sessionStorage.getItem('fb_admin_name') || localStorage.getItem('fb_admin_name') || 'Admin'; } catch { return 'Admin'; }
  }

  return (
    <div className="admin-layout">
      <AdminSidebar pendingCounts={pendingCounts} userName={getAdminName()} />
      <main className="admin-content">
        <div className="admin-content-inner">
          <div className="admin-page-header">
            <h1 className="admin-page-title">
              <span className="admin-page-title-icon">{'\u{1F4B3}'}</span>
              Payments
            </h1>
            <div className="admin-page-actions">
              <span className="badge badge-pending text-xs">{stats.pending} pending</span>
            </div>
          </div>

          {fetchError && (
            <div className="alert alert-error" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: '8px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', fontSize: '0.9rem' }}>
              <strong>Error:</strong> {fetchError}
              {diagnostics && (
                <pre style={{ fontSize: '0.75rem', marginTop: '0.5rem', whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(diagnostics, null, 2)}
                </pre>
              )}
              <button onClick={fetchPayments} style={{ marginLeft: '1rem', padding: '0.25rem 0.75rem', fontSize: '0.8rem', cursor: 'pointer' }}>Retry</button>
            </div>
          )}

          <div className="stats-grid-modern">
            <div className="stat-card-modern warning">
              <div className="stat-bg-icon">{'\u23F3'}</div>
              <div className="stat-value">{stats.pending}</div>
              <div className="stat-label">Pending Payments</div>
            </div>
            <div className="stat-card-modern info">
              <div className="stat-bg-icon">{'\u{1F50D}'}</div>
              <div className="stat-value">{stats.manualReview}</div>
              <div className="stat-label">Manual Review</div>
            </div>
            <div className="stat-card-modern success">
              <div className="stat-bg-icon">{'\u2705'}</div>
              <div className="stat-value">{stats.approved}</div>
              <div className="stat-label">Approved</div>
            </div>
            <div className="stat-card-modern danger">
              <div className="stat-bg-icon">{'\u2715'}</div>
              <div className="stat-value">{stats.rejected}</div>
              <div className="stat-label">Rejected</div>
            </div>
          </div>

          <div className="card-modern mb-md">
            <div className="card-modern-header">
              <h2 className="card-modern-title">{'\u{1F50D}'} Search & Filter</h2>
              <button className="btn-modern btn-modern-ghost btn-modern-xs" onClick={() => {
                const headers = ['Date', 'Name', 'Email', 'Mobile', 'Amount', 'Amount Match', 'UTR', 'UTR Match', 'Status', 'Score', 'Reasons'];
                const rows = filteredPayments.map(p => [
                  p.created_at ? new Date(p.created_at).toLocaleDateString('en-IN') : '', p.name || '', p.email || '', p.phone || '',
                  p.amount ? '\u20B9' + p.amount : '', p.matchedAmount === true ? 'Yes' : p.matchedAmount === false ? 'No' : '',
                  p.utr || '', p.matchedUtr === true ? 'Yes' : p.matchedUtr === false ? 'No' : '',
                  getStatusLabel(p.payment_status),
                  p.final_score > 0 ? p.final_score + '%' : p.ocrConfidence > 0 ? 'OCR ' + p.ocrConfidence + '%' : '',
                  p.rejection_reasons?.length ? p.rejection_reasons.join('; ') : '',
                ]);
                const csv = [headers.join(','), ...rows.map(r => r.map(v => '"' + String(v || '').replace(/"/g, '""') + '"').join(','))].join('\n');
                const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
                a.download = 'payments-export-' + new Date().toISOString().split('T')[0] + '.csv';
                a.click(); URL.revokeObjectURL(a.href);
              }}>{'\u{1F4E5}'} Export CSV</button>
            </div>
            <div className="search-bar-modern" style={{ flexWrap: 'wrap' }}>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, email, or UTR..." />
              <select value={smartFilter} onChange={e => updateSmartFilter(e.target.value)}>
                <option value="">All Payments</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="manual_review">Manual Review</option>
                <option disabled>{'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'}</option>
                <option value="today">Today</option>
                <option value="week">This Week</option>
              </select>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="From date" style={{ padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border, #d1d5db)', fontSize: '0.85rem', maxWidth: '150px' }} />
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} title="To date" style={{ padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border, #d1d5db)', fontSize: '0.85rem', maxWidth: '150px' }} />
              <select value={sortBy} onChange={e => { setSortBy(e.target.value); }} style={{ padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border, #d1d5db)', fontSize: '0.85rem' }}>
                <option value="created_at">Date</option>
                <option value="amount">Amount</option>
                <option value="name">Name</option>
                <option value="status">Status</option>
              </select>
              <button className="btn-modern btn-modern-ghost btn-modern-xs" onClick={() => setSortOrder(o => o === 'asc' ? 'desc' : 'asc')}>
                {sortOrder === 'asc' ? '\u2191 Asc' : '\u2193 Desc'}
              </button>
            </div>
          </div>

          <div className="card-modern">
            <div className="card-modern-header">
              <h2 className="card-modern-title">{'\u{1F4CB}'} Payments ({filteredPayments.length})</h2>
            </div>
            <p className="muted text-sm mb-md">
              UPI payments are auto-verified via server-side trigger upon creation.
            </p>
            <div className="table-wrap-modern">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Mobile</th>
                    <th>Amount</th>
                    <th>UTR</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'center' }}>Score</th>
                    <th>Reasons</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPayments.map(p => {
                    const canModify = p.payment_status !== 'approved' && p.payment_status !== 'success';
                    return (
                      <tr key={p.id}>
                        <td data-label="Date" className="text-xs whitespace-nowrap">
                          {p.created_at ? <><div>{new Date(p.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div><div className="relative-time">{getRelativeTime(p.created_at)}</div></> : '—'}
                        </td>
                        <td data-label="Name">
                          <div className="font-semibold" style={{ color: p.name === 'User Not Found' ? '#dc2626' : 'inherit' }}>
                            {p.name}
                          </div>
                        </td>
                        <td data-label="Email" style={{ fontSize: '0.85rem' }}>{p.email || '—'}</td>
                        <td data-label="Mobile" style={{ fontSize: '0.85rem' }}>{p.phone || '—'}</td>
                        <td data-label="Amount" style={{ fontWeight: 600 }}>
                          {p.amount ? '\u20B9' + p.amount : '—'}
                          {p.matchedAmount !== undefined && (
                            <span className={p.matchedAmount ? 'badge badge-paid' : 'badge badge-error'} style={{ fontSize: '0.6rem', marginLeft: '0.3rem', padding: '0.1rem 0.3rem', verticalAlign: 'middle' }}>
                              {p.matchedAmount ? '\u2713' : '\u2715'}
                            </span>
                          )}
                        </td>
                        <td data-label="UTR" style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                          {p.utr || '—'}
                          {p.matchedUtr !== undefined && (
                            <span className={p.matchedUtr ? 'badge badge-paid' : 'badge badge-error'} style={{ fontSize: '0.6rem', marginLeft: '0.3rem', padding: '0.1rem 0.3rem', verticalAlign: 'middle' }}>
                              {p.matchedUtr ? '\u2713' : '\u2715'}
                            </span>
                          )}
                        </td>
                        <td data-label="Status">
                          <span className={getStatusBadge(p.payment_status)}>{getStatusLabel(p.payment_status)}</span>
                        </td>
                        <td data-label="Score" style={{ textAlign: 'center' }}>
                          {p.final_score > 0 ? (
                            <span className={`badge ${p.final_score >= 90 ? 'badge-paid' : p.final_score >= 80 ? 'badge-warning' : 'badge-error'}`} style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}>
                              {p.final_score}%
                            </span>
                          ) : p.ocrConfidence > 0 ? (
                            <span className="badge badge-pending" style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}>
                              OCR {p.ocrConfidence}%
                            </span>
                          ) : (
                            <span style={{ color: '#9ca3af', fontSize: '0.75rem' }}>{'\u2014'}</span>
                          )}
                        </td>
                        <td data-label="Reasons" style={{ fontSize: '0.75rem', maxWidth: '140px', wordBreak: 'break-word', color: p.rejection_reasons?.length ? '#dc2626' : '#9ca3af' }}>
                          {p.rejection_reasons && p.rejection_reasons.length > 0
                            ? p.rejection_reasons.slice(0, 2).join('; ') + (p.rejection_reasons.length > 2 ? '…' : '')
                            : p.verification_reason
                              ? p.verification_reason
                              : '—'}
                        </td>
                        <td data-label="Actions">
                          <div className="flex-actions" style={{ flexDirection: 'column', gap: '0.25rem' }}>
                            <button className="btn-modern btn-modern-primary btn-modern-xs"
                              onClick={() => setSelectedPayment(p)}>Details</button>
                            {canModify && (
                              <>
                                {p.payment_status === 'rejected' && (
                                  <button className="btn-modern btn-modern-warning btn-modern-xs"
                                    onClick={() => handleRestore(p)}
                                    disabled={restoreLoading === p.id}>
                                    {restoreLoading === p.id ? '...' : 'Restore'}
                                  </button>
                                )}
                                <button className="btn-modern btn-modern-danger btn-modern-xs"
                                  onClick={() => setDeleteTarget(p)}>Delete</button>
                              </>
                            )}
                            {!canModify && (
                              <span style={{ fontSize: '0.7rem', color: '#9ca3af' }}>Locked</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                    {filteredPayments.length === 0 && (
                      <tr><td colSpan={9} className="muted text-center" style={{ padding: '2rem' }}>No payments found.</td></tr>
                    )}
                </tbody>
              </table>
            </div>
          </div>

          {selectedPayment && (
            <PaymentDetailModal
              key={selectedPayment.id}
              payment={selectedPayment}
              onClose={() => setSelectedPayment(null)}
            />
          )}

          {deleteTarget && (
            <DeleteConfirmModal
              payment={deleteTarget}
              onConfirm={handleDelete}
              onCancel={() => { setDeleteTarget(null); }}
              loading={deleteLoading}
            />
          )}

          {successMsg && (
            <div style={{ position: 'fixed', top: '1rem', right: '1rem', zIndex: 9999, padding: '1rem 1.5rem', borderRadius: '8px', background: 'var(--success)', color: '#fff', fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
              {'\u2713'} {successMsg}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
