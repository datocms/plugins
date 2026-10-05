import { faGear, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
import type { ReactNode } from 'react';
import { emptyLabel } from '../../lib/fieldValue';
import type { Cardinality, ShopifyKind } from '../../types';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import styles from './FieldParts.module.css';
import { FIELD_ACTION_ATTRIBUTE } from './useFieldFeedback';

type FieldBoxProps = {
  /** An action before the text, like a native file input's button. */
  leading?: ReactNode;
  /** An action after the text. */
  trailing?: ReactNode;
  /** Names the leading action for focus management (`browse`). */
  leadingAction?: string;
  children: ReactNode;
};

/** A box that reads like a native field control, for the empty and setup states. */
export function FieldBox({
  leading,
  trailing,
  leadingAction,
  children,
}: FieldBoxProps) {
  return (
    <div className={styles.box}>
      {leading && (
        <span
          className={styles.boxAction}
          {...(leadingAction
            ? { [FIELD_ACTION_ATTRIBUTE]: leadingAction }
            : {})}
        >
          {leading}
        </span>
      )}
      <span className={styles.boxText}>{children}</span>
      {trailing && <span className={styles.boxAction}>{trailing}</span>}
    </div>
  );
}

type EmptyStateProps = {
  kind: ShopifyKind;
  cardinality: Cardinality;
  readOnly: boolean;
  /** Another action is running (not this one: it keeps focus while it runs). */
  busy: boolean;
  onBrowse: () => void;
};

/** What the picker can search, under the empty label. */
function emptyHint(kind: ShopifyKind): string {
  return kind === 'collection'
    ? 'Search your Shopify collections by title'
    : 'Search your Shopify catalog by title, SKU or barcode';
}

/**
 * Laid out like the dashboard's empty asset field: a centered box with the
 * label, a hint, and the action underneath.
 */
export function EmptyState({
  kind,
  cardinality,
  readOnly,
  busy,
  onBrowse,
}: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyLabel}>{emptyLabel(kind, cardinality)}</div>
      {!readOnly && (
        <>
          <div className={styles.emptyHint}>{emptyHint(kind)}</div>
          <div
            className={styles.emptyActions}
            {...{ [FIELD_ACTION_ATTRIBUTE]: 'browse' }}
          >
            <Button
              buttonSize="s"
              leftIcon={<Icon icon={faMagnifyingGlass} />}
              disabled={busy}
              onClick={onBrowse}
            >
              Browse Shopify
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

type SetupMessageProps = {
  message: ReactNode;
  /** Shown only to roles that can edit the schema (and so the plugin settings). */
  onOpenSettings?: () => void;
};

/** Plugin not configured, the field's store gone, or an unsupported field type. */
export function SetupMessage({ message, onOpenSettings }: SetupMessageProps) {
  return (
    <FieldBox
      trailing={
        onOpenSettings ? (
          <Button
            buttonSize="s"
            leftIcon={<Icon icon={faGear} />}
            onClick={onOpenSettings}
          >
            Open plugin settings
          </Button>
        ) : undefined
      }
    >
      {message}
    </FieldBox>
  );
}
