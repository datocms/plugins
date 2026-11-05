import Button from 'datocms-react-ui/Button';
import FeedbackDot from 'datocms-react-ui/FeedbackDot';
import InfoList from 'datocms-react-ui/InfoList';
import SmartDate from 'datocms-react-ui/SmartDate';
import type { ReactNode } from 'react';
import type { StoreCapabilities } from '../../types';
import CapabilityList from './CapabilityList';
import { SAVING_REASON, useFocusAfterBusy } from './focus';
import styles from './Settings.module.css';
import type { ConnectionStatus as Status } from './useConnectionChecks';

type Props = {
  /** This session's check of the store's current connection, if any. */
  status: Status | undefined;
  /** Capabilities that belong to the current connection, if known. */
  capabilities: StoreCapabilities | null;
  tokenless: boolean;
  /** A save is running: the check waits for it. */
  saving: boolean;
  onTest: () => void;
};

function statusValue(
  status: Status | undefined,
  hasCapabilities: boolean,
): ReactNode {
  switch (status?.kind) {
    case 'checking':
      return 'Checking the connection…';
    case 'connected':
      return (
        <>
          <FeedbackDot tone="success" /> Connected
        </>
      );
    case 'failed':
      return (
        <>
          <FeedbackDot tone="danger" /> Not connected
        </>
      );
    default:
      return hasCapabilities ? 'Saved' : 'Not checked yet';
  }
}

/** A saved date that SmartDate can read (settings can hold anything). */
function readableDate(iso: string): string | null {
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/**
 * The one-sentence note under the status: why a check failed (where a
 * failed save moves focus), else the connected store's name, and when the
 * saved abilities were checked. The status stays short. The API version
 * shows only once it expired, in its own callout at the top.
 */
function statusDescription(
  status: Status | undefined,
  capabilities: StoreCapabilities | null,
): ReactNode {
  if (status?.kind === 'failed') {
    // An alert: after Re-check, focus stays on the button, and the value
    // alone says only "Not connected".
    return (
      <span role="alert" data-connection-failed="true" tabIndex={-1}>
        {status.message}
      </span>
    );
  }
  const connected = status?.kind === 'connected' ? status : null;
  // The date belongs to saved capabilities, not to ones detected just now.
  const checkedAt =
    capabilities && !connected?.detected
      ? readableDate(capabilities.checkedAt)
      : null;
  const date = checkedAt ? <SmartDate show="date" value={checkedAt} /> : null;
  if (!connected) {
    return date ? <>Checked on {date}.</> : undefined;
  }
  const shop = <strong>{connected.result.shopName}</strong>;
  if (date) {
    return (
      <>
        {shop}, checked on {date}.
      </>
    );
  }
  if (!capabilities) {
    return <>{shop}. Re-check to detect stock levels and tag filters.</>;
  }
  return shop;
}

/**
 * The connection of a store: the status (with why a check failed), what the
 * token can't read, and the check button. A check shows one spinner: on the
 * button, or on Save while a save checks (the button then waits, disabled).
 * After a failed check the abilities aren't known, so they don't show.
 */
export default function ConnectionStatus({
  status,
  capabilities,
  tokenless,
  saving,
  onTest,
}: Props) {
  const checking = status?.kind === 'checking';
  const failed = status?.kind === 'failed';
  const focus = useFocusAfterBusy(checking);
  const description = statusDescription(status, capabilities);

  return (
    <div className={styles.connection}>
      <InfoList className={styles.facts}>
        <InfoList.Row title="Connection">
          <span aria-live="polite">
            {statusValue(status, capabilities !== null)}
          </span>
          {description && <span className={styles.note}>{description}</span>}
        </InfoList.Row>
        {capabilities && !failed && (
          <CapabilityList capabilities={capabilities} tokenless={tokenless} />
        )}
      </InfoList>
      <Button
        ref={focus.ref}
        label={status || capabilities ? 'Re-check' : 'Test connection'}
        busy={checking && !saving}
        disabled={saving ? { reason: SAVING_REASON } : undefined}
        onClick={() => {
          focus.follow();
          onTest();
        }}
      />
    </div>
  );
}
