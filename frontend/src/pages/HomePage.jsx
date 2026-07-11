import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';

function TypeWriter({ texts, speed = 80, deleteSpeed = 40, pause = 2000 }) {
  const [display, setDisplay] = useState('');
  const [idx, setIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const current = texts[idx];
    let timer;

    if (!deleting && charIdx < current.length) {
      timer = setTimeout(() => {
        setDisplay(current.slice(0, charIdx + 1));
        setCharIdx(c => c + 1);
      }, speed);
    } else if (!deleting && charIdx === current.length) {
      timer = setTimeout(() => setDeleting(true), pause);
    } else if (deleting && charIdx > 0) {
      timer = setTimeout(() => {
        setDisplay(current.slice(0, charIdx - 1));
        setCharIdx(c => c - 1);
      }, deleteSpeed);
    } else if (deleting && charIdx === 0) {
      setDeleting(false);
      setIdx((i + 1) % texts.length);
    }

    return () => clearTimeout(timer);
  }, [charIdx, deleting, idx, texts, speed, deleteSpeed, pause]);

  return <span>{display}<span className="animate-pulse" style={{ opacity: 0.7 }}>|</span></span>;
}

function StatCounter({ end, duration = 2000, suffix = '' }) {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  const counted = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !counted.current) {
        counted.current = true;
        const start = performance.now();
        function tick(now) {
          const elapsed = now - start;
          const progress = Math.min(elapsed / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          setCount(Math.floor(eased * end));
          if (progress < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }
    }, { threshold: 0.5 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [end, duration]);

  return <span ref={ref}>{count.toLocaleString()}{suffix}</span>;
}

const features = [
  { icon: '🚀', title: 'Instant UPI Payments', desc: 'Fast, secure UPI-based payments with AI-powered auto-verification. No delays, no hassle.' },
  { icon: '🛡️', title: 'Advanced Security', desc: 'Military-grade AES-256 encryption for all transactions. Your data stays safe with us.' },
  { icon: '🤖', title: 'AI Verification', desc: 'Our OCR engine auto-verifies payments in seconds. 99.9% accuracy with fraud detection.' },
  { icon: '📊', title: 'Smart Dashboard', desc: 'Real-time analytics, wallet tracking, and income reports at your fingertips.' },
  { icon: '👥', title: 'Referral Program', desc: 'Earn passive income through our multi-level referral system with instant payouts.' },
  { icon: '💎', title: 'Premium Benefits', desc: 'Exclusive perks, priority support, and higher earning potential for premium members.' },
];

const timelineData = [
  { step: '1', title: 'Register Account', desc: 'Sign up in seconds with your email and phone. No complicated paperwork.' },
  { step: '2', title: 'Choose Package', desc: 'Select a plan that fits your goals. Every package comes with unique benefits.' },
  { step: '3', title: 'Make Payment', desc: 'Pay via UPI using any app. Our AI verifies your payment automatically.' },
  { step: '4', title: 'Start Earning', desc: 'Access your dashboard, track earnings, and refer others to grow your income.' },
];

const faqs = [
  { q: 'How does the UPI payment work?', a: 'Simply scan our UPI QR code or copy the UPI ID, make the payment from any UPI app (Google Pay, PhonePe, Paytm, BHIM), upload the screenshot, and our AI verifies it automatically.' },
  { q: 'How long does verification take?', a: 'Most payments are verified within 30-60 seconds using our AI OCR engine. Manual review is only needed for edge cases.' },
  { q: 'Is my data secure?', a: 'Absolutely. We use AES-256 encryption, JWT authentication, and follow security best practices. Your financial data never touches our frontend.' },
  { q: 'How does the referral program work?', a: 'Share your unique referral link. When someone registers and activates using your link, you earn a commission. Track everything in your dashboard.' },
  { q: 'Can I withdraw my earnings?', a: 'Yes! Earnings are credited to your wallet and can be withdrawn or used for reinvestment. Minimum withdrawal limits apply.' },
  { q: 'What support options are available?', a: 'We offer 24/7 in-app chat support. Premium members get priority response times and dedicated support.' },
];

const testimonials = [
  { name: 'Rajesh Kumar', role: 'Premium Member', text: 'The AI verification is incredible. My payments get approved in seconds. Best platform I have used.', rating: 5 },
  { name: 'Priya Sharma', role: 'Active Member', text: 'The referral system actually pays out. I have been earning consistently every month. Highly recommended!', rating: 5 },
  { name: 'Amit Patel', role: 'Premium Member', text: 'Clean interface, fast payments, and great support. The dashboard gives me complete control over my earnings.', rating: 5 },
];

function HomePage() {
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [openFaq, setOpenFaq] = useState(null);

  useEffect(() => {
    const handleScroll = () => setShowBackToTop(window.scrollY > 400);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollTo = useCallback((id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className="page-wrap" style={{ padding: 0 }}>
      <style>{`
        .home-header {
          position: fixed; top: 0; left: 0; right: 0; z-index: 50;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0.75rem 1.5rem;
          background: rgba(5,8,22,0.8);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .home-nav { display: flex; align-items: center; gap: 1.5rem; }
        .home-nav a {
          color: var(--muted); font-size: 0.85rem; font-weight: 500;
          transition: color var(--transition-fast); cursor: pointer;
        }
        .home-nav a:hover { color: var(--text); }
        .home-hero {
          min-height: 100vh; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          text-align: center; padding: 6rem 1.5rem 4rem;
          position: relative;
        }
        .home-hero-badge {
          display: inline-flex; align-items: center; gap: 0.4rem;
          padding: 0.35rem 1rem; border-radius: 999px;
          background: rgba(91,95,255,0.1); border: 1px solid rgba(91,95,255,0.2);
          font-size: 0.8rem; color: #A5B4FC; font-weight: 500;
          margin-bottom: 1.5rem;
          animation: fadeInUp 0.6s ease both;
        }
        .home-hero h1 {
          font-size: clamp(2rem, 5vw, 4rem); font-weight: 800;
          letter-spacing: -0.03em; line-height: 1.15;
          margin: 0 0 1rem;
          background: linear-gradient(135deg, #fff 30%, #5B5FFF 60%, #38BDF8);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: fadeInUp 0.6s ease 0.1s both;
        }
        .home-hero p {
          font-size: clamp(1rem, 2vw, 1.25rem); color: var(--muted);
          max-width: 600px; line-height: 1.7; margin: 0 auto 2rem;
          animation: fadeInUp 0.6s ease 0.2s both;
        }
        .home-typing {
          font-size: 1.1rem; color: var(--accent); margin-bottom: 2rem;
          min-height: 2rem;
          animation: fadeInUp 0.6s ease 0.15s both;
        }
        .home-cta-group {
          display: flex; align-items: center; gap: 1rem;
          animation: fadeInUp 0.6s ease 0.3s both;
        }
        .home-stats {
          display: flex; align-items: center; justify-content: center;
          gap: 3rem; margin-top: 4rem; flex-wrap: wrap;
          animation: fadeInUp 0.6s ease 0.4s both;
        }
        .home-stat { text-align: center; }
        .home-stat-value {
          font-size: 2rem; font-weight: 800;
          background: linear-gradient(135deg, #5B5FFF, #38BDF8);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .home-stat-label { font-size: 0.8rem; color: var(--muted-2); margin-top: 0.25rem; }
        .home-section {
          padding: 5rem 1.5rem; position: relative;
        }
        .home-section-inner {
          max-width: 1100px; margin: 0 auto;
        }
        .home-section-title {
          font-size: clamp(1.5rem, 3vw, 2.5rem); font-weight: 800;
          text-align: center; margin: 0 0 0.5rem;
          letter-spacing: -0.02em;
        }
        .home-section-sub {
          text-align: center; color: var(--muted); font-size: 1rem;
          max-width: 600px; margin: 0 auto 3rem;
        }
        .features-grid {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 1rem;
        }
        .feature-card {
          padding: 1.75rem; border-radius: var(--radius);
          background: var(--surface); border: 1px solid var(--border);
          transition: all var(--transition);
        }
        .feature-card:hover {
          border-color: rgba(91,95,255,0.2);
          transform: translateY(-4px);
          box-shadow: 0 12px 48px rgba(0,0,0,0.3);
        }
        .feature-icon { font-size: 2.5rem; margin-bottom: 1rem; }
        .feature-card h3 { margin: 0 0 0.5rem; font-size: 1.1rem; font-weight: 700; }
        .feature-card p { margin: 0; font-size: 0.85rem; color: var(--muted); line-height: 1.6; }
        .timeline-wrap {
          display: flex; flex-direction: column; gap: 1.5rem;
          max-width: 700px; margin: 0 auto;
        }
        .timeline-item {
          display: flex; gap: 1.25rem; align-items: flex-start;
          padding: 1.5rem; border-radius: var(--radius);
          background: var(--surface); border: 1px solid var(--border);
          transition: all var(--transition);
        }
        .timeline-item:hover {
          border-color: rgba(91,95,255,0.15);
        }
        .timeline-num {
          width: 44px; height: 44px; border-radius: 50%;
          background: linear-gradient(135deg, var(--primary), var(--secondary));
          display: flex; align-items: center; justify-content: center;
          font-weight: 800; font-size: 1.1rem; color: #fff;
          flex-shrink: 0; box-shadow: 0 4px 16px rgba(91,95,255,0.3);
        }
        .timeline-content h4 { margin: 0 0 0.3rem; font-size: 1rem; }
        .timeline-content p { margin: 0; font-size: 0.85rem; color: var(--muted); line-height: 1.6; }
        .faq-list { max-width: 700px; margin: 0 auto; display: flex; flex-direction: column; gap: 0.75rem; }
        .faq-item {
          border-radius: var(--radius); overflow: hidden;
          background: var(--surface); border: 1px solid var(--border);
          transition: all var(--transition-fast);
        }
        .faq-q {
          padding: 1.25rem; cursor: pointer; font-weight: 600;
          display: flex; justify-content: space-between; align-items: center;
          gap: 1rem; font-size: 0.95rem;
          user-select: none;
        }
        .faq-q:hover { color: var(--accent); }
        .faq-arrow { transition: transform var(--transition); font-size: 0.8rem; color: var(--muted); }
        .faq-arrow.open { transform: rotate(180deg); }
        .faq-a {
          padding: 0 1.25rem 1.25rem; font-size: 0.85rem; color: var(--muted);
          line-height: 1.7;
        }
        .testimonials-grid {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 1rem;
        }
        .testimonial-card {
          padding: 1.75rem; border-radius: var(--radius);
          background: var(--surface); border: 1px solid var(--border);
          transition: all var(--transition);
        }
        .testimonial-card:hover {
          border-color: rgba(91,95,255,0.15);
          transform: translateY(-2px);
        }
        .testimonial-stars { color: #F59E0B; font-size: 0.85rem; margin-bottom: 0.75rem; }
        .testimonial-text { font-size: 0.9rem; line-height: 1.6; color: var(--text-2); margin-bottom: 1rem; font-style: italic; }
        .testimonial-author { font-weight: 600; font-size: 0.9rem; }
        .testimonial-role { font-size: 0.75rem; color: var(--muted-2); }
        .home-cta-section {
          text-align: center; padding: 5rem 1.5rem;
          background: linear-gradient(180deg, transparent, rgba(91,95,255,0.05), transparent);
        }
        .cta-title { font-size: clamp(1.5rem, 3vw, 2.5rem); font-weight: 800; margin-bottom: 1rem; }
        .cta-desc { color: var(--muted); max-width: 500px; margin: 0 auto 2rem; font-size: 1rem; line-height: 1.6; }
        .back-to-top {
          position: fixed; bottom: 2rem; right: 2rem; z-index: 50;
          width: 44px; height: 44px; border-radius: 50%;
          background: linear-gradient(135deg, var(--primary), var(--secondary));
          color: #fff; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          font-size: 1.25rem; box-shadow: 0 4px 16px rgba(91,95,255,0.3);
          transition: all var(--transition);
          opacity: 0; transform: translateY(20px); pointer-events: none;
        }
        .back-to-top.visible { opacity: 1; transform: translateY(0); pointer-events: auto; }
        .back-to-top:hover { transform: translateY(-3px); box-shadow: 0 6px 24px rgba(91,95,255,0.4); }
        .home-footer {
          text-align: center; padding: 2rem 1.5rem;
          border-top: 1px solid var(--border);
          color: var(--muted-2); font-size: 0.8rem;
        }
        @media (max-width: 640px) {
          .home-nav { display: none; }
          .home-hero { padding: 5rem 1rem 3rem; }
          .home-stats { gap: 2rem; }
          .home-section { padding: 3rem 1rem; }
          .features-grid { grid-template-columns: 1fr; }
          .testimonials-grid { grid-template-columns: 1fr; }
          .home-cta-group { flex-direction: column; }
        }
      `}</style>

      {/* Header */}
      <header className="home-header">
        <div className="brand" style={{ fontSize: '1rem' }}>
          <span className="logo-text">JTSB Natural</span>
        </div>
        <nav className="home-nav">
          <a onClick={() => scrollTo('features')}>Features</a>
          <a onClick={() => scrollTo('how-it-works')}>How It Works</a>
          <a onClick={() => scrollTo('faq')}>FAQ</a>
          <Link to="/fb/login" className="btn btn-ghost btn-sm">Sign In</Link>
          <Link to="/fb/register" className="btn btn-primary btn-sm">Get Started</Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="home-hero">
        <div className="home-hero-badge animate-float">
          ✦ AI-Powered FinTech Platform
        </div>
        <h1>Future of Digital<br />Payments & Earnings</h1>
        <div className="home-typing">
          <TypeWriter texts={[
            'Instant UPI Verifications',
            'AI-Powered Security',
            'Passive Income Generation',
            'Smart Financial Dashboard',
          ]} />
        </div>
        <p>
          Experience lightning-fast UPI payments with AI auto-verification.
          Earn through our referral program and track everything from your premium dashboard.
        </p>
        <div className="home-cta-group">
          <Link to="/fb/register" className="btn btn-primary btn-lg">
            Get Started Free
          </Link>
          <Link to="/fb/login" className="btn btn-ghost btn-lg">
            Sign In
          </Link>
        </div>
        <div className="home-stats">
          <div className="home-stat">
            <div className="home-stat-value"><StatCounter end={50000} suffix="+" /></div>
            <div className="home-stat-label">Active Users</div>
          </div>
          <div className="home-stat">
            <div className="home-stat-value">₹<StatCounter end={10000000} suffix="+" /></div>
            <div className="home-stat-label">Total Earnings</div>
          </div>
          <div className="home-stat">
            <div className="home-stat-value"><StatCounter end={150000} suffix="+" /></div>
            <div className="home-stat-label">Transactions</div>
          </div>
          <div className="home-stat">
            <div className="home-stat-value">99.<StatCounter end={9} />%</div>
            <div className="home-stat-label">Uptime</div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="home-section" id="features">
        <div className="home-section-inner">
          <h2 className="home-section-title">Why Choose JTSB Natural?</h2>
          <p className="home-section-sub">
            Built for speed, security, and scalability. Every feature designed with you in mind.
          </p>
          <div className="features-grid">
            {features.map((f, i) => (
              <div key={i} className="feature-card animate-fade-in-up" style={{ animationDelay: `${i * 0.05}s` }}>
                <div className="feature-icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="home-section" id="how-it-works" style={{ background: 'rgba(255,255,255,0.01)' }}>
        <div className="home-section-inner">
          <h2 className="home-section-title">How It Works</h2>
          <p className="home-section-sub">
            Get started in 4 simple steps. No complexity, just results.
          </p>
          <div className="timeline-wrap">
            {timelineData.map((t, i) => (
              <div key={i} className="timeline-item animate-fade-in-up" style={{ animationDelay: `${i * 0.1}s` }}>
                <div className="timeline-num">{t.step}</div>
                <div className="timeline-content">
                  <h4>{t.title}</h4>
                  <p>{t.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="home-section" id="testimonials">
        <div className="home-section-inner">
          <h2 className="home-section-title">What Our Users Say</h2>
          <p className="home-section-sub">
            Real feedback from real members who are already earning.
          </p>
          <div className="testimonials-grid">
            {testimonials.map((t, i) => (
              <div key={i} className="testimonial-card animate-fade-in-up" style={{ animationDelay: `${i * 0.1}s` }}>
                <div className="testimonial-stars">{'★'.repeat(t.rating)}{'☆'.repeat(5 - t.rating)}</div>
                <div className="testimonial-text">"{t.text}"</div>
                <div className="testimonial-author">{t.name}</div>
                <div className="testimonial-role">{t.role}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="home-section" id="faq" style={{ background: 'rgba(255,255,255,0.01)' }}>
        <div className="home-section-inner">
          <h2 className="home-section-title">Frequently Asked Questions</h2>
          <p className="home-section-sub">
            Have questions? We have answers.
          </p>
          <div className="faq-list">
            {faqs.map((faq, i) => (
              <div key={i} className="faq-item">
                <div className="faq-q" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                  <span>{faq.q}</span>
                  <span className={`faq-arrow ${openFaq === i ? 'open' : ''}`}>▼</span>
                </div>
                {openFaq === i && (
                  <div className="faq-a animate-fade-in">{faq.a}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="home-cta-section">
        <div className="home-section-inner">
          <h2 className="cta-title">Ready to Get Started?</h2>
          <p className="cta-desc">
            Join thousands of users already earning with JTSB Natural.
            Your financial future starts here.
          </p>
          <Link to="/fb/register" className="btn btn-primary btn-lg">
            Create Free Account
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="home-footer">
        <p style={{ margin: 0 }}>© 2026 JTSB Natural. All rights reserved. | Premium FinTech Platform</p>
      </footer>

      {/* Back to Top */}
      <button
        className={`back-to-top ${showBackToTop ? 'visible' : ''}`}
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="Back to top"
      >
        ↑
      </button>
    </div>
  );
}

export default HomePage;
