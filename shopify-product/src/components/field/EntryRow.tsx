import Button from 'datocms-react-ui/Button';
import Callout from 'datocms-react-ui/Callout';
import CardList from 'datocms-react-ui/CardList';
import { DragHandle, type SortableItemApi } from 'datocms-react-ui/dnd';
import EntityRow from 'datocms-react-ui/EntityRow';
import IdText from 'datocms-react-ui/IdText';
import Pill from 'datocms-react-ui/Pill';
import ProgressBar from 'datocms-react-ui/ProgressBar';
import type { ReactNode } from 'react';
import { EyeSlashIcon } from '../../icons';
import {
  type RowModel,
  rowMeta,
  unresolvedMessage,
} from '../../lib/fieldValue';
import { availability, nodeImage, nodeTitle } from '../../lib/format';
import type { ShopifyImage } from '../../types';
import AvailabilityBadge from '../shared/AvailabilityBadge';
import PriceTag, { nodePrice } from '../shared/PriceTag';
import Thumbnail from '../shared/Thumbnail';
import styles from './FieldParts.module.css';
import RowMenu from './RowMenu';
import { BUSY_REASON, type EditorActions } from './useEditorActions';
import { ROW_ATTRIBUTE } from './useFieldFeedback';

export type EntryItemProps = {
  row: RowModel;
  /** The row's position, and how many rows there are. */
  index: number;
  count: number;
  /** `ctx.ui.locale`, for prices and stock counts. */
  locale: string;
  /** Show stock counts (the store's effective inventory capability). */
  inventory: boolean;
  /** Read-only field: links only, no changes. */
  readOnly: boolean;
  /** Several rows of a multiple field: drag handle, Move up and Move down. */
  reorderable: boolean;
  actions: EditorActions;
  /** The drag handle and the drop line, from `SortableItem`. */
  sortable: SortableItemApi;
};

export function rowTitle(row: RowModel): string {
  return row.node ? nodeTitle(row.node) : row.fallback.label;
}

function rowImage(row: RowModel): ShopifyImage | null {
  if (row.node) return nodeImage(row.node);
  return row.fallback.imageUrl
    ? { url: row.fallback.imageUrl, altText: null }
    : null;
}

/**
 * The title, linking to the storefront (in a new tab) when there is one. A
 * fallback label that is a handle or an ID is monospaced. The link isn't
 * draggable: a drag in the row only starts from its handle.
 */
function RowTitle({ row }: { row: RowModel }) {
  const title = rowTitle(row);
  const text =
    !row.node && row.fallback.labelIsCode ? <IdText id={title} /> : title;
  if (!row.storefrontUrl) return <>{text}</>;
  return (
    <a
      href={row.storefrontUrl}
      target="_blank"
      rel="noopener noreferrer"
      draggable={false}
    >
      {text}
    </a>
  );
}

/** `vendor · type` (or the SKU of a variant) and the availability. */
function RowDetails({
  row,
  locale,
  inventory,
}: {
  row: RowModel;
  locale: string;
  inventory: boolean;
}) {
  if (!row.node) {
    const identity = row.fallback.identity;
    return identity ? <IdText id={identity} /> : null;
  }
  const meta = rowMeta(row.node);
  const available = availability(row.node, { inventory }).label !== '';
  return (
    <>
      {meta && <span>{meta}</span>}
      {meta && available && ' · '}
      {available && (
        <AvailabilityBadge
          node={row.node}
          locale={locale}
          inventory={inventory}
        />
      )}
    </>
  );
}

/**
 * Why the row needs attention, under it. With a fix, the callout keeps the
 * room of the button that goes right under it.
 */
function rowIssue(row: RowModel, withFix: boolean): ReactNode {
  const className = withFix ? styles.calloutWithAction : undefined;
  if (row.state === 'unresolved') {
    return (
      <Callout tone="warning" className={className}>
        {unresolvedMessage(row.entry)}
      </Callout>
    );
  }
  if (row.handleDrift) {
    return (
      <Callout tone="warning" className={className}>
        The Shopify handle changed to <IdText id={row.handleDrift} />.
      </Callout>
    );
  }
  return null;
}

