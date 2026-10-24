import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import React from 'react';
import { CircleExclamationIcon } from '../icons';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches the render errors of a frame. It renders inside the frame's
 * Canvas, so its fallback uses the kit like the rest of the frame.
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Plugin error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const error = this.state.error ?? new Error('Unknown error');

    if (this.props.fallback) {
      return this.props.fallback(error, this.handleReset);
    }

    return (
      <BlankSlate
        placement="inline"
        error
        icon={<CircleExclamationIcon />}
        title="Something went wrong"
        code={error.message || undefined}
        description="Try again. If it keeps failing, reload the page."
        actions={<Button label="Try again" onClick={this.handleReset} />}
      />
    );
  }
}
