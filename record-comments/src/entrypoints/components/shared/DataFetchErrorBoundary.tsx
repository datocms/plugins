import React, { Component, type ReactNode } from 'react';
import { logError } from '@/utils/errorLogger';
import styles from '../../styles/dashboard.module.css';

type Props = {
  children: ReactNode;
  sectionName: string;
  onRetry?: () => void;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

/**
 * Error boundary for data fetching sections.
 * Shows a user-friendly error message with optional retry functionality.
 */
export class DataFetchErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    logError(`${this.props.sectionName} error`, error, { componentStack: errorInfo.componentStack });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className={styles.errorSection}>
          <p>Failed to load {this.props.sectionName}</p>
          {this.props.onRetry && (
            <button
              type="button"
              onClick={this.handleRetry}
              aria-label={`Retry loading ${this.props.sectionName}`}
            >
              Retry
            </button>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

export default DataFetchErrorBoundary;
