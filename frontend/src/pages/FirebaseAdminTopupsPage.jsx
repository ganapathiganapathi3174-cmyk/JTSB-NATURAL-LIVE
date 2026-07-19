import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FirebaseTopup } from '../db/firebase-db.js';
import AdminSidebar from '../components/AdminSidebar.jsx';

const ADMIN_KEY = 'fb_admin_token';
const FUNCTIONS_URL = import.meta.env.VITE_FUNCTIONS_URL || '/api';

function authHeaders() {
  const t = localStorage.getItem(ADMIN_KEY);
  return t ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t } : { 'Content-Type': 'application/json' };
}

function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getRelativeTime(dateStr) {
  if (!dateStr) return '';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMs / 3600000);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function DeleteConfirmModal({ topup, onConfirm, onClose, loading, errorMsg }) {
  const [reason, setReason] = useState('');
  if (!topup) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Delete Topup</h2>
          <button onClick={onClose} className="modal-close">{'\u2715'}</button>
        </div>
        <div className="modal-body">
          <div className="alert alert-error">
            <strong>{'\u26A0\uFE0F'} Warning:</strong> This will permanently delete this topup record from the database.
          </div>
          <div className="card-dim mb-md">
            <div className="detail-row">
              <span className="detail-label text-sm text-muted">User</span>
              <div className="font-semibold">{topup.userName}</div>
            </div>
            <div className="detail-row">
              <span className="detail-label text-sm text-muted">Amount</span>
              <div className="font-bold">₹{Number(topup.amount || 0).toFixed(2)}</div>
            </div>
          </div>
          <div className="field">
            <label>Reason for deletion *</label>
            <textarea className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is this topup being deleted?" rows={3} />
          </div>
          {errorMsg && <div className="alert alert-error">{errorMsg}</div>}
        </div>
        <div className="modal-footer">
          <button className={`btn btn-danger${loading ? ' btn-loading' : ''}`} onClick={() => onConfirm(reason)} disabled={loading || !reason.trim()}>
            {loading ? 'Deleting...' : 'Delete Topup'}
          </button>
          <button className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function RestoreConfirmModal({ topup, onConfirm, onClose, loading }) {
  if (!topup) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Restore Topup</h2>
          <button onClick={onClose} className="modal-close">{'\u2715'}</button>
        </div>
        <div className="modal-body">
          <div className="alert alert-success">
            This will restore the topup to active status. It will reappear in dashboards and revenue calculations.
          </div>
          <div className="card-dim mb-md">
            <div className="detail-row">
              <span className="detail-label text-sm text-muted">User</span>
              <div className="font-semibold">{topup.userName}</div>
            </div>
            <div className="detail-row">
              <span className="detail-label text-sm text-muted">Amount</span>
              <div className="font-bold">₹{Number(topup.amount || 0).toFixed(2)}</div>
            </div>
            {topup.deletedBy && <div className="detail-row"><span className="detail-label text-sm text-muted">Deleted By</span><div>{topup.deletedBy}</div></div>}
            {topup.deletedAt && <div className="detail-row"><span className="detail-label text-sm text-muted">Deleted At</span><div>{formatDateTime(topup.deletedAt)}</div></div>}
          </div>
        </div>
        <div className="modal-footer">
          <button className={`btn btn-primary${loading ? ' btn-loading' : ''}`} onClick={onConfirm} disabled={loading}>
            {loading ? 'Restoring...' : 'Restore Topup'}
          </button>
          <button className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function AuditLogModal({ topup, onClose }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!topup) return;
    setLoading(true);
    FirebaseTopup.getAuditLog(topup.id).then(setLogs).catch(() => setLogs([])).finally(() => setLoading(false));
  }, [topup]);

  if (!topup) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Audit Log — {topup.userName}</h2>
          <button onClick={onClose} className="modal-close">{'\u2715'}</button>
        </div>
        <div className="modal-body">
          {loading ? (
            <div className="text-muted text-center" style={{ padding: '1rem' }}>Loading audit trail...</div>
          ) : logs.length === 0 ? (
            <div className="text-muted text-center" style={{ padding: '1rem' }}>No audit records found.</div>
          ) : (
            <div className="flex flex-col gap-sm">
              {logs.map(log => (
                <div key={log.id} className="flex flex-between items-center gap-sm" style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <span className={`badge ${log.action === 'delete' ? 'badge-danger' : 'badge-success'} badge-xs`}>
                      {log.action === 'delete' ? 'Deleted' : 'Restored'}
                    </span>
                    <div className="text-sm mt-xs">
                      By <strong>{log.adminId}</strong>{log.reason ? ` — ${log.reason}` : ''}
                    </div>
                  </div>
                  <span className="text-xs text-muted">{formatDateTime(log.timestamp)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default function FirebaseAdminTopupsPage() {
  const navigate = useNavigate();
  const [topups, setTopups] = useState([]);
  const [selectedTopup, setSelectedTopup] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [auditTarget, setAuditTarget] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem(ADMIN_KEY);
    if (!token) { navigate('/fb-admin', { replace: true }); return; }
    try {
      const body = JSON.parse(atob(token.split('.')[1]));
      const exp = body.exp;
      if (!exp || Math.floor(Date.now() / 1000) > exp) {
        localStorage.removeItem(ADMIN_KEY);
        localStorage.removeItem('fb_admin_login_at');
        navigate('/fb-admin', { replace: true }); return;
      }
    } catch { navigate('/fb-admin', { replace: true }); return; }
    const unsubscribe = FirebaseTopup.subscribeToTopups((data) => {
      setTopups(data || []);
    });
    return () => { if (unsubscribe) unsubscribe(); };
  }, [navigate]);

  const handleReview = useCallback((topup) => {
    setSelectedTopup(topup);
  }, []);

  const stats = useMemo(() => {
    let approved = 0, pending = 0, rejected = 0, deleted = 0;
    for (const t of topups) {
      if (t.deleted) { deleted++; continue; }
      if (t.status === 'approved') approved++;
      else if (t.status === 'pending') pending++;
      else if (t.status === 'rejected') rejected++;
    }
    return { approved, pending, rejected, deleted };
  }, [topups]);

  const filteredTopups = useMemo(() => {
    let filtered = topups;
    filtered = filtered.filter(t => showDeleted ? t.deleted : !t.deleted);
    if (statusFilter) {
      filtered = filtered.filter(t => t.status === statusFilter);
    }
    if (q) {
      const ql = q.toLowerCase();
      filtered = filtered.filter(t =>
        (t.userName && t.userName.toLowerCase().includes(ql)) ||
        (t.userEmail && t.userEmail.toLowerCase().includes(ql))
      );
    }
    return filtered;
  }, [topups, statusFilter, q, showDeleted]);

  async function handleDelete(reason) {
    if (!deleteTarget) return;
    if (!reason.trim()) {
      setDeleteError('Please enter a reason for deletion');
      return;
    }
    setActionLoading(true);
    setDeleteError('');
    try {
      if (!localStorage.getItem(ADMIN_KEY)) {
        setDeleteError('Session expired. Please re-login.');
        setActionLoading(false);
        return;
      }
      const res = await fetch(`${FUNCTIONS_URL}/adminDeleteRecord`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          recordId: deleteTarget.id,
          recordType: 'topup',
          reason: reason.trim(),
        }),
      });
      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error('Server returned an empty response. Check that the API server is running (port 3001).');
      }
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setTopups(prev => prev.filter(t => t.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      const msg = err.message || 'Unknown error';
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
      setActionLoading(false);
    }
  }

  async function handleRestore() {
    if (!restoreTarget) return;
    setActionLoading(true);
    try {
      const adminName = getAdminName();
      await FirebaseTopup.restore(restoreTarget.id, adminName);
      setRestoreTarget(null);
    } catch (err) {
      alert('Restore failed: ' + (err.message || 'Unknown error'));
    } finally {
      setActionLoading(false);
    }
  }

  function getAdminName() {
    try {
      return sessionStorage.getItem('fb_admin_name') || localStorage.getItem('fb_admin_name') || 'Admin';
    } catch { return 'Admin'; }
  }

  return (
    <div className="page-wrap animate-fade-in-up">
      <AdminSidebar pendingCounts={{ pendingPayments: 0, pendingTopups: stats.pending }} userName={getAdminName()} />
      <main className="layout-inner">
        <div className="page-header">
          <h1 className="page-title text-gradient">
            {'\u{1F4B0}'}
            Topups
          </h1>
          <div className="page-actions">
            <span className="badge badge-pending badge-xs">{stats.pending} pending</span>
            {stats.deleted > 0 && (
              <span className="badge badge-danger badge-xs">{stats.deleted} deleted</span>
            )}
          </div>
        </div>

        <div className="stats-grid">
          <div className="stat-card accent-success">
            <div className="stat-bg-icon">{'\u2705'}</div>
            <div className="stat-value">{stats.approved}</div>
            <div className="stat-label">Approved</div>
          </div>
          <div className="stat-card accent-warning">
            <div className="stat-bg-icon">{'\u23F3'}</div>
            <div className="stat-value">{stats.pending}</div>
            <div className="stat-label">Pending</div>
          </div>
          <div className="stat-card accent-danger">
            <div className="stat-bg-icon">{'\u2715'}</div>
            <div className="stat-value">{stats.rejected}</div>
            <div className="stat-label">Rejected</div>
          </div>
          <div className="stat-card">
            <div className="stat-bg-icon">{'\u{1F5D1}'}</div>
            <div className="stat-value">{stats.deleted}</div>
            <div className="stat-label">Deleted</div>
          </div>
        </div>

        <div className="card mb-md glass-card">
          <div className="card-header">
            <h2 className="card-title">{'\u{1F50D}'} Search & Filter</h2>
          </div>
          <div className="filters">
            <input className="search-input glass-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or email..." />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All Status</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
              <option value="deleted">Deleted</option>
            </select>
            <label className="flex items-center gap-sm" style={{ whiteSpace: 'nowrap', cursor: 'pointer' }}>
              <input type="checkbox" checked={showDeleted} onChange={e => setShowDeleted(e.target.checked)} />
              <span className="text-sm">Show deleted</span>
            </label>
          </div>
        </div>

        <div className="card glass-card">
          <div className="card-header">
            <h2 className="card-title">{'\u{1F4CB}'} Topup History ({filteredTopups.length})</h2>
          </div>
          <p className="text-sm text-muted mb-md" style={{ padding: '0 1.25rem' }}>
            Topups are auto-approved. Deleted topups use soft delete — records are never permanently removed.
          </p>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>User</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Transaction ID</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTopups.map((t) => (
                  <tr key={t.id} style={t.deleted ? { opacity: 0.6, background: 'var(--danger-soft)' } : {}}>
                    <td data-label="Date" style={{ whiteSpace: 'nowrap' }}>
                      {t.createdAt ? <><div className="text-sm">{new Date(t.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div><div className="text-xs text-muted">{getRelativeTime(t.createdAt)}</div></> : '—'}
                    </td>
                    <td data-label="User">
                      <div className="font-semibold">{t.userName || '—'}</div>
                      <div className="text-xs text-muted">{t.userEmail || ''}</div>
                    </td>
                    <td data-label="Amount" className="font-bold">₹{Number(t.amount || 0).toFixed(2)}</td>
                    <td data-label="Status">
                      {t.deleted ? (
                        <span className="badge badge-danger badge-xs">Deleted</span>
                      ) : (
                        <span className={`badge ${t.status === 'approved' ? 'badge-success' : t.status === 'rejected' ? 'badge-danger' : 'badge-pending'}`}>
                          {t.status ? t.status.charAt(0).toUpperCase() + t.status.slice(1) : 'Pending'}
                        </span>
                      )}
                      {t.deleted && t.deletedAt && (
                        <div className="text-xs text-danger mt-xs">
                          by {t.deletedBy || 'Unknown'} &middot; {getRelativeTime(t.deletedAt)}
                        </div>
                      )}
                    </td>
                    <td data-label="Transaction ID" className="font-mono text-sm">{t.transactionId || '—'}</td>
                    <td data-label="Actions">
                      <div className="flex gap-xs">
                        <button className="btn btn-primary btn-xs" onClick={() => handleReview(t)}>Details</button>
                        {t.deleted ? (
                          <button className="btn btn-success btn-xs" onClick={() => setRestoreTarget(t)}>Restore</button>
                        ) : (
                          <button className="btn btn-danger btn-xs" onClick={() => setDeleteTarget(t)}>Delete</button>
                        )}
                        <button className="btn btn-ghost btn-xs" onClick={() => setAuditTarget(t)} title="Audit Log">Audit</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredTopups.length === 0 && (
                  <tr><td colSpan={6} className="text-center text-muted" style={{ padding: '2rem' }}>No topups found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {selectedTopup && (
          <TopupDetailModal
            topup={selectedTopup}
            onClose={() => setSelectedTopup(null)}
          />
        )}

        {deleteTarget && (
          <DeleteConfirmModal
            topup={deleteTarget}
            onConfirm={handleDelete}
            onClose={() => { setDeleteTarget(null); setDeleteError(''); }}
            loading={actionLoading}
            errorMsg={deleteError}
          />
        )}

        {restoreTarget && (
          <RestoreConfirmModal
            topup={restoreTarget}
            onConfirm={handleRestore}
            onClose={() => setRestoreTarget(null)}
            loading={actionLoading}
          />
        )}

        {auditTarget && (
          <AuditLogModal
            topup={auditTarget}
            onClose={() => setAuditTarget(null)}
          />
        )}
      </main>
    </div>
  );
}

function TopupDetailModal({ topup, onClose }) {
  if (!topup) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Topup Details</h2>
          <button onClick={onClose} className="modal-close">{'\u2715'}</button>
        </div>
        <div className="modal-body">
          <div className="detail-grid">
            <div className="detail-row">
              <span className="detail-label text-sm text-muted">User</span>
              <div className="font-bold" style={{ fontSize: '1.05rem' }}>{topup.userName || '—'}</div>
            </div>
            <div className="detail-row">
              <span className="detail-label text-sm text-muted">Email</span>
              <div className="text-sm">{topup.userEmail || '—'}</div>
            </div>
            <div className="detail-row">
              <span className="detail-label text-sm text-muted">Phone</span>
              <div>{topup.userPhone || '—'}</div>
            </div>
            <div className="detail-row">
              <span className="detail-label text-sm text-muted">Amount</span>
              <div className="font-bold" style={{ fontSize: '1.5rem', color: 'var(--success)' }}>₹{Number(topup.amount || 0).toFixed(2)}</div>
            </div>
            <div className="detail-row">
              <span className="detail-label text-sm text-muted">Transaction ID</span>
              <div className="font-mono" style={{ fontSize: '1rem' }}>{topup.transactionId || '—'}</div>
            </div>
            <div className="detail-row">
              <span className="detail-label text-sm text-muted">Status</span>
              <div>
                {topup.deleted ? (
                  <span className="badge badge-danger badge-xs">Deleted</span>
                ) : (
                  <span className={`badge ${topup.status === 'approved' ? 'badge-success' : topup.status === 'rejected' ? 'badge-danger' : 'badge-pending'}`}>
                    {topup.status ? topup.status.charAt(0).toUpperCase() + topup.status.slice(1) : 'Pending'}
                  </span>
                )}
              </div>
            </div>
            <div className="detail-row">
              <span className="detail-label text-sm text-muted">Submitted At</span>
              <div>{formatDateTime(topup.createdAt)}</div>
              <div className="text-xs text-muted">{getRelativeTime(topup.createdAt)}</div>
            </div>
            {topup.approvedAt && (
              <div className="detail-row">
                <span className="detail-label text-sm text-muted">Approved At</span>
                <div>{formatDateTime(topup.approvedAt)}</div>
              </div>
            )}
            {topup.deleted && (
              <>
                <div className="detail-row">
                  <span className="detail-label text-sm text-muted">Deleted At</span>
                  <div>{formatDateTime(topup.deletedAt)}</div>
                </div>
                <div className="detail-row">
                  <span className="detail-label text-sm text-muted">Deleted By</span>
                  <div>{topup.deletedBy || '—'}</div>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
