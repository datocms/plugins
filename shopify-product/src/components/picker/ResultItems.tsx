import EntityRow from 'datocms-react-ui/EntityRow';
import IdText from 'datocms-react-ui/IdText';
import MediaCard from 'datocms-react-ui/MediaCard';
import Pill from 'datocms-react-ui/Pill';
import ProgressBar from 'datocms-react-ui/ProgressBar';
import type {
  RowSelection,
  TableColumn,
  TableFirstCell,
} from 'datocms-react-ui/Table';
import StatusCell from 'datocms-react-ui/Table/cells/StatusCell';
import { type ReactNode, type RefObject, useLayoutEffect, useRef } from 'react';
import {
  availability,
  nodeImage,
  nodeTitle,
  pluralize,
} from '../../lib/format';
import { ALREADY_IN_FIELD_MESSAGE } from '../../lib/pickerSearch';
import type { ShopifyClient } from '../../lib/shopifyClient';
import { DEFAULT_VARIANT_TITLE } from '../../lib/titles';
import type {
  CollectionSummary,
  ProductSummary,
  ShopifyKind,
  ShopifyNode,
  VariantSummary,
} from '../../types';
import AvailabilityBadge, {
  availabilityDotTone,
  availabilityText,
} from '../shared/AvailabilityBadge';
import PriceTag, { nodePrice } from '../shared/PriceTag';
import Thumbnail from '../shared/Thumbnail';
import styles from './ResultsPane.module.css';
import { ITEM_ATTRIBUTE } from './useKeepFocus';
import type { PickerView } from './usePickerView';

// ---------------------------------------------------------------------------
// What an item needs, and whether it can be picked
// ---------------------------------------------------------------------------

/** Everything an item needs to render and act, shared by every section. */
export type ItemEnv = {
  kind: ShopifyKind;
  view: PickerView;
  locale: string;
  inventory: boolean;
  multiple: boolean;
  /** Something is selected: the cards' checkboxes stay visible. */
  hasSelection: boolean;
  /**
   * The items are the last results while a new search, filter, sort or
   * market loads: they show as unavailable, and only an open product can
   * close.
   */
  stale: boolean;
  client: ShopifyClient;
  contextKey: string;
  /** Why unselected items can't be picked (the selection is full), or null. */
  disabledReason: string | null;
  /** Variant mode: why sold-out variants can't be picked right now, or null. */
  soldOutReason: string | null;
  isSelected: (node: ShopifyNode) => boolean;
  /** Already in the field (Replace): shown selected, and can't be picked. */
  isUnavailable: (node: ShopifyNode) => boolean;
  selectedVariants: (productId: string) => number;
  expandedId: string | null;
  pendingId: string | null;
  pick: (node: ShopifyNode) => void;
  /** Gives selected entries without a node the matching loaded nodes. */
  hydrate: (nodes: readonly ShopifyNode[]) => void;
  activateProduct: (product: ProductSummary) => void;
};

export type ItemSelectionState = {
  selected: boolean;
  multiple: boolean;
  /** Why the item can't be picked (the selection is full), or null. */
  disabledReason: string | null;
  /**
   * Already in the field (Replace): shown selected, but it can't be picked,
   * and `disabledReason` says why.
   */
  locked?: boolean;
  /**
   * From the previous query while the new one loads (`ItemEnv.stale`): it
   * shows its state, but it can't be picked or opened.
   */
  stale?: boolean;
};

/** Items already in the field show as selected, and say why they're locked. */
export function lockedState(multiple: boolean): ItemSelectionState {
  return {
    selected: true,
    multiple,
    disabledReason: ALREADY_IN_FIELD_MESSAGE,
    locked: true,
  };
}

/**
 * Whether the item can't be picked now. A full selection only blocks items
 * that aren't selected (and products that open variants never are blocked);
 * items already in the field, and the last results while new ones load,
 * always are.
 */
export function isItemDisabled(
  state: Pick<
    ItemSelectionState,
    'selected' | 'disabledReason' | 'locked' | 'stale'
  >,
  expandable = false,
): boolean {
  if (state.stale) return true;
  if (!state.disabledReason) return false;
  return state.locked === true || (!state.selected && !expandable);
}

