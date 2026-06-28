import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminSidebar from '../components/AdminSidebar.jsx';

const ADMIN_KEY = 'fb_admin_token';
const API_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';

function authHeaders() {
  const t = localStorage.getItem(ADMIN_KEY);
  return t ? { 'Cache-Control': 'no-cache', 'Authorization': 'Bearer ' + t } : { 'Cache-Control': 'no-cache' };
}

const TABS = [
  { key: 'bulk', label: 'Bulk Actions' },
  { key: 'payment-tools', label: 'Payment Tools' },
  { key: 'reports', label: 'Reports' },
  { key: 'audit', label: 'Audit Log' },
];

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(10px)'; el.style.transition = 'all 0.3s'; setTimeout(() => el.remove(), 300); }, 3000);
}

function formatDateTime(dateStr) {
  if (!dateStr) return '\u2014';
  return new Date(dateStr).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toISOString().split('T')[0];
}

async function apiPost(endpoint, body) {
  const token = localStorage.getItem(ADMIN_KEY);
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function apiGet(endpoint) {
  const token = localStorage.getItem(ADMIN_KEY);
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function getStatusBadgeClass(status) {
  if (status === 'approved' || status === 'success') return 'badge badge-paid';
  if (status === 'rejected') return 'badge badge-error';
  if (status === 'manual_review') return 'badge badge-warning';
  return 'badge badge-pending';
}

function getActionLabel(action) {
  return action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function FirebaseAdminToolsPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('bulk');

  const [payments, setPayments] = useState([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [selectedPayments, setSelectedPayments] = useState(new Set());
  const [bulkReason, setBulkReason] = useState('');
  const [bulkAction, setBulkAction] = useState('approve');
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  const [paymentId, setPaymentId] = useState('');
  const [rerunOcrLoading, setRerunOcrLoading] = useState(false);
  const [rerunVerLoading, setRerunVerLoading] = useState(false);
  const [paymentLookup, setPaymentLookup] = useState(null);
  const [paymentLookupId, setPaymentLookupId] = useState('');
  const [paymentLookupLoading, setPaymentLookupLoading] = useState(false);

  const [reportLoading, setReportLoading] = useState(null);

  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditFilterAction, setAuditFilterAction] = useState('');
  const [auditDateFrom, setAuditDateFrom] = useState('');
  const [auditDateTo, setAuditDateTo] = useState('');

  useEffect(() => {
    const token = localStorage.getItem(ADMIN_KEY);
    if (!token) { navigate('/fb-admin', { replace: true }); return; }
    try {
      const body = JSON.parse(atob(token.split('.')[1]));
      const exp = body.exp;
      if (!exp || Math.floor(Date.now() / 1000) > exp) {
        localStorage.removeItem(ADMIN_KEY);
        navigate('/fb-admin', { replace: true });
        return;
      }
    } catch {
      localStorage.removeItem(ADMIN_KEY);
      navigate('/fb-admin', { replace: true });
      return;
    }
  }, [navigate]);

  const fetchPayments = useCallback(async () => {
    setLoadingPayments(true);
    try {
      const data = await apiPost('/getUPIPayments', { status: ['pending', 'manual_review'] });
      if (data.success) setPayments(data.payments || []);
      else if (data.payments) setPayments(data.payments);
      else setPayments([]);
    } catch (err) {
      console.error('[Tools] Fetch payments error:', err);
      setPayments([]);
    } finally {
      setLoadingPayments(false);
    }
  }, []);

  const fetchAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    try {
      const params = new URLSearchParams();
      if (auditFilterAction) params.set('action', auditFilterAction);
      if (auditDateFrom) params.set('from', auditDateFrom);
      if (auditDateTo) params.set('to', auditDateTo);
      const data = await apiGet(`/getAuditLogs?${params.toString()}`);
      if (data.success) setAuditLogs(data.logs || []);
      else if (data.logs) setAuditLogs(data.logs);
      else setAuditLogs([]);
    } catch (err) {
      console.error('[Tools] Fetch audit logs error:', err);
      setAuditLogs([]);
    } finally {
      setAuditLoading(false);
    }
  }, [auditFilterAction, auditDateFrom, auditDateTo]);

  useEffect(() => {
    if (activeTab === 'bulk' && payments.length === 0 && !loadingPayments) {
      fetchPayments();
    }
  }, [activeTab, payments.length, loadingPayments, fetchPayments]);

  useEffect(() => {
    if (activeTab === 'audit') {
      fetchAuditLogs();
    }
  }, [activeTab, fetchAuditLogs]);

  const handleSelectAll = () => {
    if (payments.every(p => selectedPayments.has(p.id))) {
      setSelectedPayments(new Set());
    } else {
      setSelectedPayments(new Set(payments.map(p => p.id)));
    }
  };

  const handleSelectPayment = (id) => {
    const next = new Set(selectedPayments);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedPayments(next);
  };

  async function handleBulkAction() {
    if (selectedPayments.size === 0) { toast('Select at least one payment', 'error'); return; }
    if (!bulkReason.trim()) { toast('Please provide a reason', 'error'); return; }
    setBulkProcessing(true);
    setBulkResult(null);
    const ids = Array.from(selectedPayments);
    let successCount = 0;
    let failCount = 0;
    const errors = [];
    for (const paymentId of ids) {
      try {
        if (bulkAction === 'approve') {
          await apiPost('/approveUPIPayment', { paymentId });
        } else {
          await apiPost('/rejectUPIPayment', { paymentId, reason: bulkReason.trim() });
        }
        successCount++;
      } catch (err) {
        failCount++;
        errors.push(`${paymentId.substring(0, 12)}: ${err.message}`);
      }
    }
    setBulkResult({ successCount, failCount, errors: errors.slice(0, 5) });
    toast(`Done: ${successCount} succeeded, ${failCount} failed`, failCount > 0 ? 'warning' : 'success');
    setSelectedPayments(new Set());
    fetchPayments();
    setBulkProcessing(false);
  }

  async function handleRerunOcr() {
    if (!paymentId.trim()) { toast('Enter a payment ID', 'error'); return; }
    setRerunOcrLoading(true);
    try {
      await apiPost('/rerunOcr', { paymentId: paymentId.trim() });
      toast('OCR re-run initiated');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setRerunOcrLoading(false);
    }
  }

  async function handleRerunVerification() {
    if (!paymentId.trim()) { toast('Enter a payment ID', 'error'); return; }
    setRerunVerLoading(true);
    try {
      await apiPost('/rerunVerification', { paymentId: paymentId.trim() });
      toast('Verification re-run initiated');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setRerunVerLoading(false);
    }
  }

  async function handleLookupPayment() {
    if (!paymentLookupId.trim()) { toast('Enter a payment ID', 'error'); return; }
    setPaymentLookupLoading(true);
    setPaymentLookup(null);
    try {
      const data = await apiPost('/getUPIPayments', { paymentId: paymentLookupId.trim() });
      if (data.success && data.payments?.length) setPaymentLookup(data.payments[0]);
      else if (data.payments?.length) setPaymentLookup(data.payments[0]);
      else toast('Payment not found', 'error');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setPaymentLookupLoading(false);
    }
  }

  async function handleDownloadReport(period) {
    setReportLoading(period);
    try {
      const data = await apiGet(`/getReports?period=${period}`);
      if (data.csv || data.url) {
        const csvContent = data.csv;
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${period}-report-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast(`${period} report downloaded`);
      } else {
        toast('No report data available', 'info');
      }
    } catch (err) {
      toast(err.message || 'Failed to download report', 'error');
    } finally {
      setReportLoading(null);
    }
  }

  function getAdminName() {
    try {
      return sessionStorage.getItem('fb_admin_name') || localStorage.getItem('fb_admin_name') || 'Admin';
    } catch { return 'Admin'; }
  }

  return (
    <div className="admin-layout">
      <AdminSidebar userName={getAdminName()} />

      <main className="admin-content">
        <div className="admin-content-inner">
          <div className="admin-page-header">
            <h1 className="admin-page-title">
              <span className="admin-page-title-icon">{'\u2699\uFE0F'}</span>
              Admin Tools
            </h1>
          </div>

          <div className="tools-tabs">
            {TABS.map(tab => (
              <button
                key={tab.key}
                className={`tools-tab${activeTab === tab.key ? ' active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'bulk' && (
            <div className="tools-panel">
              <div className="card-modern mb-md">
                <div className="card-modern-header">
                  <h2 className="card-modern-title">{'\u{1F4CB}'} Bulk Approve / Reject Payments</h2>
                  <div className="admin-page-actions">
                    <button className="btn-modern btn-modern-ghost btn-modern-sm" onClick={fetchPayments} disabled={loadingPayments}>
                      {loadingPayments ? '...' : '\u{1F504}'}
                    </button>
                  </div>
                </div>

                <div className="tools-section">
                  <div className="search-bar-modern" style={{ marginBottom: '1rem' }}>
                    <select value={bulkAction} onChange={e => setBulkAction(e.target.value)}>
                      <option value="approve">Approve</option>
                      <option value="reject">Reject</option>
                    </select>
                    <input
                      placeholder="Reason for action (required)"
                      value={bulkReason}
                      onChange={e => setBulkReason(e.target.value)}
                    />
                    <button
                      className={`btn-modern ${bulkAction === 'approve' ? 'btn-modern-success' : 'btn-modern-danger'}${bulkProcessing ? ' btn-loading' : ''}`}
                      onClick={handleBulkAction}
                      disabled={bulkProcessing || selectedPayments.size === 0}
                    >
                      {bulkProcessing ? 'Processing...' : `Apply to ${selectedPayments.size} selected`}
                    </button>
                  </div>

                  {bulkResult && (
                    <div className={`alert ${bulkResult.failCount > 0 ? 'alert-error' : 'alert-success'}`} style={{ marginBottom: '1rem' }}>
                      <strong>Result:</strong> {bulkResult.successCount} succeeded, {bulkResult.failCount} failed
                      {bulkResult.errors.length > 0 && (
                        <ul style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
                          {bulkResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                      )}
                    </div>
                  )}
                </div>

                <div className="table-wrap-modern">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: '40px' }}>
                          <input type="checkbox" checked={payments.length > 0 && payments.every(p => selectedPayments.has(p.id))} onChange={handleSelectAll} style={{ cursor: 'pointer', width: '18px', height: '18px' }} />
                        </th>
                        <th>Payment ID</th>
                        <th>User</th>
                        <th>Type</th>
                        <th>Amount</th>
                        <th>UTR</th>
                        <th>Status</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.length === 0 ? (
                        <tr><td colSpan={8}><div className="empty-state-modern"><span className="empty-icon">{'\u{1F4B3}'}</span><span className="empty-text">{loadingPayments ? 'Loading...' : 'No pending payments found'}</span></div></td></tr>
                      ) : payments.map(p => (
                        <tr key={p.id} className={selectedPayments.has(p.id) ? 'row-selected' : ''}>
                          <td>
                            <input type="checkbox" checked={selectedPayments.has(p.id)} onChange={() => handleSelectPayment(p.id)} style={{ cursor: 'pointer', width: '18px', height: '18px' }} />
                          </td>
                          <td data-label="Payment ID"><code style={{ fontSize: '0.75rem' }}>{p.id ? p.id.substring(0, 16) + '...' : '\u2014'}</code></td>
                          <td data-label="User">{p.user_name || p.user_id?.substring(0, 12) || '\u2014'}</td>
                          <td data-label="Type">{p.payment_type || '\u2014'}</td>
                          <td data-label="Amount">₹{Number(p.amount || 0).toFixed(2)}</td>
                          <td data-label="UTR"><code style={{ fontSize: '0.75rem' }}>{p.utr ? p.utr.substring(0, 16) : '\u2014'}</code></td>
                          <td data-label="Status"><span className={getStatusBadgeClass(p.status)}>{(p.status || 'pending').charAt(0).toUpperCase() + (p.status || 'pending').slice(1)}</span></td>
                          <td data-label="Date" className="text-xs">{formatDateTime(p.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'payment-tools' && (
            <div className="tools-panel">
              <div className="tools-grid">
                <div className="card-modern">
                  <h2 className="card-modern-title" style={{ marginBottom: '1rem' }}>{'\u{1F50D}'} Re-run OCR</h2>
                  <p className="muted text-sm" style={{ marginBottom: '1rem' }}>Reset OCR state for a payment and re-extract text from the screenshot.</p>
                  <div className="search-bar-modern">
                    <input
                      placeholder="Enter Payment ID"
                      value={paymentId}
                      onChange={e => setPaymentId(e.target.value)}
                    />
                    <button className={`btn-modern btn-modern-primary${rerunOcrLoading ? ' btn-loading' : ''}`} onClick={handleRerunOcr} disabled={rerunOcrLoading}>
                      {rerunOcrLoading ? 'Running...' : 'Re-run OCR'}
                    </button>
                  </div>
                </div>

                <div className="card-modern">
                  <h2 className="card-modern-title" style={{ marginBottom: '1rem' }}>{'\u{1F504}'} Re-run Verification</h2>
                  <p className="muted text-sm" style={{ marginBottom: '1rem' }}>Reset verification state and re-run the full verification pipeline.</p>
                  <div className="search-bar-modern">
                    <input
                      placeholder="Enter Payment ID"
                      value={paymentId}
                      onChange={e => setPaymentId(e.target.value)}
                    />
                    <button className={`btn-modern btn-modern-warning${rerunVerLoading ? ' btn-loading' : ''}`} onClick={handleRerunVerification} disabled={rerunVerLoading}>
                      {rerunVerLoading ? 'Running...' : 'Re-run Verification'}
                    </button>
                  </div>
                </div>

                <div className="card-modern" style={{ gridColumn: '1 / -1' }}>
                  <h2 className="card-modern-title" style={{ marginBottom: '1rem' }}>{'\u{1F50E}'} Single Payment Lookup</h2>
                  <div className="search-bar-modern" style={{ marginBottom: '1rem' }}>
                    <input
                      placeholder="Enter Payment ID"
                      value={paymentLookupId}
                      onChange={e => setPaymentLookupId(e.target.value)}
                    />
                    <button className={`btn-modern btn-modern-primary${paymentLookupLoading ? ' btn-loading' : ''}`} onClick={handleLookupPayment} disabled={paymentLookupLoading}>
                      {paymentLookupLoading ? 'Looking up...' : 'Lookup'}
                    </button>
                  </div>
                  {paymentLookup && (
                    <div className="detail-grid-sm">
                      <div className="detail-row">
                        <span className="detail-label">ID</span>
                        <span className="detail-value"><code>{paymentLookup.id}</code></span>
                      </div>
                      <div className="detail-row">
                        <span className="detail-label">Status</span>
                        <span className="detail-value"><span className={getStatusBadgeClass(paymentLookup.status)}>{(paymentLookup.status || 'pending').charAt(0).toUpperCase() + (paymentLookup.status || 'pending').slice(1)}</span></span>
                      </div>
                      <div className="detail-row">
                        <span className="detail-label">Amount</span>
                        <span className="detail-value">₹{Number(paymentLookup.amount || 0).toFixed(2)}</span>
                      </div>
                      <div className="detail-row">
                        <span className="detail-label">UTR</span>
                        <span className="detail-value">{paymentLookup.utr || '\u2014'}</span>
                      </div>
                      <div className="detail-row">
                        <span className="detail-label">Type</span>
                        <span className="detail-value">{paymentLookup.payment_type || '\u2014'}</span>
                      </div>
                      <div className="detail-row">
                        <span className="detail-label">User</span>
                        <span className="detail-value">{paymentLookup.user_name || paymentLookup.user_id || '\u2014'}</span>
                      </div>
                      <div className="detail-row">
                        <span className="detail-label">Created</span>
                        <span className="detail-value">{formatDateTime(paymentLookup.created_at)}</span>
                      </div>
                      <div className="detail-row">
                        <span className="detail-label">OCR Result</span>
                        <span className="detail-value">{paymentLookup.ocr_result ? 'Available' : '\u2014'}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'reports' && (
            <div className="tools-panel">
              <div className="card-modern">
                <div className="card-modern-header">
                  <h2 className="card-modern-title">{'\u{1F4E5}'} Download Reports</h2>
                </div>
                <div className="tools-section">
                  <p className="muted text-sm" style={{ marginBottom: '1rem' }}>Generate and download payment reports in CSV format.</p>
                  <div className="tools-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                    <button className={`report-btn${reportLoading === 'daily' ? ' loading' : ''}`} onClick={() => handleDownloadReport('daily')} disabled={reportLoading !== null}>
                      {reportLoading === 'daily' ? 'Generating...' : '\u{1F4C5}'} Daily Report
                    </button>
                    <button className={`report-btn${reportLoading === 'weekly' ? ' loading' : ''}`} onClick={() => handleDownloadReport('weekly')} disabled={reportLoading !== null}>
                      {reportLoading === 'weekly' ? 'Generating...' : '\u{1F4C6}'} Weekly Report
                    </button>
                    <button className={`report-btn${reportLoading === 'monthly' ? ' loading' : ''}`} onClick={() => handleDownloadReport('monthly')} disabled={reportLoading !== null}>
                      {reportLoading === 'monthly' ? 'Generating...' : '\u{1F4C7}'} Monthly Report
                    </button>
                    <button className={`report-btn${reportLoading === 'all' ? ' loading' : ''}`} onClick={() => handleDownloadReport('all')} disabled={reportLoading !== null}>
                      {reportLoading === 'all' ? 'Generating...' : '\u{1F4CA}'} All Time Report
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'audit' && (
            <div className="tools-panel">
              <div className="card-modern">
                <div className="card-modern-header">
                  <h2 className="card-modern-title">{'\u{1F4DD}'} Audit Log</h2>
                  <button className="btn-modern btn-modern-ghost btn-modern-sm" onClick={fetchAuditLogs} disabled={auditLoading}>
                    {auditLoading ? '...' : '\u{1F504}'} Refresh
                  </button>
                </div>

                <div className="search-bar-modern" style={{ marginBottom: '1rem' }}>
                  <select value={auditFilterAction} onChange={e => setAuditFilterAction(e.target.value)}>
                    <option value="">All Actions</option>
                    <option value="approve_registration_payment">Approve Registration</option>
                    <option value="approve_topup_payment">Approve Topup</option>
                    <option value="reject_payment">Reject Payment</option>
                    <option value="restore_payment">Restore Payment</option>
                    <option value="delete_payment">Delete Payment</option>
                    <option value="admin_login">Admin Login</option>
                  </select>
                  <input type="date" value={auditDateFrom} onChange={e => setAuditDateFrom(e.target.value)} placeholder="From date" />
                  <input type="date" value={auditDateTo} onChange={e => setAuditDateTo(e.target.value)} placeholder="To date" />
                  <button className="btn-modern btn-modern-primary btn-modern-sm" onClick={fetchAuditLogs} disabled={auditLoading}>
                    Filter
                  </button>
                </div>

                <div className="audit-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>Target</th>
                        <th>Admin</th>
                        <th>Details</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.length === 0 ? (
                        <tr><td colSpan={5}><div className="empty-state-modern"><span className="empty-icon">{'\u{1F4DD}'}</span><span className="empty-text">{auditLoading ? 'Loading...' : 'No audit logs found'}</span></div></td></tr>
                      ) : auditLogs.map(log => (
                        <tr key={log.id || log._id}>
                          <td data-label="Action"><span className="badge badge-pending" style={{ fontSize: '0.7rem' }}>{getActionLabel(log.action)}</span></td>
                          <td data-label="Target" style={{ fontSize: '0.85rem' }}>
                            {log.target_type ? `${log.target_type} ` : ''}
                            {log.target_id ? <code style={{ fontSize: '0.7rem' }}>{log.target_id.substring(0, 16)}...</code> : '\u2014'}
                          </td>
                          <td data-label="Admin" style={{ fontSize: '0.85rem' }}>{log.admin_id || log.adminId || log.admin_name || '\u2014'}</td>
                          <td data-label="Details" style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                            {log.details ? (
                              typeof log.details === 'string' ? log.details : (
                                Object.entries(log.details).map(([k, v]) => <div key={k}><strong>{k}:</strong> {typeof v === 'object' ? JSON.stringify(v) : v}</div>)
                              )
                            ) : log.reason || '\u2014'}
                          </td>
                          <td data-label="Date" style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{formatDateTime(log.created_at || log.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
