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
        <div className="error-boundary">
          <h2>Something went wrong</h2>
          <p>Please try refreshing the page.</p>
          {process.env.NODE_ENV !== 'production' && this.state.error && (
            <pre style={{ background: '#1a1a2e', color: '#ff6b6b', padding: '1rem', borderRadius: '8px', margin: '1rem 0', fontSize: '0.8rem', overflow: 'auto', maxWidth: '100%' }}>
              {this.state.error.message}
              {this.state.error.stack}
            </pre>
          )}
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            className="btn-modern btn-modern-primary"
          >
            Refresh Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
