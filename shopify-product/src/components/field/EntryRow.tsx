import Button from 'datocms-react-ui/Button';
import CardList from 'datocms-react-ui/CardList';
import { DragHandle, type SortableItemApi } from 'datocms-react-ui/dnd';
import EntityRow from 'datocms-react-ui/EntityRow';
import IdText from 'datocms-react-ui/IdText';
import Pill from 'datocms-react-ui/Pill';
import ProgressBar from 'datocms-react-ui/ProgressBar';
import type { ReactNode } from 'react';
import { EyeSlashIcon, KindIcon } from '../../icons';
import { kindNoun, type RowModel, rowMeta } from '../../lib/fieldValue';
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

/**
 * `vendor · type` (or the SKU of a variant) and the availability. Without
 * live data, the handle under a saved title.
 */
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
 * The fix of a row's status, at the end of the row, always visible (the
 * row's actions show only on hover or focus), ghost like every action next
 * to a value: Replace for a row that doesn't show (its "Not visible" pill;
 * the callout above the card says why, once for every such row), Update
 * address for a changed web address (its "Address changed" pill). Null for
 * a read-only field.
 */
function rowFix({
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
        tone="ghost"
        size="milli"
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
      tone="ghost"
      size="milli"
      label="Update address"
      disabled={disabled}
      onClick={() => actions.updateHandle(row.key, handle)}
    />
  );
}

/** The state of the row, next to its title. */
function rowPill(row: RowModel): ReactNode {
  if (row.state === 'unresolved') {
    return <Pill tone="warning">Not visible</Pill>;
  }
  if (!row.handleDrift) return undefined;
  return (
    <Pill
      tone="warning"
      tooltip={`This ${kindNoun(row.entry.kind)}'s web address changed in Shopify.`}
    >
      Address changed
    </Pill>
  );
}

/**
 * One product, variant or collection of the field, as an item of the card:
 * thumbnail, title, details, availability and price, then the ⋮ with the
 * links and the changes. A row that doesn't show, or whose web address
 * changed, has a pill after its title and ends with the button that fixes
 * it. A row that still loads shows a progress line on its bottom edge.
 */
export default function EntryItem(props: EntryItemProps) {
  const { row, index, readOnly, actions, sortable } = props;
  const title = rowTitle(row);
  const price = row.node ? nodePrice(row.node) : null;
  const fix = rowFix({ row, index, readOnly, actions });

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
            fallback={
              row.state === 'unresolved' ? (
                <EyeSlashIcon />
              ) : (
                <KindIcon kind={row.entry.kind} />
              )
            }
          />
        }
        title={<RowTitle row={row} />}
        afterTitle={rowPill(row)}
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
      {sortable.dropIndicator}
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
      row={{ summary, trailing: fix, actions: menu }}
    />
  );
}
