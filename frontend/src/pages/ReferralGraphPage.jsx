import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FirebaseUser } from '../db/firebase-db.js';

function ReferralGraphModal({ user, onClose }) {
  const [graphData, setGraphData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.referral_code) return;
    let cancelled = false;
    setLoading(true);

    async function loadGraphData() {
      try {
        const referrer = await FirebaseUser.findByReferralCode(user.referral_code);
        if (cancelled) return;
        let referredByUser = null;
        if (referrer?.referred_by) {
          referredByUser = await FirebaseUser.findByReferralCode(referrer.referred_by);
        }
        if (cancelled) return;
        const referredUsers = await FirebaseUser.getReferralsByReferrerCode(user.referral_code);
        if (!cancelled) setGraphData({ referrer, referredByUser, referredUsers });
      } catch (err) {
        if (!cancelled) console.error('Graph load error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadGraphData();

    return () => { cancelled = true; };
  }, [user?.referral_code]);

  if (!user) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Referral Graph</h2>
          <button onClick={onClose} className="modal-close">{'\u2715'}</button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center gap-md" style={{ padding: '2rem' }}>
            <div className="loading-spinner loading-spinner-lg" />
            <span className="text-muted text-sm">Loading...</span>
          </div>
        ) : (
          <div className="modal-body">
            <div className="flex flex-col items-center gap-md">
              {graphData?.referredByUser && (
                <div className="card" style={{ background: 'var(--primary-soft)', border: '1px solid rgba(139,92,246,0.2)', textAlign: 'center', padding: '1rem', width: '100%', maxWidth: 300 }}>
                  <div className="font-semibold">{graphData.referredByUser.name}</div>
                  <div className="text-sm text-muted">{graphData.referredByUser.email}</div>
                  <div className="text-xs text-muted mt-xs">Referrer</div>
                </div>
              )}

              {graphData?.referredByUser && (
                <div style={{ width: 2, height: 24, background: 'var(--border)' }} />
              )}

              <div className="card" style={{ background: 'var(--success-soft)', border: '1px solid rgba(16,185,129,0.2)', textAlign: 'center', padding: '1rem', width: '100%', maxWidth: 300 }}>
                <div className="font-semibold">{user.name}</div>
                <div className="text-sm text-muted">{user.email}</div>
                <div className="text-xs text-muted mt-xs">
                  Code: {user.referral_code} | Referrals: {user.referrals_count || 0}/2
                </div>
              </div>

              {graphData?.referredUsers?.length > 0 && (
                <>
                  <div style={{ width: 2, height: 24, background: 'var(--border)' }} />
                  <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
                    {graphData.referredUsers.map((ref) => (
                      <div key={ref.id} className="card-dim text-center">
                        <div className="font-semibold text-sm">{ref.name}</div>
                        <div className="text-sm text-muted">{ref.email || '—'}</div>
                        <div className="text-xs text-muted">{ref.phone || '—'}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {(!graphData?.referredByUser && graphData?.referredUsers?.length === 0) && (
                <div className="text-muted text-sm">No referral connections</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ReferralGraphPage() {
  const [searchParams] = useSearchParams();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadUser(code) {
      try {
        const userData = await FirebaseUser.findByReferralCode(code);
        if (!cancelled) setUser(userData);
      } catch (err) {
        if (!cancelled) console.error('Load error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    const code = searchParams.get('code');
    if (code) {
      loadUser(code);
    } else {
      setLoading(false);
    }

    return () => { cancelled = true; };
  }, [searchParams]);

  if (loading) {
    return (
      <div className="page-wrap flex flex-center">
        <div className="loading-spinner loading-spinner-lg" />
        <div className="loading-text">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page-wrap flex flex-center">
        <div className="text-muted text-sm">User not found</div>
      </div>
    );
  }

  return (
    <div className="page-wrap flex flex-center" style={{ minHeight: '100vh' }}>
      <ReferralGraphModal user={user} onClose={() => window.close()} />
    </div>
  );
}