/**
 * The action that fixes the row's issue: a button right under the issue,
 * always visible (the row's actions show only on hover or focus, and a
 * callout holds no buttons). Null when there is nothing to fix, or the field
 * is read-only.
 */
function fixAction({
  row,
  index,
  readOnly,
  actions,
}: Pick<EntryItemProps, 'row' | 'index' | 'readOnly' | 'actions'>): ReactNode {
  if (readOnly) return null;
  const disabled = actions.busy !== null ? { reason: BUSY_REASON } : undefined;
  if (row.state === 'unresolved') {
    return (
      <Button
        label="Replace"
        disabled={disabled}
        onClick={() => actions.replace(index)}
      />
    );
  }
  const handle = row.handleDrift;
  if (!handle) return null;
  return (
    <Button
      label="Update handle"
      disabled={disabled}
      onClick={() => actions.updateHandle(row.key, handle)}
    />
  );
}

/**
 * One product, variant or collection of the field, as an item of the card:
 * thumbnail, title, details, availability and price, then the ⋮ with the
 * links and the changes. An issue shows under the row, with the button that
 * fixes it. A row that still loads shows a progress line on its bottom edge.
 */
export default function EntryItem(props: EntryItemProps) {
  const { row, index, readOnly, actions, sortable } = props;
  const title = rowTitle(row);
  const price = row.node ? nodePrice(row.node) : null;
  const fix = fixAction({ row, index, readOnly, actions });
  const issue = rowIssue(row, fix !== null);

  const summary = (
    <>
      {props.reorderable && (
        <DragHandle ref={sortable.handleRef} gutter="normal" />
      )}
      <EntityRow
        layout="row"
        image={
          <Thumbnail
            image={rowImage(row)}
            fallback={row.state === 'unresolved' ? <EyeSlashIcon /> : null}
          />
        }
        title={<RowTitle row={row} />}
        afterTitle={
          row.state === 'unresolved' ? (
            <Pill tone="warning">Not visible</Pill>
          ) : undefined
        }
        trailing={
          price ? <PriceTag price={price} locale={props.locale} /> : undefined
        }
      >
        <RowDetails
          row={row}
          locale={props.locale}
          inventory={props.inventory}
        />
      </EntityRow>
      {row.state === 'pending' && (
        <ProgressBar placement="edge" ariaLabel={`Loading ${title}`} />
      )}
      {/* The row is positioned: the drop line goes on its edges. */}
      {!issue && sortable.dropIndicator}
    </>
  );

  // Empty for a read-only row without links: the column stays empty.
  const menu = (
    <RowMenu
      title={title}
      index={index}
      count={props.count}
      adminUrl={row.adminUrl}
      adminSearchUrl={row.adminSearchUrl}
      storefrontUrl={row.storefrontUrl}
      readOnly={readOnly}
      busy={actions.busy !== null}
      reorderable={props.reorderable}
      replaceInRow={row.state === 'unresolved'}
      onReplace={() => actions.replace(index)}
      onRemove={() => actions.remove(index)}
      onMoveUp={() => actions.moveUp(index)}
      onMoveDown={() => actions.moveDown(index)}
    />
  );

  return (
    // The focus rescue finds rows by their attribute, on the item's `li`.
    <CardList.Item
      ref={sortable.ref}
      {...{ [ROW_ATTRIBUTE]: row.key }}
      className={styles.item}
      row={{ summary, actions: menu }}
      body={
        issue ? (
          <>
            {/* The item is positioned: the drop line goes on its edges,
                under the issue too. */}
            {sortable.dropIndicator}
            {issue}
            {fix && <div className={styles.actions}>{fix}</div>}
          </>
        ) : undefined
      }
    />
  );
}
