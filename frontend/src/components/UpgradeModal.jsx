import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_FUNCTIONS_URL || '/api';

export default function UpgradeModal({ userId, currentPlan, onClose, onSuccess }) {
  const [upgradeStatus, setUpgradeStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    fetchUpgradeStatus();
  }, [userId]);

  async function fetchUpgradeStatus() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/getUserUpgradeStatus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (data.success) setUpgradeStatus(data);
      else setError(data.error || 'Failed to load');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    if (!selectedPlan) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/createUpgradeRequest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, requestedPlan: selectedPlan }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess('Upgrade request submitted! Admin will review it shortly.');
        if (onSuccess) onSuccess(data);
        fetchUpgradeStatus();
      } else {
        setError(data.error || 'Failed to submit');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const planLabels = {
    120: { name: 'Starter', features: ['Basic membership', 'Standard support'] },
    500: { name: 'Pro', features: ['Premium membership', 'Priority support', 'Referral bonus'] },
    1000: { name: 'Elite', features: ['Elite membership', 'VIP support', 'Max referral bonus', 'Sponsor eligibility'] },
  };

  if (loading) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
          <div className="modal-body" style={{ textAlign: 'center', padding: '2rem' }}>
            <div className="loading-spinner loading-spinner-lg" />
            <p className="text-muted mt-sm">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  const availablePlans = upgradeStatus?.availablePlans || [];
  const hasPending = upgradeStatus?.hasPendingRequest;
  const pendingRequest = upgradeStatus?.pendingRequest;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
        <div className="modal-header">
          <h2>Upgrade Membership</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-error mb-md">{error}</div>}
          {success && <div className="alert alert-success mb-md">{success}</div>}

          <div className="mb-md">
            <p className="text-muted">Current Plan: <strong className="badge badge-outline">₹{currentPlan || upgradeStatus?.currentPlan || 0}</strong></p>
          </div>

          {hasPending ? (
            <div className="alert alert-info">
              <p>You have a pending upgrade request to <strong>₹{pendingRequest?.requested_plan}</strong></p>
              <p className="text-xs text-muted mt-xs">Submitted: {pendingRequest?.created_at ? new Date(pendingRequest.created_at).toLocaleString() : ''}</p>
              <p className="text-xs text-muted">Please wait for admin approval.</p>
            </div>
          ) : availablePlans.length === 0 ? (
            <div className="alert alert-info">
              <p>You are already on the highest plan. No upgrades available.</p>
            </div>
          ) : (
            <>
              <p className="text-muted mb-md">Select a plan to upgrade:</p>
              <div className="flex flex-col gap-sm">
                {availablePlans.map(plan => (
                  <div
                    key={plan}
                    className={`card p-md ${selectedPlan === plan ? 'card-selected' : ''}`}
                    onClick={() => setSelectedPlan(plan)}
                    style={{ cursor: 'pointer', border: selectedPlan === plan ? '2px solid var(--primary)' : '2px solid transparent' }}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-lg">{planLabels[plan]?.name || 'Plan'}</div>
                        <div className="text-xl font-bold" style={{ color: 'var(--primary)' }}>₹{plan}</div>
                      </div>
                      <div className="text-xs text-muted" style={{ maxWidth: 200 }}>
                        <ul style={{ margin: 0, paddingLeft: '1rem' }}>
                          {(planLabels[plan]?.features || []).map((f, i) => (
                            <li key={i}>{f}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {selectedPlan && (
                <div className="mt-md card p-md" style={{ background: 'var(--info-bg)' }}>
                  <p className="mb-sm">You selected: <strong>₹{selectedPlan}</strong></p>
                  <p className="text-xs text-muted">An upgrade request will be sent to admin for approval.</p>
                  <button
                    className="btn btn-primary w-full mt-md"
                    onClick={handleSubmit}
                    disabled={submitting}
                  >
                    {submitting ? 'Submitting...' : 'Submit Upgrade Request'}
                  </button>
                </div>
              )}
            </>
          )}

          {upgradeStatus?.previousRequests?.length > 0 && (
            <div className="mt-md">
              <p className="text-xs text-muted mb-xs">Previous requests:</p>
              {upgradeStatus.previousRequests.map(r => (
                <div key={r.id} className="text-xs flex items-center gap-sm" style={{ padding: '0.25rem 0' }}>
                  <span>₹{r.current_plan} → ₹{r.requested_plan}</span>
                  <span className={`badge badge-sm ${
                    r.status === 'approved' ? 'badge-success' :
                    r.status === 'rejected' ? 'badge-danger' : 'badge-warning'
                  }`}>{r.status}</span>
                  <span className="text-muted">{r.created_at ? new Date(r.created_at).toLocaleDateString() : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
