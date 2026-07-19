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
      <div className="flex flex-center" style={{ minHeight: '100vh' }}>
        <div className="glass card text-center animate-fade-in-up" style={{ maxWidth: 440, width: '100%' }}>
          <div className="badge" style={{
            width: 64, height: 64, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--success), #4ADE80)', color: 'var(--text)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.75rem', margin: '0 auto 1.25rem', boxShadow: '0 0 30px rgba(34,197,94,0.3)'
          }}>✓</div>
          <h2 className="text-lg font-bold mb-sm text-gradient-success" style={{ margin: 0 }}>Topup Submitted!</h2>
          <p className="text-muted text-sm mb-md" style={{ lineHeight: 1.6 }}>Your topup request has been submitted. Wallet will be updated after verification.</p>
          <Link to="/fb/dashboard" className="btn btn-primary mt-lg" style={{ display: 'inline-flex' }}>Back to Dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-center animate-fade-in-up" style={{ minHeight: '100vh' }}>
      <div className="text-center mb-lg">
        <div className="glass-strong text-lg font-bold mb-xs" style={{ padding: '0.5rem 1.5rem', borderRadius: 'var(--radius-lg)', display: 'inline-block' }}>
          <span className="text-gradient">StarlightAscent</span>
        </div>
        <p className="text-muted text-sm">Premium FinTech Platform</p>
      </div>

      <div className="glass card animate-fade-in-up stagger-1" style={{ width: '100%', maxWidth: 480 }}>
        <h1 className="text-xl font-bold mb-xs text-gradient">Wallet Topup</h1>
        <p className="text-muted text-sm mb-lg">Add funds to your wallet via UPI</p>

        {error && (
          <div className="alert-error mb-md">{error}</div>
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
