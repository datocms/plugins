import { faArrowsRotate, faGear } from '@fortawesome/free-solid-svg-icons';
import { Spinner } from 'datocms-react-ui';
import type { ReactNode } from 'react';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import Callout from '../shared/Callout';
import Tip from '../shared/Tip';
import styles from './FieldParts.module.css';

type ActionButtonProps = {
  label: string;
  icon?: ReactNode;
  /**
   * This action is running: the inline spinner shows, and clicks are
   * ignored. The button stays enabled, so it keeps keyboard focus.
   */
  pending: boolean;
  /** Another action is running. */
  disabled: boolean;
  /** Why the action can't run (tooltip), when it can't. */
  reason?: string | null;
  onClick: () => void;
};

/** A small callout action, with a spinner while it runs. */
function ActionButton({
  label,
  icon,
  pending,
  disabled,
  reason = null,
  onClick,
}: ActionButtonProps) {
  return (
    <Tip
      tip={reason}
      anchor={reason !== null ? 'focusable' : true}
      anchorClassName={styles.tooltipTarget}
    >
      <Button
        buttonSize="xxs"
        leftIcon={icon}
        disabled={(disabled && !pending) || reason !== null}
        onClick={pending ? undefined : onClick}
      >
        {label}
        {pending && <Spinner size={16} />}
      </Button>
    </Tip>
  );
}

/**
 * "Refresh saved data" syncs from Shopify. "Try again" has no icon, like
 * every other retry in the plugin.
 */
const REFRESH_ICON = <Icon icon={faArrowsRotate} />;

type LoadErrorProps = {
  title: string;
  message: string;
  /** Loading again: "Try again" shows its spinner. */
  retrying: boolean;
  /** Only roles that can edit the schema can fix the connection. */
  onOpenSettings?: () => void;
  /** Omitted when trying again can't help (a connection problem, for admins). */
  onRetry?: () => void;
};

/**
 * Hydration failed: the cause in plain words, then "Open plugin settings"
 * when only the settings can fix it and the role can open them, else "Try
 * again".
 */
export function LoadErrorNotice({
  title,
  message,
  retrying,
  onOpenSettings,
  onRetry,
}: LoadErrorProps) {
  return (
    <Callout
      tone="danger"
      role="alert"
      title={title}
      actions={
        <>
          {onOpenSettings && (
            <ActionButton
              label="Open plugin settings"
              icon={<Icon icon={faGear} />}
              pending={false}
              disabled={false}
              onClick={onOpenSettings}
            />
          )}
          {onRetry && (
            <ActionButton
              label="Try again"
              pending={retrying}
              disabled={false}
              onClick={onRetry}
            />
          )}
        </>
      }
    >
      <p className={styles.calloutText}>{message}</p>
    </Callout>
  );
}

type FormatMismatchProps = {
  message: string;
  /** Why converting can't happen now, or null. */
  problem: string | null;
  readOnly: boolean;
  busy: boolean;
  pending: boolean;
  onConvert: () => void;
};

/**
 * A valid value in another format than the field's settings. A neutral
 * surface, so its soft button stays visible: the record's Save is the
 * form's one primary action.
 */
export function FormatMismatchNotice({
  message,
  problem,
  readOnly,
  busy,
  pending,
  onConvert,
}: FormatMismatchProps) {
  return (
    <Callout
      tone="neutral"
      role="status"
      actions={
        readOnly ? undefined : (
          <ActionButton
            label="Convert to new format"
            pending={pending}
            disabled={busy}
            reason={problem}
            onClick={onConvert}
          />
        )
      }
    >
      <p className={styles.calloutText}>{message}</p>
    </Callout>
  );
}

type LegacyDriftProps = {
  summary: ReactNode;
  readOnly: boolean;
  busy: boolean;
  pending: boolean;
  onRefresh: () => void;
};

/** A 1.x JSON value whose saved copy no longer matches Shopify. */
export function LegacyDriftNotice({
  summary,
  readOnly,
  busy,
  pending,
  onRefresh,
}: LegacyDriftProps) {
  return (
    <Callout
      tone="warning"
      role="status"
      title="Shopify data changed since this was saved"
      actions={
        readOnly ? undefined : (
          <ActionButton
            label="Refresh saved data"
            icon={REFRESH_ICON}
            pending={pending}
            disabled={busy}
            onClick={onRefresh}
          />
        )
      }
    >
      <p className={styles.calloutText}>{summary}</p>
    </Callout>
  );
}
