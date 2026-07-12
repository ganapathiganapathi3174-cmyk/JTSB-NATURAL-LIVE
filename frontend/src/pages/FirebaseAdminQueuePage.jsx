import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminSidebar from '../components/AdminSidebar.jsx';

const API_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';
const ADMIN_KEY = 'fb_admin_token';

function authHeaders() {
  const t = localStorage.getItem(ADMIN_KEY);
  return t ? { 'Cache-Control': 'no-cache', 'Authorization': 'Bearer ' + t } : { 'Cache-Control': 'no-cache' };
}

export default function FirebaseAdminQueuePage() {
  const navigate = useNavigate();
  const [queueData, setQueueData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [actionMsg, setActionMsg] = useState('');

  useEffect(() => {
    const token = localStorage.getItem(ADMIN_KEY);
    if (!token) { navigate('/fb-admin'); return; }
    fetchQueue();
    const interval = setInterval(fetchQueue, 15000);
    return () => clearInterval(interval);
  }, [navigate]);

  async function fetchQueue() {
    try {
      const res = await fetch(`${API_BASE}/getQueueStatus`, { headers: authHeaders() });
      if (res.ok) {
        setQueueData(await res.json());
        setError('');
      }
    } catch (err) {
      setError('Failed to fetch queue data');
    } finally {
      setLoading(false);
    }
  }

  async function processPending() {
    setProcessing(true);
    setActionMsg('');
    try {
      const res = await fetch(`${API_BASE}/processPendingPayments`, {
        method: 'POST', headers: authHeaders(), body: '{}',
      });
      if (res.ok) {
        setActionMsg('\u2713 Processing complete');
        await fetchQueue();
      } else {
        setActionMsg('\u2715 Processing failed');
      }
    } catch (err) {
      setActionMsg('\u2715 Error: ' + err.message);
    } finally {
      setProcessing(false);
    }
  }

  function getAdminName() {
    try {
      return sessionStorage.getItem('fb_admin_name') || localStorage.getItem('fb_admin_name') || 'Admin';
    } catch { return 'Admin'; }
  }

  return (
    <div className="page-wrap">
      <AdminSidebar userName={getAdminName()} />
      <main className="layout-inner">
        <div className="page-header">
          <h1 className="page-title">Queue Monitor</h1>
          <div className="page-actions">
            <button className="btn btn-primary" onClick={processPending} disabled={processing}>
              {processing ? 'Processing...' : '\u25B6 Process Pending'}
            </button>
            <button className="btn btn-ghost" onClick={fetchQueue} disabled={loading}>Refresh</button>
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {actionMsg && <div className="alert alert-success">{actionMsg}</div>}

        {loading && (
          <div className="flex flex-col items-center gap-md" style={{ padding: '2rem' }}>
            <div className="loading-spinner loading-spinner-lg" />
            <p className="text-muted text-sm">Loading queue...</p>
          </div>
        )}

        {queueData && (
          <>
            <div className="stats-grid">
              <div className={`stat-card ${queueData.ocr_queue > 0 ? 'accent-primary' : 'accent-success'}`}>
                <div className="stat-value">{queueData.ocr_queue}</div>
                <div className="stat-label">OCR Queue</div>
                <div className="stat-sub">Pending OCR processing</div>
              </div>
              <div className={`stat-card ${queueData.retry_queue > 0 ? 'accent-warning' : 'accent-success'}`}>
                <div className="stat-value">{queueData.retry_queue}</div>
                <div className="stat-label">Retry Queue</div>
                <div className="stat-sub">Failed OCR (3+ retries)</div>
              </div>
              <div className={`stat-card ${queueData.manual_review > 0 ? 'accent-warning' : 'accent-success'}`}>
                <div className="stat-value">{queueData.manual_review}</div>
                <div className="stat-label">Manual Review</div>
                <div className="stat-sub">Awaiting admin decision</div>
              </div>
              <div className={`stat-card ${queueData.stuck_items > 0 ? 'accent-danger' : 'accent-success'}`}>
                <div className="stat-value">{queueData.stuck_items}</div>
                <div className="stat-label">Stuck Items</div>
                <div className="stat-sub">Processing &gt;5 min</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{queueData.pending_verification}</div>
                <div className="stat-label">Pending Verification</div>
                <div className="stat-sub">Awaiting verification check</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{queueData.pending_registrations}</div>
                <div className="stat-label">Pending Registrations</div>
                <div className="stat-sub">Unprocessed registrations</div>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h3>Queue Summary</h3>
              </div>
              <div className="card-body">
                <div className="table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Metric</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td>Total Payments</td><td>{queueData.total_payments}</td></tr>
                      <tr><td>Total Registrations</td><td>{queueData.total_registrations}</td></tr>
                      <tr><td>OCR Queue</td><td>{queueData.ocr_queue}</td></tr>
                      <tr><td>Retry Queue</td><td>{queueData.retry_queue}</td></tr>
                      <tr><td>Manual Review</td><td>{queueData.manual_review}</td></tr>
                      <tr><td>Stuck Items</td><td>{queueData.stuck_items}</td></tr>
                      <tr><td>Pending Verification</td><td>{queueData.pending_verification}</td></tr>
                      <tr><td>Pending Registrations</td><td>{queueData.pending_registrations}</td></tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-sm text-muted" style={{ marginTop: '0.5rem' }}>
                  Last updated: {queueData.timestamp ? new Date(queueData.timestamp).toLocaleString() : 'N/A'}
                </p>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
