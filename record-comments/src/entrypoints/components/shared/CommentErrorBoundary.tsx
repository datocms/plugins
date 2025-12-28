import React from 'react';
import styles from '@styles/comment.module.css';
import { logError } from '@/utils/errorLogger';

type Props = {
  children: React.ReactNode;
  fallbackMessage?: string;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

/**
 * Error boundary component for gracefully handling render errors in comments.
 * Shows a simple fallback message instead of crashing the entire UI.
 */
export class CommentErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log the error for debugging
    logError('Comment rendering failed', error, { componentStack: errorInfo.componentStack });
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className={styles.errorFallback}>
          {this.props.fallbackMessage ?? 'Unable to display comment'}
        </div>
      );
    }

    return this.props.children;
  }
}

export default CommentErrorBoundary;
