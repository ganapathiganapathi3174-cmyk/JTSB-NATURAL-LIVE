import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FirebaseUser } from '../db/firebase-db.js';

function ReferralGraphModal({ user, onClose }) {
  const [graphData, setGraphData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.referral_code) {
      setLoading(true);
      loadGraphData();
    }
  }, [user?.referral_code]);

  async function loadGraphData() {
    try {
      const referrer = await FirebaseUser.findByReferralCode(user.referral_code);
      let referredByUser = null;
      if (referrer?.referred_by) {
        referredByUser = await FirebaseUser.findByReferralCode(referrer.referred_by);
      }
      const referredUsers = await FirebaseUser.getReferralsByReferrerCode(user.referral_code);
      setGraphData({ referrer, referredByUser, referredUsers });
    } catch (err) {
      console.error('Graph load error:', err);
    } finally {
      setLoading(false);
    }
  }

  if (!user) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2>Referral Graph</h2>
          <button onClick={onClose} className="btn btn-ghost">✕</button>
        </div>

        {loading ? (
          <div className="muted">Loading...</div>
        ) : (
          <div style={{ padding: '1rem' }}>
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              gap: '2rem' 
            }}>
              {graphData?.referredByUser && (
                <div style={{ 
                  padding: '1rem', 
                  background: 'var(--primary)', 
                  color: 'white',
                  borderRadius: '8px',
                  textAlign: 'center',
                  minWidth: '200px'
                }}>
                  <div style={{ fontWeight: 'bold' }}>{graphData.referredByUser.name}</div>
                  <div style={{ fontSize: '0.85rem', opacity: 0.9 }}>{graphData.referredByUser.email}</div>
                  <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: '0.25rem' }}>Referrer</div>
                </div>
              )}

              {graphData?.referredByUser && (
                <div style={{ 
                  width: '2px', 
                  height: '40px', 
                  background: 'var(--border)',
                  position: 'relative'
                }}>
                  <div style={{ 
                    position: 'absolute', 
                    top: '-6px', 
                    left: '50%', 
                    transform: 'translateX(-50%)',
                    borderLeft: '8px solid transparent',
                    borderRight: '8px solid transparent',
                    borderTop: '10px solid var(--border)'
                  }} />
                </div>
              )}

              <div style={{ 
                padding: '1rem', 
                background: 'var(--success)', 
                color: 'white',
                borderRadius: '8px',
                textAlign: 'center',
                minWidth: '200px'
              }}>
                <div style={{ fontWeight: 'bold' }}>{user.name}</div>
                <div style={{ fontSize: '0.85rem', opacity: 0.9 }}>{user.email}</div>
                <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: '0.25rem' }}>
                  Code: {user.referral_code} | Referrals: {user.referrals_count || 0}/2
                </div>
              </div>

              {graphData?.referredUsers?.length > 0 && (
                <>
                  <div style={{ 
                    width: '2px', 
                    height: '40px', 
                    background: 'var(--border)',
                    position: 'relative'
                  }}>
                    <div style={{ 
                      position: 'absolute', 
                      top: '-6px', 
                      left: '50%', 
                      transform: 'translateX(-50%)',
                      borderLeft: '8px solid transparent',
                      borderRight: '8px solid transparent',
                      borderTop: '10px solid var(--border)'
                    }} />
                  </div>

                  <div style={{ 
                    display: 'flex', 
                    gap: '1rem', 
                    flexWrap: 'wrap', 
                    justifyContent: 'center' 
                  }}>
                    {graphData.referredUsers.map((ref) => (
                      <div key={ref.id} style={{ 
                        padding: '1rem', 
                        background: 'var(--bg)', 
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        textAlign: 'center',
                        minWidth: '150px'
                      }}>
                        <div style={{ fontWeight: 'bold' }}>{ref.name}</div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{ref.email || '—'}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{ref.phone || '—'}</div>
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
    const code = searchParams.get('code');
    if (code) {
      loadUser(code);
    }
  }, [searchParams]);

  async function loadUser(code) {
    try {
      const userData = await FirebaseUser.findByReferralCode(code);
      setUser(userData);
    } catch (err) {
      console.error('Load error:', err);
    } finally {
      setLoading(false);
    }
  }

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