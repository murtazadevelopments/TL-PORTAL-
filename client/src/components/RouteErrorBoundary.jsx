import { Component } from 'react';

/**
 * Keeps the shell on screen if a page or document viewer throws.
 * resetKey (route or overlay id) recovers without a full reload.
 */
export default class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('RouteErrorBoundary:', error, info?.componentStack || '');
    try {
      this.props.onError?.();
    } catch {
      /* ignore */
    }
  }

  componentDidUpdate(prevProps) {
    if (this.state.hasError && this.props.resetKey !== prevProps.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="page-panel" style={{ margin: '1rem' }}>
          <h1>Something went wrong</h1>
          <p className="muted">This screen could not be shown. Go back and try again.</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => this.setState({ hasError: false })}
          >
            Show last page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
