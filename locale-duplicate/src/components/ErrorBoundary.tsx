import React from 'react';
import { Canvas, Button } from 'datocms-react-ui';
import type { 
  RenderConfigScreenCtx, 
  RenderFieldExtensionCtx, 
  RenderManualFieldExtensionConfigScreenCtx,
  RenderPageCtx 
} from 'datocms-plugin-sdk';
import styles from './ErrorBoundary.module.css';

interface ErrorBoundaryProps {
  ctx: RenderConfigScreenCtx | RenderFieldExtensionCtx | RenderManualFieldExtensionConfigScreenCtx | RenderPageCtx;
  children: React.ReactNode;
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
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
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error!, this.handleReset);
      }

      return (
        <Canvas ctx={this.props.ctx}>
          <div className={styles.errorContainer}>
            <h2 className={styles.errorTitle}>
              Something went wrong
            </h2>
            <p className={styles.errorMessage}>
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <Button 
              buttonType="primary"
              onClick={this.handleReset}
            >
              Try again
            </Button>
          </div>
        </Canvas>
      );
    }

    return this.props.children;
  }
}