import { faCircleCheck } from '@fortawesome/free-regular-svg-icons';
import { Spinner } from 'datocms-react-ui';
import { type RefObject, useLayoutEffect, useRef } from 'react';
import { SHOPIFY_STOREFRONT_API_VERSION } from '../../constants';
import type { ConnectionTestResult, StoreCapabilities } from '../../types';
import { Icon } from '../../ui/Icon';
import Callout from '../shared/Callout';
import CapabilityList from './CapabilityList';
import styles from './ConnectionStatus.module.css';
import { StableButton } from './StableButton';
import type { ConnectionStatus as Status } from './useConnectionChecks';

type Props = {
  /** This session's check of the store's current connection, if any. */
  status: Status | undefined;
  /** Capabilities that belong to the current connection, if known. */
  capabilities: StoreCapabilities | null;
  tokenless: boolean;
  /** `ctx.ui.locale`, for the "Checked on" date. */
  locale: string;
  /** A save is running: the buttons wait for it (and keep focus meanwhile). */
  disabled: boolean;
  onTest: () => void;
  /** Offered after a failed save: saves without the connection check. */
  onSaveAnyway?: () => void;
};

function formatCheckedOn(iso: string, locale: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return date.toLocaleDateString(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return date.toLocaleDateString('en', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }
}

/**
 * The pinned version, flagged when Shopify reports it expired. Shopify then
 * answers with the oldest version it still serves: name it when known.
 */
export function apiVersionText(result: ConnectionTestResult): string {
  const pinned = SHOPIFY_STOREFRONT_API_VERSION;
  if (!result.apiVersionOutdated) return `API ${pinned}`;
  const responded = result.respondedApiVersion;
  return responded && responded !== pinned
    ? `API ${pinned} (expired; Shopify answered with ${responded})`
    : `API ${pinned} (expired)`;
}

function StatusLine({
  status,
  hasCapabilities,
}: {
  status: Status | undefined;
  hasCapabilities: boolean;
}) {
  if (status?.kind === 'checking') {
    return (
      <span className={styles.line}>
        <span className={styles.spinner}>
          <Spinner size={16} />
        </span>
        Checking the connection…
      </span>
    );
  }
  if (status?.kind === 'connected') {
    return (
      <span className={styles.line}>
        <Icon icon={faCircleCheck} className={styles.connectedIcon} />
        <span>
          Connected to <strong>{status.result.shopName}</strong>
          <span className={styles.meta}>
            {' '}
            · {apiVersionText(status.result)}
          </span>
        </span>
      </span>
    );
  }
  return (
    <span className={`${styles.line} ${styles.idle}`}>
      {hasCapabilities
        ? 'Connection saved'
        : 'Not checked yet: test the connection or save the settings'}
    </span>
  );
}

/** Marks the button that (re)runs the check: where focus goes back to. */
const STATUS_ACTION = 'data-status-action';

/**
 * Running an action here swaps the view: "Try again" unmounts while the
 * check runs, "Re-check" unmounts when it fails, "Save anyway" goes once the
 * save is through. When the button that ran it had focus, focus moves to the
 * current view's check button instead of dropping to `<body>`. It never takes
 * focus back from somewhere the user moved it.
 */
function useFocusFollowsStatus(
  root: RefObject<HTMLDivElement | null>,
  settled: boolean,
) {
  const following = useRef(false);

  useLayoutEffect(() => {
    if (!following.current) return;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) {
      root.current
        ?.querySelector<HTMLElement>(`[${STATUS_ACTION}] button`)
        ?.focus({ preventScroll: true });
    }
    if (settled) following.current = false;
  });

  return (action: () => void) => () => {
    following.current = Boolean(root.current?.contains(document.activeElement));
    action();
  };
}

function FailedStatus({
  message,
  disabled,
  onTest,
  onSaveAnyway,
}: {
  message: string;
  disabled: boolean;
  onTest: () => void;
  onSaveAnyway?: () => void;
}) {
  return (
    <div
      data-connection-failed="true"
      tabIndex={-1}
      className={styles.focusTarget}
    >
      <Callout
        tone="danger"
        role="alert"
        title="Couldn't connect to Shopify"
        actions={
          <>
            {onSaveAnyway && (
              <StableButton
                buttonSize="xxs"
                unavailable={disabled}
                onClick={onSaveAnyway}
              >
                Save anyway
              </StableButton>
            )}
            <span {...{ [STATUS_ACTION]: '' }} className={styles.action}>
              <StableButton
                buttonSize="xxs"
                unavailable={disabled}
                onClick={onTest}
              >
                Try again
              </StableButton>
            </span>
          </>
        }
      >
        {message}
      </Callout>
    </div>
  );
}

/**
 * The inline result of a store's connection check: who answered, which
 * optional scopes the token has, and how to fix a failure.
 */
export default function ConnectionStatus({
  status,
  capabilities,
  tokenless,
  locale,
  disabled,
  onTest,
  onSaveAnyway,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const checking = status?.kind === 'checking';
  const follow = useFocusFollowsStatus(root, !disabled && !checking);

  if (status?.kind === 'failed') {
    return (
      <div ref={root}>
        <FailedStatus
          message={status.message}
          disabled={disabled}
          onTest={follow(onTest)}
          onSaveAnyway={onSaveAnyway && follow(onSaveAnyway)}
        />
      </div>
    );
  }

  const detectedThisSession = status?.kind === 'connected' && status.detected;
  const checkedOn =
    capabilities && !detectedThisSession
      ? formatCheckedOn(capabilities.checkedAt, locale)
      : null;

  return (
    <div ref={root} className={styles.box}>
      <div className={styles.header} aria-live="polite">
        <StatusLine status={status} hasCapabilities={capabilities !== null} />
        <span {...{ [STATUS_ACTION]: '' }} className={styles.action}>
          <StableButton
            buttonSize="xs"
            unavailable={disabled || checking}
            onClick={follow(onTest)}
          >
            {status || capabilities ? 'Re-check' : 'Test connection'}
          </StableButton>
        </span>
      </div>
      {capabilities && (
        <CapabilityList
          capabilities={capabilities}
          tokenless={tokenless}
          checkedOn={checkedOn}
        />
      )}
      {!capabilities && status?.kind === 'connected' && (
        <p className={styles.unknown}>Re-check to detect tags and inventory</p>
      )}
    </div>
  );
}
