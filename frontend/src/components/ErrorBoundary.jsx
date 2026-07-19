import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary animate-fade-in-up">
          <div className="glass-strong" style={{ maxWidth: 480, margin: '2rem auto', padding: '2.5rem', borderRadius: 'var(--radius-lg)', textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>&#9888;</div>
            <h2 className="text-gradient text-lg font-bold mb-sm">Something went wrong</h2>
            <p className="text-muted mb-lg">Please try refreshing the page.</p>
            {process.env.NODE_ENV !== 'production' && this.state.error && (
              <pre className="glass" style={{ padding: '1rem', borderRadius: 'var(--radius)', marginBottom: '1rem', textAlign: 'left', fontSize: '0.75rem', overflow: 'auto', maxHeight: 200 }}>
                {this.state.error.message}
                {this.state.error.stack}
              </pre>
            )}
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              className="btn btn-primary btn-lg"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
