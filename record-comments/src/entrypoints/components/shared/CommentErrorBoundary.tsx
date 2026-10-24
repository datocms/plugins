import Callout from 'datocms-react-ui/Callout';
import React from 'react';
import { logError } from '@/utils/errorLogger';

type Props = {
  children: React.ReactNode;
  /** The problem in a few words, when the message has more than a sentence */
  fallbackTitle?: string;
  fallbackMessage?: string;
  /** Places the fallback callout (its margin) in its parent */
  fallbackClassName?: string;
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
    logError('Comment rendering failed', error, {
      componentStack: errorInfo.componentStack,
    });
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <Callout
          tone="danger"
          title={this.props.fallbackTitle}
          className={this.props.fallbackClassName}
        >
          {this.props.fallbackMessage ?? "This comment can't be shown."}
        </Callout>
      );
    }

    return this.props.children;
  }
}
