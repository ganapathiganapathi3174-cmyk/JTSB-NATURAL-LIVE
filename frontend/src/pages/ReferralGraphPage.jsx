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
      <div className="modal graph-container" onClick={e => e.stopPropagation()}>
        <div className="graph-header">
          <h2>Referral Graph</h2>
          <button onClick={onClose} className="btn btn-ghost">✕</button>
        </div>

        {loading ? (
          <div className="muted">Loading...</div>
        ) : (
          <div style={{ padding: '1rem' }}>
            <div className="graph-column">
              {graphData?.referredByUser && (
                <div className="graph-node-primary">
                  <div className="font-bold">{graphData.referredByUser.name}</div>
                  <div className="text-sm" style={{ opacity: 0.9 }}>{graphData.referredByUser.email}</div>
                  <div className="text-xs" style={{ opacity: 0.8, marginTop: '0.25rem' }}>Referrer</div>
                </div>
              )}

              {graphData?.referredByUser && <div className="graph-connector" />}

              <div className="graph-node-success">
                <div className="font-bold">{user.name}</div>
                <div className="text-sm" style={{ opacity: 0.9 }}>{user.email}</div>
                <div className="text-xs" style={{ opacity: 0.8, marginTop: '0.25rem' }}>
                  Code: {user.referral_code} | Referrals: {user.referrals_count || 0}/2
                </div>
              </div>

              {graphData?.referredUsers?.length > 0 && (
                <>
                  <div className="graph-connector" />
                  <div className="graph-children">
                    {graphData.referredUsers.map((ref) => (
                      <div key={ref.id} className="graph-node-child">
                        <div className="font-bold">{ref.name}</div>
                        <div className="text-sm text-muted">{ref.email || '—'}</div>
                        <div className="text-xs text-muted">{ref.phone || '—'}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {(!graphData?.referredByUser && graphData?.referredUsers?.length === 0) && (
                <div className="muted">No referral connections</div>
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
      <div className="app-shell">
        <div className="card">
          <div className="muted">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="app-shell">
        <div className="card">
          <div className="muted">User not found</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="card">
        <ReferralGraphModal user={user} onClose={() => window.close()} />
      </div>
    </div>
  );
}
