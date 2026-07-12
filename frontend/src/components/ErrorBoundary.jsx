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
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>&#9888;</div>
          <h2>Something went wrong</h2>
          <p>Please try refreshing the page.</p>
          {process.env.NODE_ENV !== 'production' && this.state.error && (
            <pre>
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
      );
    }
    return this.props.children;
  }
}
