import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import FeedbackDot from 'datocms-react-ui/FeedbackDot';
import type { Message } from 'datocms-react-ui/Message';
import SettingsList from 'datocms-react-ui/SettingsList';
import SmartDate from 'datocms-react-ui/SmartDate';
import Spinner from 'datocms-react-ui/Spinner';
import type { ReactNode } from 'react';
import { SHOPIFY_STOREFRONT_API_VERSION } from '../../constants';
import type { ConnectionTestResult, StoreCapabilities } from '../../types';
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

function statusValue(
  status: Status | undefined,
  hasCapabilities: boolean,
): ReactNode {
  switch (status?.kind) {
    case 'checking':
      return (
        <>
          <Spinner inline label={false} /> Checking the connection…
        </>
      );
    case 'connected':
      return (
        <>
          <FeedbackDot tone="success" /> Connected to{' '}
          <strong>{status.result.shopName}</strong>
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
 * The row's one-sentence description. Once connected, it names the API
 * version the plugin targets (flagged when Shopify says it expired).
 */
function statusDescription(
  status: Status | undefined,
  capabilities: StoreCapabilities | null,
): Message | undefined {
  const connected = status?.kind === 'connected' ? status : null;
  // The date belongs to saved capabilities, not to ones detected just now.
  const checkedAt =
    capabilities && !connected?.detected
      ? readableDate(capabilities.checkedAt)
      : null;
  const version = connected ? apiVersionText(connected.result) : null;
  if (checkedAt) {
    return (
      <>
        Checked on <SmartDate show="date" value={checkedAt} />
        {version && ` with ${version}`}.
      </>
    );
  }
  if (connected && !capabilities) {
    return `Connected with ${version}: re-check to detect tags and inventory.`;
  }
  if (version) return `Connected with ${version}.`;
  if (!status && !capabilities) {
    return 'Test the connection, or save the settings to check it.';
  }
  return undefined;
}

/**
 * The connection of a store: a failed check's message, then the status, the
 * check button and what the token can read.
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
    <>
      {status?.kind === 'failed' && (
        // Where a failed save moves focus: no buttons in it. The callout
        // takes no attributes, so the focus target wraps it.
        <div data-connection-failed="true" tabIndex={-1}>
          <Callout tone="danger" title="Couldn't connect to Shopify">
            {status.message}
          </Callout>
        </div>
      )}
      <SettingsList className={failed ? styles.afterCallout : undefined}>
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
              busy={checking}
              disabled={saving ? { reason: SAVING_REASON } : undefined}
              onClick={() => {
                focus.follow();
                onTest();
              }}
            />
          }
        />
        {capabilities && (
          <CapabilityList capabilities={capabilities} tokenless={tokenless} />
        )}
      </SettingsList>
    </>
  );
}
