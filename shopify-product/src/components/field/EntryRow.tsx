import { faEyeSlash } from '@fortawesome/free-regular-svg-icons';
import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import type { ReactNode } from 'react';
import {
  type RowModel,
  rowMeta,
  unresolvedMessage,
} from '../../lib/fieldValue';
import { nodeImage, nodeTitle, truncateMiddle } from '../../lib/format';
import type { ShopifyImage } from '../../types';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import AvailabilityBadge from '../shared/AvailabilityBadge';
import PriceTag, { nodePrice } from '../shared/PriceTag';
import Thumbnail from '../shared/Thumbnail';
import styles from './EntryRow.module.css';
import RowActions from './RowActions';
import { ROW_ATTRIBUTE } from './useFieldFeedback';

export type EntryRowProps = {
  row: RowModel;
  /** `ctx.ui.locale`, for prices. */
  locale: string;
  /** Show stock counts (the store's effective inventory capability). */
  inventory: boolean;
  /** Read-only: no menu and no actions. */
  readOnly: boolean;
  /** Another action is running: actions are shown but disabled. */
  busy: boolean;
  onReplace: () => void;
  onRemove: () => void;
  onUpdateHandle: (handle: string) => void;
  /** The drag handle, for sortable lists. */
  dragHandle?: ReactNode;
  /** The copy that follows the pointer while dragging. */
  lifted?: boolean;
};

const IDENTITY_MAX_LENGTH = 56;

function rowTitle(row: RowModel): string {
  return row.node ? nodeTitle(row.node) : row.fallback.label;
}

function rowImage(row: RowModel): ShopifyImage | null {
  if (row.node) return nodeImage(row.node);
  return row.fallback.imageUrl
    ? { url: row.fallback.imageUrl, altText: null }
    : null;
}

function RowThumb({ row }: { row: RowModel }) {
  const image = rowImage(row);
  if (!image && row.state === 'unresolved') {
    return (
      <span className={styles.thumbPlaceholder} aria-hidden="true">
        <Icon icon={faEyeSlash} />
      </span>
    );
  }
  return <Thumbnail image={image} size={60} radius={4} />;
}

function RowTitle({ row }: { row: RowModel }) {
  const title = rowTitle(row);
  const code = !row.node && row.fallback.labelIsCode;
  const className = [styles.title, code ? styles.code : '']
    .filter(Boolean)
    .join(' ');
  if (row.storefrontUrl) {
    return (
      <a
        className={`${className} ${styles.titleLink}`}
        href={row.storefrontUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
      >
        {title}
      </a>
    );
  }
  return (
    <span className={className} title={title}>
      {title}
    </span>
  );
}

function RowDetails({ row, inventory }: { row: RowModel; inventory: boolean }) {
  if (row.node) {
    const meta = rowMeta(row.node);
    return (
      <>
        {meta && <span className={styles.meta}>{meta}</span>}
        <span className={styles.badges}>
          <AvailabilityBadge node={row.node} inventory={inventory} />
        </span>
      </>
    );
  }
  const identity = row.fallback.identity;
  return identity ? (
    <span className={`${styles.meta} ${styles.code}`} title={identity}>
      {truncateMiddle(identity, IDENTITY_MAX_LENGTH)}
    </span>
  ) : null;
}

type IssueProps = Pick<
  EntryRowProps,
  'row' | 'readOnly' | 'busy' | 'onReplace' | 'onRemove' | 'onUpdateHandle'
>;

function UnresolvedIssue({
  row,
  readOnly,
  busy,
  onReplace,
  onRemove,
}: IssueProps) {
  return (
    <div className={styles.issue}>
      <span className={styles.issueText}>
        <Icon icon={faTriangleExclamation} className="dl-icon--current" />
        {unresolvedMessage(row.entry)}
      </span>
      {!readOnly && (
        <span className={styles.issueActions}>
          <Button buttonSize="xxs" disabled={busy} onClick={onReplace}>
            Replace
          </Button>
          <Button buttonSize="xxs" disabled={busy} onClick={onRemove}>
            Remove
          </Button>
        </span>
      )}
    </div>
  );
}

function HandleDriftIssue({ row, readOnly, busy, onUpdateHandle }: IssueProps) {
  const handle = row.handleDrift ?? '';
  return (
    <div className={styles.issue}>
      <span className={styles.issueText}>
        <Icon icon={faTriangleExclamation} className="dl-icon--current" />
        <span>
          The Shopify handle changed to{' '}
          <code className={styles.inlineCode}>{handle}</code>
        </span>
      </span>
      {!readOnly && (
        <span className={styles.issueActions}>
          <Button
            buttonSize="xxs"
            disabled={busy}
            onClick={() => onUpdateHandle(handle)}
          >
            Update
          </Button>
        </span>
      )}
    </div>
  );
}

function RowIssue(props: IssueProps) {
  if (props.row.state === 'unresolved') return <UnresolvedIssue {...props} />;
  if (props.row.handleDrift) return <HandleDriftIssue {...props} />;
  return null;
}

function cardClass(row: RowModel, lifted: boolean): string {
  return [
    styles.card,
    row.state === 'unresolved' ? styles.cardWarning : '',
    row.state === 'pending' ? styles.cardFetching : '',
    lifted ? styles.cardLifted : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * One selected product, variant or collection, laid out like a linked-record
 * row: thumbnail, title (linking to the storefront when there is one), meta
 * line, availability, and the price flush right, with action buttons that
 * fade in to its left on hover. Unresolved and drifted entries add a
 * warning strip with their recovery actions.
 */
export default function EntryRow(props: EntryRowProps) {
  const { row, readOnly, busy } = props;
  const title = rowTitle(row);
  const price = row.node ? nodePrice(row.node) : null;
  // The copy that follows the pointer isn't a row to return focus to.
  const marker = props.lifted ? {} : { [ROW_ATTRIBUTE]: row.key };
  return (
    <div className={styles.row} {...marker}>
      {props.dragHandle}
      <div
        className={cardClass(row, props.lifted === true)}
        aria-busy={row.state === 'pending'}
      >
        <div className={styles.main}>
          <RowThumb row={row} />
          <div className={styles.content}>
            <RowTitle row={row} />
            <RowDetails row={row} inventory={props.inventory} />
          </div>
          {!readOnly && (
            <RowActions
              title={title}
              adminUrl={row.adminUrl}
              adminSearchUrl={row.adminSearchUrl}
              storefrontUrl={row.storefrontUrl}
              disabled={busy}
              onReplace={props.onReplace}
              onRemove={props.onRemove}
              ghost={props.lifted === true}
              linksOnly={row.state === 'unresolved'}
            />
          )}
          {price && (
            <PriceTag
              price={price}
              locale={props.locale}
              className={styles.price}
            />
          )}
        </div>
        <RowIssue {...props} />
      </div>
    </div>
  );
}
