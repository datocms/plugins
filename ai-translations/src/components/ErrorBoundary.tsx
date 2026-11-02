/**
 * ErrorBoundary.tsx
 * -----------------
 * Catches a render error in any frame of the plugin and shows it as an error
 * blank slate, with a way to render the frame again and, in a dialog, a
 * button that closes it.
 * main.tsx puts it inside the Canvas of every frame hook, so the fallback can
 * use the kit.
 *
 * In a full-height page the fallback is the whole page: the page's own `Main`
 * is in the component that failed, so the fallback brings one, and its blank
 * slate fills the frame with its title as the page's title. Elsewhere (the
 * config screen, the sidebar panel, the dialogs) it's a small inline blank
 * slate in the flow of the frame.
 */
import BlankSlate from 'datocms-react-ui/BlankSlate';
import Button from 'datocms-react-ui/Button';
import { useCtx } from 'datocms-react-ui/Canvas';
import Main from 'datocms-react-ui/Main';
import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import { CircleExclamationIcon } from '../icons';
import { isFocusLost } from '../utils/retryFocus';
import s from './ErrorBoundary.module.css';
import { useCloseOnEscape } from './useCloseOnEscape';

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * The frame is a full-height page: the fallback is then the content of the
   * page, alone in its `Main`.
   */
  page?: boolean;
  /**
   * Closes the dialog of the frame with the value that a dismissal means to
   * its caller. Give it for a dialog: the fallback then shows a "Close"
   * button and registers Escape as it, the ways out of a dialog that opens
   * with no host cross.
   */
  onClose?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** The sizing methods of a frame that sizes itself (not a full-height page). */
type SelfSizingCtx = { startAutoResizer: () => void };

function isSelfSizing(ctx: object): ctx is SelfSizingCtx {
  return (
    'startAutoResizer' in ctx && typeof ctx.startAutoResizer === 'function'
  );
}

interface ErrorFallbackProps {
  error: Error;
  page?: boolean;
  onClose?: () => void;
  onReset: () => void;
  /**
   * The fallback replaces the one whose "Try again" the user just used (the
   * frame failed again): its own "Try again" then takes the focus that the
   * old one had.
   */
  retried?: boolean;
}

/**
 * The content of a frame that failed. A frame rendered with `noAutoResizer`
 * is sized by the component that failed (useFrameHeight), and a component
 * that throws in its first render never runs that effect: the fallback starts
 * the SDK auto-resizer, so its frame gets its height in every case. In the
 * other frames the auto-resizer already runs, and starting it again changes
 * nothing; a full-height page has no sizing methods.
 */
function ErrorFallback({
  error,
  page = false,
  onClose,
  onReset,
  retried = false,
}: ErrorFallbackProps) {
  const ctx = useCtx();
  const retryRef = useRef<HTMLElement>(null);
  // Read once: the fallback mounts again for each new error.
  const focusRetryOnMount = useRef(retried);

  useEffect(() => {
    if (isSelfSizing(ctx)) ctx.startAutoResizer();
  }, [ctx]);

  // In a dialog, the content that failed took its Escape with it.
  useCloseOnEscape(onClose);

  // The old fallback left with the focused "Try again", which dropped the
  // focus to the body.
  useLayoutEffect(() => {
    if (focusRetryOnMount.current && isFocusLost()) {
      retryRef.current?.focus({ preventScroll: true });
    }
  }, []);

  const parts = {
    error: true,
    icon: <CircleExclamationIcon />,
    title: 'Something went wrong',
    description:
      "This part of the plugin couldn't be shown. Try again, or reload the page.",
    code: error.message || undefined,
    actions: (
      <>
        <Button ref={retryRef} label="Try again" onClick={onReset} />
        {onClose && <Button label="Close" onClick={onClose} />}
      </>
    ),
  };

  // A full-height page: the blank slate is the page, alone in its `Main`
  // (the layout box that fills the frame), and its title is the page's h1.
  if (page) {
    return (
      <Main className={s.page}>
        <BlankSlate placement="area" titleLevel={1} {...parts} />
      </Main>
    );
  }

  return <BlankSlate placement="inline" small {...parts} />;
}

/**
 * ERR-001: Error boundary component to catch and display React errors gracefully.
 * Prevents the entire plugin from crashing when an error occurs in a child component.
 */
export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  /**
   * "Try again" was just used: true from the reset until the next commit,
   * which shows either the frame or a new fallback (React mounts a new one
   * when the frame fails again).
   */
  private retried = false;

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // The details stay in the console, for debugging
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
  }

  componentDidUpdate(): void {
    this.retried = false;
  }

  handleReset = (): void => {
    this.retried = true;
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <ErrorFallback
        error={error}
        page={this.props.page}
        onClose={this.props.onClose}
        onReset={this.handleReset}
        retried={this.retried}
      />
    );
  }
}
