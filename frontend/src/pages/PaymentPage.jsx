import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import UpiPayment from '../components/UpiPayment.jsx';

export default function PaymentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlMode = searchParams.get('mode') || '';
  const isTopup = urlMode === 'topup';

  const [topupUserId] = useState(() => localStorage.getItem('fb_user_id') || '');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  if (!isTopup) {
    navigate('/fb/register', { replace: true });
    return null;
  }

  if (isTopup && !topupUserId) {
    navigate('/fb/login', { replace: true });
    return null;
  }

  function handleUpiSuccess() {
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="app-shell">
        <div className="topbar">
          <div className="brand">Starlight Ascent</div>
          <div>
            <Link to="/fb/login">Login</Link>
            {' · '}
            <Link to="/fb-admin">Admin</Link>
          </div>
        </div>
        <div className="card" style={{ maxWidth: 480, margin: '2rem auto', textAlign: 'center', padding: '2rem' }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: '#16a34a', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.75rem', margin: '0 auto 1.25rem',
          }}>✓</div>
          <h2>Topup Submitted!</h2>
          <p className="muted" style={{ marginTop: '0.75rem' }}>
            Your topup request has been submitted. Wallet will be updated after verification.
          </p>
          <Link to="/fb/dashboard" className="btn btn-primary" style={{ marginTop: '1rem', display: 'inline-block' }}>
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">Starlight Ascent</div>
        <div>
          <Link to="/fb/login">Login</Link>
          {' · '}
          <Link to="/fb-admin">Admin</Link>
        </div>
      </div>

      <div className="card payment-card">
        <div className="payment-header">
          <h1>Wallet Topup</h1>
          <p className="muted">Add funds to your wallet via UPI</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="upi-payment-wrap">
          <UpiPayment
            type="topup"
            userId={topupUserId}
            onSuccess={handleUpiSuccess}
            onError={(msg) => setError(msg)}
          />
        </div>
      </div>
    </div>
  );
}
