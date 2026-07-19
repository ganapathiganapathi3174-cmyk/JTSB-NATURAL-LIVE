export default function TestPage() {
  return (
    <div className="page-wrap animate-fade-in-up" style={{ padding: 20 }}>
      <div className="glass card text-center" style={{ maxWidth: 480, margin: '2rem auto', padding: '2.5rem' }}>
        <h1 className="text-gradient text-xl font-bold mb-sm">Test Page Works!</h1>
        <p className="text-muted">If you see this, React is working.</p>
        <div className="section-divider mt-lg"><span>✓</span></div>
        <p className="text-xs text-muted mt-lg">Galaxy Design System Active</p>
      </div>
    </div>
  );
}
