import Button from 'datocms-react-ui/Button';
import FeedbackDot from 'datocms-react-ui/FeedbackDot';
import type { Message } from 'datocms-react-ui/Message';
import SettingsList from 'datocms-react-ui/SettingsList';
import SmartDate from 'datocms-react-ui/SmartDate';
import type { ReactNode } from 'react';
import type { StoreCapabilities } from '../../types';
import CapabilityList from './CapabilityList';
import { SAVING_REASON, useFocusAfterBusy } from './focus';
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
 * The row's one-sentence description: why a check failed (where a failed
 * save moves focus), else the connected store's name, and when the saved
 * abilities were checked. The value stays short, so Re-check keeps its
 * place at the right. The API version shows only once it expired, in its
 * own group at the top.
 */
function statusDescription(
  status: Status | undefined,
  capabilities: StoreCapabilities | null,
): Message | undefined {
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
 * The connection of a store: the status (with why a check failed), the
 * check button and what the token can't read. A check shows one spinner: on
 * the button, or on Save while a save checks (the button then waits,
 * disabled). After a failed check the abilities aren't known, so they don't
 * show.
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

  return (
    <SettingsList>
      <SettingsList.Row
        title="Connection"
        value={
          <span aria-live="polite">
            {statusValue(status, capabilities !== null)}
          </span>
        }
        description={statusDescription(status, capabilities)}
        action={
          <Button
            ref={focus.ref}
            tone="ghost"
            label={status || capabilities ? 'Re-check' : 'Test connection'}
            busy={checking && !saving}
            disabled={saving ? { reason: SAVING_REASON } : undefined}
            onClick={() => {
              focus.follow();
              onTest();
            }}
          />
        }
      />
      {capabilities && !failed && (
        <CapabilityList capabilities={capabilities} tokenless={tokenless} />
      )}
    </SettingsList>
  );
}
