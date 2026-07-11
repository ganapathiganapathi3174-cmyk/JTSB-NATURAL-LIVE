import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FirebaseUser } from '../db/firebase-db.js';
import UpiPayment from '../components/UpiPayment.jsx';

export default function PaymentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlMode = searchParams.get('mode') || '';
  const isTopup = urlMode === 'topup';

  const [topupUserId] = useState(() => localStorage.getItem('fb_user_id') || '');
  const [allowedPackage, setAllowedPackage] = useState(null);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (isTopup && topupUserId) {
      FirebaseUser.findById(topupUserId).then(user => {
        if (user && user.membership_type) setAllowedPackage(Number(user.membership_type));
      }).catch(() => {});
    }
  }, [isTopup, topupUserId]);

  if (!isTopup) { navigate('/fb/register', { replace: true }); return null; }
  if (isTopup && !topupUserId) { navigate('/fb/login', { replace: true }); return null; }

  function handleUpiSuccess() { setSubmitted(true); }

  if (submitted) {
    return (
      <div className="page-wrap" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div className="card-glass text-center animate-fade-in-up" style={{ maxWidth: 440, padding: '2.5rem' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg, var(--success), #4ADE80)', color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.75rem', margin: '0 auto 1.25rem', boxShadow: '0 0 30px rgba(34,197,94,0.3)' }}>✓</div>
          <h2 style={{ margin: 0 }} className="text-gradient-success">Topup Submitted!</h2>
          <p className="text-muted text-sm" style={{ marginTop: '0.75rem', lineHeight: 1.6 }}>Your topup request has been submitted. Wallet will be updated after verification.</p>
          <Link to="/fb/dashboard" className="btn btn-primary mt-lg" style={{ display: 'inline-flex' }}>Back to Dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page-wrap" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div className="text-center mb-lg animate-fade-in-up">
        <div className="brand" style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>
          <span className="text-gradient">JTSB Natural</span>
        </div>
        <p className="text-muted text-sm" style={{ margin: 0 }}>Premium FinTech Platform</p>
      </div>

      <div className="card-glass animate-fade-in-up stagger-1" style={{ width: '100%', maxWidth: 480, padding: '1.5rem' }}>
        <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.35rem', letterSpacing: '-0.03em' }} className="text-gradient">Wallet Topup</h1>
        <p className="text-muted text-sm mb-lg" style={{ margin: '0 0 1.25rem' }}>Add funds to your wallet via UPI</p>

        {error && (
          <div className="card-dim mb-md" style={{ background: 'var(--danger-light)', border: '1px solid rgba(239,68,68,0.2)', padding: '0.75rem 1rem', fontSize: '0.85rem', color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        <UpiPayment
          type="topup"
          userId={topupUserId}
          allowedPackage={allowedPackage}
          onSuccess={handleUpiSuccess}
          onError={(msg) => setError(msg)}
        />
      </div>
    </div>
  );
}
