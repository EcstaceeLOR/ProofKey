import { Component, type ErrorInfo, type ReactNode } from 'react';
import { clientFault, reportClientFault } from '../telemetry.js';

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    reportClientFault(clientFault('REACT_RENDER_FAILURE', 'render', false));
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="fatal-route" role="alert">
        <span>PROOFKEY / SAFE FAILURE</span>
        <h1>The interface stopped safely.</h1>
        <p>
          No transaction was submitted by this error. Reload the application or
          return home to recover.
        </p>
        <div className="fatal-actions">
          <button type="button" onClick={() => window.location.reload()}>
            Reload application
          </button>
          <a href="/">Return home</a>
        </div>
      </main>
    );
  }
}
