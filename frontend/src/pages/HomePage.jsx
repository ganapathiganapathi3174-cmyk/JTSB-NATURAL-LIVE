import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

export default function HomePage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);

  function handleContinue() {
    setChecking(true);
    const token = localStorage.getItem('fb_admin_token');
    const userId = localStorage.getItem('fb_user_id');
    if (token) navigate('/fb-admin/dashboard', { replace: true });
    else if (userId) navigate('/fb/dashboard', { replace: true });
    else navigate('/fb/login', { replace: true });
  }

  return (
    <div className="landing-page animate-fade-in">
      <div className="landing-hero">
        <div className="landing-brand animate-fade-in-up">
          <div className="landing-brand-icon">✦</div>
        </div>

        <h1 className="landing-title animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
          <span className="text-gradient">JSREE APEX</span>
        </h1>
        <p className="landing-subtitle animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
          Premium FinTech platform for smart earning. Join thousands of members building their financial future.
        </p>

        <div className="landing-actions animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
          <button
            className="btn-primary btn-lg"
            onClick={handleContinue}
            disabled={checking}
          >
            {checking ? 'Loading...' : 'Get Started'}
          </button>
          <Link to="/fb/login" className="btn-secondary btn-lg" style={{ textAlign: 'center' }}>
            Sign In
          </Link>
        </div>
      </div>

      <div className="landing-footer">
        <p>One-time payment for lifetime access</p>
      </div>
    </div>
  );
}