/** The props that mark an item, for the focus that follows Load more. */
export const ITEM_PROPS = { [ITEM_ATTRIBUTE]: '' };

/** The pill of an item already in the field (Replace). */
const IN_FIELD_LABEL = 'In this field';

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** `"Black / M"`; a product's only variant reads as its title. */
export function variantLabel(variant: VariantSummary): string {
  const values = variant.selectedOptions
    .map((option) => option.value.trim())
    .filter((value) => value && value !== DEFAULT_VARIANT_TITLE);
  if (values.length > 0) return values.join(' / ');
  const title = variant.title.trim();
  return title && title !== DEFAULT_VARIANT_TITLE
    ? title
    : variant.product.title;
}

/** `"8 variants"` for a product with several, else null. */
function variantsLabel(product: ProductSummary, locale: string): string | null {
  const count = product.variantsCount?.count;
  return typeof count === 'number' && count > 1
    ? pluralize(count, 'variant', 'variants', locale)
    : null;
}

/** `"Vendor · product type"`, as in the field editor's rows. */
function productDetails(product: ProductSummary): string {
  return [product.vendor, product.productType]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' · ');
}

/** The code that matched a search, shown under the product. */
export type ItemNote = { label: string; code: string };

function Note({ note }: { note: ItemNote }) {
  return (
    <span>
      {note.label} <IdText id={note.code} />
    </span>
  );
}

/** A fact about the product, "2 variants selected": the neutral tone. */
function SelectedVariantsPill({
  count,
  locale,
}: {
  count: number;
  locale: string;
}) {
  return count > 0 ? (
    <Pill>
      {pluralize(count, 'variant selected', 'variants selected', locale)}
    </Pill>
  ) : null;
}

// ---------------------------------------------------------------------------
// Grid: cards
// ---------------------------------------------------------------------------

/**
 * The card's media button has no props for these states: they are set on
 * the button the card renders (the one its caption names), after each
 * render.
 */
function useCardButtonState(
  card: RefObject<HTMLElement | null>,
  attributes: Record<string, string | undefined>,
) {
  useLayoutEffect(() => {
    const button = card.current?.querySelector('button[aria-labelledby]');
    if (!button) return;
    for (const [name, value] of Object.entries(attributes)) {
      if (value === undefined) button.removeAttribute(name);
      else button.setAttribute(name, value);
    }
  });
}

type CardProps = {
  state: ItemSelectionState;
  /** Something is selected: the checkbox shows on every card. */
  hasSelection: boolean;
  onActivate: () => void;
};

/**
 * The card around an item's media. Multiple fields: a checkbox in the
 * caption. Single fields: a click on the card resolves the picker. Items that
 * can't be picked show their state only, with the subtle caption. `onOpen` (a
 * product that opens its variants) replaces the selection: the product itself
 * is never picked, so its card isn't selectable, and it tells it's open
 * through `aria-expanded` and the panel under its row (its pill counts the
 * selected variants). While the results are stale, only an open product's
 * card still acts: it closes.
 */
function PickCard({
  cardRef,
  caption,
  state,
  hasSelection,
  onActivate,
  open,
  children,
}: CardProps & {
  cardRef: RefObject<HTMLDivElement | null>;
  caption: string;
  open?: { onOpen: () => void; expanded: boolean };
  children: ReactNode;
}) {
  if (open) {
    const waits = state.stale === true && !open.expanded;
    return waits ? (
      <MediaCard ref={cardRef} caption={caption} captionDisabled>
        {children}
      </MediaCard>
    ) : (
      <MediaCard ref={cardRef} caption={caption} onClick={open.onOpen}>
        {children}
      </MediaCard>
    );
  }
  const disabled = isItemDisabled(state);
  const common = {
    ref: cardRef,
    caption,
    captionDisabled: disabled && !state.locked,
  };
  const onSelect = disabled ? undefined : onActivate;
  if (state.multiple) {
    return (
      <MediaCard
        {...common}
        selection={{
          selected: state.selected,
          onSelect,
          checkbox: hasSelection ? 'always' : 'hover',
        }}
      >
        {children}
      </MediaCard>
    );
  }
  return (
    <MediaCard {...common} selection={{ selected: state.selected, onSelect }}>
      {children}
    </MediaCard>
  );
}

