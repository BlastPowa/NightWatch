import { Component, type ErrorInfo, type ReactNode } from 'react';
import { log } from '@/lib/log';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** Catches renderer crashes and shows a readable message instead of a black screen. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = { error: null };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Renderer crash:', error, info.componentStack);
    log('error', `Renderer crash: ${error.stack ?? error.message}`);
  }

  public override render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <main className="shell">
          <h1 className="shell-title">NightWatch</h1>
          <p className="shell-subtitle">Something went wrong.</p>
          <section className="panel">
            <p className="form-error">{this.state.error.message}</p>
            <button
              type="button"
              className="button"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
