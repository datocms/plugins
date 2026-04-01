import { Button } from 'datocms-react-ui';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Context for navigation (when available) */
  onNavigateToSettings?: () => void;
  /** Fallback UI renderer (optional) */
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * ERR-001: Error boundary component to catch and display React errors gracefully.
 * Prevents the entire plugin from crashing when an error occurs in a child component.
 */
export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    // Log to console for debugging
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{ padding: '16px', textAlign: 'center' }}>
          <h3 style={{ marginBottom: '8px', color: '#dc3545' }}>
            Something went wrong
          </h3>
          <p style={{ marginBottom: '16px', color: '#6c757d' }}>
            An error occurred while rendering this component.
          </p>
          {this.state.error && (
            <details
              style={{
                marginBottom: '16px',
                textAlign: 'left',
                background: '#f8f9fa',
                padding: '8px',
                borderRadius: '4px',
              }}
            >
              <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>
                Error details
              </summary>
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: '12px',
                  marginTop: '4px',
                }}
              >
                {this.state.error.message}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}
          <div
            style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}
          >
            <Button onClick={this.handleReset} buttonSize="s">
              Try again
            </Button>
            {this.props.onNavigateToSettings && (
              <Button
                onClick={this.props.onNavigateToSettings}
                buttonSize="s"
                buttonType="muted"
              >
                Open Settings
              </Button>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