/** Variant mode: a product with several variants opens them in a panel. */
export type Expandable = { expanded: boolean; panelId: string };

export type ProductCardProps = CardProps & {
  product: ProductSummary;
  locale: string;
  inventory: boolean;
  /** Variant mode: how many of its variants are selected. */
  selectedVariants: number;
  /** The code that matched the search (SKU or barcode). */
  note: ItemNote | null;
  expandable: Expandable | null;
  /** Its only variant loads before it's picked. */
  busy: boolean;
};

/**
 * A product in the grid. An accepted deviation from MediaCard, whose
 * children are only the media (the redesign brief keeps it on purpose): a
 * strip under the picture keeps what the editor compares before picking
 * (vendor and type, the matched code, price, availability, the variant
 * count) and the states the card can't show itself ("2 variants selected",
 * "In this field"). The grid is the picker's default view, and its cards showed these
 * before the redesign: with the media alone, they would only be in the list
 * view.
 */
export function ProductCard(props: ProductCardProps) {
  const { product, state, expandable, busy } = props;
  const cardRef = useRef<HTMLDivElement>(null);
  useCardButtonState(cardRef, {
    'aria-expanded': expandable ? String(expandable.expanded) : undefined,
    'aria-controls': expandable?.expanded ? expandable.panelId : undefined,
    'aria-current':
      !state.multiple && state.selected && !state.locked ? 'true' : undefined,
    'aria-busy': busy ? 'true' : undefined,
  });
  const price = nodePrice(product);
  const details = productDetails(product);
  const variants = variantsLabel(product, props.locale);

  return (
    <div className={styles.item} {...ITEM_PROPS}>
      <PickCard
        {...props}
        cardRef={cardRef}
        caption={product.title}
        open={
          expandable
            ? { onOpen: props.onActivate, expanded: expandable.expanded }
            : undefined
        }
      >
        <Thumbnail
          image={product.featuredImage}
          fit="contain"
          className={styles.media}
        />
        <div className={styles.details}>
          {details && <span className={styles.subtle}>{details}</span>}
          {props.note && (
            <span className={styles.subtle}>
              <Note note={props.note} />
            </span>
          )}
          {price && (
            <PriceTag price={price} locale={props.locale} align="start" />
          )}
          <span className={styles.line}>
            <AvailabilityBadge
              node={product}
              locale={props.locale}
              inventory={props.inventory}
            />
            {variants && <span className={styles.subtle}> · {variants}</span>}
          </span>
          {(props.selectedVariants > 0 || state.locked) && (
            <span className={styles.pills}>
              <SelectedVariantsPill
                count={props.selectedVariants}
                locale={props.locale}
              />
              {state.locked && <Pill>{IN_FIELD_LABEL}</Pill>}
            </span>
          )}
        </div>
        {busy && (
          <ProgressBar
            placement="edge"
            ariaLabel={`Loading ${product.title}`}
          />
        )}
      </PickCard>
    </div>
  );
}

export type CollectionCardProps = CardProps & {
  collection: CollectionSummary;
  /**
   * Show the image band. Off when no collection on the page has an image, so
   * cards aren't mostly empty swatches.
   */
  withMedia: boolean;
};

export function CollectionCard(props: CollectionCardProps) {
  const { collection, state } = props;
  const cardRef = useRef<HTMLDivElement>(null);
  useCardButtonState(cardRef, {
    'aria-current':
      !state.multiple && state.selected && !state.locked ? 'true' : undefined,
  });
  return (
    <div className={styles.item} {...ITEM_PROPS}>
      <PickCard {...props} cardRef={cardRef} caption={collection.title}>
        {props.withMedia && (
          <Thumbnail image={collection.image} className={styles.mediaWide} />
        )}
        <div className={styles.details}>
          <span className={styles.subtle}>{collection.handle}</span>
          {state.locked && (
            <span className={styles.pills}>
              <Pill>{IN_FIELD_LABEL}</Pill>
            </span>
          )}
        </div>
      </PickCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List: the columns of the tables
// ---------------------------------------------------------------------------

/** What a row of a table shows: a product, a variant or a collection. */
export type ResultRow = {
  node: ShopifyNode;
  locale: string;
  inventory: boolean;
  /** Already in the field (Replace). */
  inField: boolean;
  note: ItemNote | null;
  /** Variant mode: how many variants of the product are selected. */
  selectedVariants: number;
  /** SKU matches name each variant with its product. */
  showProduct: boolean;
  /**
   * Why the row can't be picked, when nothing else says it: a sold-out
   * variant while "Available for sale" applies. A full selection is told
   * after the count in the footer, and items already in the field carry
   * their pill.
   */
  reason: string | null;
};

function rowTitle(row: ResultRow): string {
  const { node } = row;
  if (node.__typename !== 'ProductVariant') return node.title;
  return row.showProduct ? nodeTitle(node) : variantLabel(node);
}

function rowDetails(node: ShopifyNode): string {
  if (node.__typename === 'Product') return productDetails(node);
  return node.__typename === 'Collection' ? node.handle : '';
}

function NameCell({ row }: { row: ResultRow }) {
  const details = rowDetails(row.node);
  const before = Boolean(details || row.note);
  return (
    <EntityRow
      layout="row"
      image={<Thumbnail image={nodeImage(row.node)} />}
      title={rowTitle(row)}
      afterTitle={row.inField ? <Pill>{IN_FIELD_LABEL}</Pill> : undefined}
    >
      {before || row.reason ? (
        <>
          {details}
          {details && row.note && ' · '}
          {row.note && <Note note={row.note} />}
          {before && row.reason && ' · '}
          {row.reason}
        </>
      ) : undefined}
    </EntityRow>
  );
}

/**
 * The SKU (or barcode) of a variant, or of a product's only variant ("No
 * SKU" when it has none). Products with several variants leave it empty:
 * the Variants column counts them.
 */
function SkuCell({ node }: { node: ShopifyNode }) {
  let code: string | null = null;
  if (node.__typename === 'ProductVariant') {
    code = node.sku?.trim() || node.barcode?.trim() || '';
  } else if (node.__typename === 'Product' && node.variantsCount?.count === 1) {
    code = node.sku?.trim() ?? '';
  }
  if (code === null) return null;
  return code ? (
    <IdText id={code} />
  ) : (
    <span className={styles.subtle}>No SKU</span>
  );
}

function VariantsCell({ row }: { row: ResultRow }) {
  if (row.node.__typename !== 'Product') return null;
  const label = variantsLabel(row.node, row.locale);
  return (
    <span className={styles.line}>
      <SelectedVariantsPill count={row.selectedVariants} locale={row.locale} />
      {label}
    </span>
  );
}

function PriceCell({ row }: { row: ResultRow }) {
  const price = nodePrice(row.node);
  return price ? (
    <PriceTag price={price} locale={row.locale} align="start" />
  ) : null;
}

function AvailabilityCell({ row }: { row: ResultRow }) {
  const status = availability(row.node, { inventory: row.inventory });
  if (!status.label) return null;
  return (
    <StatusCell tone={availabilityDotTone(status.tone)}>
      {availabilityText(status, row.locale)}
    </StatusCell>
  );
}

function nameColumn(label: string): TableColumn<ResultRow> {
  return {
    name: 'name',
    label,
    // The image, the title and the details: two lines of their own.
    truncate: false,
    minWidth: 200,
    renderCell: (row) => <NameCell row={row} />,
  };
}

const SKU_COLUMN: TableColumn<ResultRow> = {
  name: 'sku',
  label: 'SKU',
  priority: 1,
  renderCell: (row) => <SkuCell node={row.node} />,
};

const PRICE_COLUMN: TableColumn<ResultRow> = {
  name: 'price',
  label: 'Price',
  priority: 3,
  renderCell: (row) => <PriceCell row={row} />,
};

const AVAILABILITY_COLUMN: TableColumn<ResultRow> = {
  name: 'availability',
  label: 'Availability',
  priority: 2,
  renderCell: (row) => <AvailabilityCell row={row} />,
};

/** Products, and in variant mode their variants under them. */
export const PRODUCT_COLUMNS: TableColumn<ResultRow>[] = [
  nameColumn('Name'),
  SKU_COLUMN,
  {
    name: 'variants',
    label: 'Variants',
    renderCell: (row) => <VariantsCell row={row} />,
  },
  PRICE_COLUMN,
  AVAILABILITY_COLUMN,
];

export const PRODUCT_LAYOUT = {
  columns: [
    { name: 'name', width: 4 },
    { name: 'sku', width: 1.6 },
    { name: 'variants', width: 1.4 },
    { name: 'price', width: 1.4 },
    { name: 'availability', width: 1.6 },
  ],
};

/** The variants of one product, or the variants that matched a SKU. */
export const VARIANT_COLUMNS: TableColumn<ResultRow>[] = [
  nameColumn('Variant'),
  SKU_COLUMN,
  PRICE_COLUMN,
  AVAILABILITY_COLUMN,
];

export const VARIANT_LAYOUT = {
  columns: [
    { name: 'name', width: 3 },
    { name: 'sku', width: 1.6 },
    { name: 'price', width: 1.4 },
    { name: 'availability', width: 1.6 },
  ],
};

export const COLLECTION_COLUMNS: TableColumn<ResultRow>[] = [
  nameColumn('Name'),
];

export const COLLECTION_LAYOUT = { columns: [{ name: 'name', width: 1 }] };

/** A table's layout is kept per browser, under the plugin's name. */
export const PRODUCT_COLUMNS_STORAGE_KEY =
  'datocms-plugin-shopify-product:picker-columns';

// ---------------------------------------------------------------------------
// List: how a row picks
// ---------------------------------------------------------------------------

const noop = () => {};

export function resultRow(
  node: ShopifyNode,
  env: Pick<ItemEnv, 'locale' | 'inventory'>,
  extra: Partial<
    Pick<
      ResultRow,
      'inField' | 'note' | 'selectedVariants' | 'showProduct' | 'reason'
    >
  > = {},
): ResultRow {
  return {
    node,
    locale: env.locale,
    inventory: env.inventory,
    inField: extra.inField ?? false,
    note: extra.note ?? null,
    selectedVariants: extra.selectedVariants ?? 0,
    showProduct: extra.showProduct ?? false,
    reason: extra.reason ?? null,
  };
}

/** The props of a `Table.Row` that pick it, open it or show its state. */
export type RowBehavior = {
  selection?: RowSelection;
  muted?: boolean;
  fetching?: boolean;
  firstCell?: TableFirstCell;
} & (
  | { onOpen: () => void; active?: boolean }
  | { onOpen?: never; active?: never }
);

/**
 * Multiple fields: the row's checkbox (a click on the row toggles it).
 * Single fields: a click, Enter or Space picks the row, and the current
 * choice is the active row. Items already in the field are muted, with their
 * pill; a product with several variants (variant mode) opens them instead.
 * While the results are stale, the rows can't be picked, and only an open
 * product can close.
 */
export function rowBehavior(
  state: ItemSelectionState,
  onActivate: () => void,
  options: {
    expandable?: { open: boolean; onToggle: () => void; busy?: boolean };
    busy?: boolean;
  } = {},
): RowBehavior {
  const { expandable } = options;
  if (expandable) {
    // Its variants are picked, not the product: the checkbox stays off.
    const selection = state.multiple
      ? { selected: false, onSelect: noop, disabled: true }
      : undefined;
    if (state.stale && !expandable.open) {
      return {
        selection,
        firstCell: {
          expandable: {
            open: false,
            onToggle: expandable.onToggle,
            disabled: true,
          },
        },
      };
    }
    return {
      selection,
      onOpen: expandable.onToggle,
      firstCell: {
        expandable: {
          open: expandable.open,
          onToggle: expandable.onToggle,
          busy: expandable.busy,
        },
      },
    };
  }
  const disabled = isItemDisabled(state);
  const shared = { muted: state.locked === true, fetching: options.busy };
  if (state.multiple) {
    return {
      ...shared,
      selection: { selected: state.selected, onSelect: onActivate, disabled },
    };
  }
  return disabled
    ? shared
    : { ...shared, onOpen: onActivate, active: state.selected };
}
