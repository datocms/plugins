import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
import type { KeyboardEvent, ReactNode } from 'react';
import { pluralize } from '../../lib/format';
import { ALREADY_IN_FIELD_MESSAGE } from '../../lib/pickerSearch';
import type { CollectionSummary, ProductSummary } from '../../types';
import { Icon } from '../../ui/Icon';
import AvailabilityBadge from '../shared/AvailabilityBadge';
import PriceTag, { nodePrice } from '../shared/PriceTag';
import Thumbnail from '../shared/Thumbnail';
import Tip from '../shared/Tip';
import styles from './ResultItems.module.css';
import { useRovingTabIndex } from './rovingFocus';
import type { PickerView } from './usePickerView';

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/**
 * The checkbox of an item in a multiple field: native, with the brand
 * accent (forms.md §7), the same in cards, rows and variant rows. It carries
 * the roving tab stop; Space toggles it, and so does Enter.
 */
export function CheckboxInput({
  rovingKey,
  checked,
  disabled,
  onToggle,
}: {
  rovingKey: string;
  checked: boolean;
  /** Can't be checked now (the tooltip says why); it stays focusable. */
  disabled: boolean;
  onToggle: () => void;
}) {
  const tabIndex = useRovingTabIndex(rovingKey);
  const toggle = () => {
    if (!disabled) onToggle();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      toggle();
    }
  };
  return (
    <input
      type="checkbox"
      className={styles.checkbox}
      checked={checked}
      aria-disabled={disabled || undefined}
      data-roving={rovingKey}
      tabIndex={tabIndex}
      onChange={toggle}
      onKeyDown={onKeyDown}
    />
  );
}

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
 * that aren't selected (and cards that open variants never are blocked);
 * items already in the field always are.
 */
export function isItemDisabled(
  state: Pick<ItemSelectionState, 'selected' | 'disabledReason' | 'locked'>,
  expandable = false,
): boolean {
  if (!state.disabledReason) return false;
  return state.locked === true || (!state.selected && !expandable);
}

/** Items that can't be picked right now say why in a tooltip. */
type ItemControlProps = ItemSelectionState & {
  rovingKey: string;
  className: string;
  /** Variant mode: the card opens a variant panel instead of selecting. */
  expandable?: { expanded: boolean; panelId: string } | null;
  busy?: boolean;
  onActivate: () => void;
};

/** Single fields, and cards that open variants: the whole item is one button. */
function ItemButton({
  rovingKey,
  className,
  selected,
  multiple,
  disabledReason,
  locked,
  expandable,
  busy,
  onActivate,
  children,
}: ItemControlProps & { children: ReactNode }) {
  const tabIndex = useRovingTabIndex(rovingKey);
  const disabled = isItemDisabled(
    { selected, disabledReason, locked },
    Boolean(expandable),
  );
  return (
    <Tip tip={disabled ? disabledReason : null}>
      <button
        type="button"
        className={cx(
          className,
          selected && styles.selected,
          disabled && styles.disabled,
          expandable?.expanded && styles.expanded,
        )}
        data-roving={rovingKey}
        tabIndex={tabIndex}
        aria-current={!multiple && selected && !locked ? 'true' : undefined}
        aria-expanded={expandable ? expandable.expanded : undefined}
        aria-controls={expandable?.expanded ? expandable.panelId : undefined}
        aria-disabled={disabled || undefined}
        aria-busy={busy || undefined}
        onClick={disabled ? undefined : onActivate}
      >
        {children}
      </button>
    </Tip>
  );
}

/**
 * Multiple fields: the card or row is the label of its checkbox, so clicking
 * anywhere on it toggles the item.
 */
function ItemCheckbox({
  rovingKey,
  className,
  selected,
  disabledReason,
  locked,
  busy,
  onActivate,
  children,
}: ItemControlProps & { children: (check: ReactNode) => ReactNode }) {
  const disabled = isItemDisabled({ selected, disabledReason, locked });
  return (
    <Tip tip={disabled ? disabledReason : null}>
      <label
        className={cx(
          className,
          selected && styles.selected,
          disabled && styles.disabled,
        )}
        aria-busy={busy || undefined}
      >
        {children(
          <CheckboxInput
            rovingKey={rovingKey}
            checked={selected}
            disabled={disabled}
            onToggle={onActivate}
          />,
        )}
      </label>
    </Tip>
  );
}

/**
 * A checkbox item in multiple fields, else a button. `children` lays the
 * item out around its checkbox (`null` for buttons).
 */
function ItemControl({
  children,
  ...props
}: ItemControlProps & { children: (check: ReactNode) => ReactNode }) {
  if (props.multiple && !props.expandable) {
    return <ItemCheckbox {...props}>{children}</ItemCheckbox>;
  }
  return <ItemButton {...props}>{children(null)}</ItemButton>;
}

function variantsLabel(product: ProductSummary): string | null {
  const count = product.variantsCount?.count;
  return typeof count === 'number' && count > 1
    ? pluralize(count, 'variant')
    : null;
}

/** `"Vendor · product type"`, as in the field editor's rows. */
function productDetails(product: ProductSummary): string {
  return [product.vendor, product.productType]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' · ');
}

export type ItemNote = { label: string; code: string };

function Note({ note }: { note: ItemNote | null | undefined }) {
  if (!note) return null;
  return (
    <span className={styles.note}>
      {note.label} <code className={styles.code}>{note.code}</code>
    </span>
  );
}

export type ProductItemProps = ItemSelectionState & {
  product: ProductSummary;
  view: PickerView;
  rovingKey: string;
  locale: string;
  inventory: boolean;
  expandable?: { expanded: boolean; panelId: string } | null;
  /** Variant mode: how many of its variants are selected. */
  selectedVariants?: number;
  /** A line under the details naming a code, e.g. the SKU that matched. */
  note?: ItemNote | null;
  /** List view in variant mode: keep a chevron column on every row. */
  chevronColumn?: boolean;
  busy?: boolean;
  onActivate: () => void;
};

function SelectedVariantsTag({ count }: { count: number }) {
  if (count === 0) return null;
  return <span className={styles.countTag}>{count} selected</span>;
}

function ProductCard(props: ProductItemProps) {
  const { product, locale, inventory, expandable } = props;
  const price = nodePrice(product);
  const variants = variantsLabel(product);
  const details = productDetails(product);
  return (
    <ItemControl {...props} className={styles.card}>
      {(check) => (
        <>
          <span className={styles.media}>
            <Thumbnail
              image={product.featuredImage}
              fit="contain"
              className={
                product.featuredImage ? styles.mediaContain : styles.mediaEmpty
              }
            />
          </span>
          <span className={styles.body}>
            {check}
            <span className={styles.bodyMain}>
              <span className={styles.title}>{product.title}</span>
              {details && <span className={styles.details}>{details}</span>}
              <Note note={props.note} />
              <span className={styles.cardFooter}>
                {price && (
                  <PriceTag
                    price={price}
                    locale={locale}
                    align="start"
                    className={styles.price}
                  />
                )}
                <span className={styles.meta}>
                  <AvailabilityBadge node={product} inventory={inventory} />
                  {variants && (
                    <span className={styles.variants}>{variants}</span>
                  )}
                  {expandable && (
                    <span className={styles.chevron} aria-hidden="true">
                      <Icon icon={faChevronDown} />
                    </span>
                  )}
                </span>
              </span>
            </span>
          </span>
          {/* Last, so the accessible name starts with the title. */}
          {expandable && (
            <span className={styles.badge}>
              <SelectedVariantsTag count={props.selectedVariants ?? 0} />
            </span>
          )}
        </>
      )}
    </ItemControl>
  );
}

/**
 * List view: the SKU of a product's only variant ("No SKU" when it has
 * none). Products with several variants leave it empty: the Variants
 * column already counts them.
 */
function SkuCell({ product }: { product: ProductSummary }) {
  const single = product.variantsCount?.count === 1;
  return (
    <span className={styles.rowSku}>
      {single &&
        (product.sku ? (
          <code className={styles.code}>{product.sku}</code>
        ) : (
          <span className={styles.none}>No SKU</span>
        ))}
    </span>
  );
}

function ProductRow(props: ProductItemProps) {
  const { product, locale, inventory, multiple, expandable } = props;
  const price = nodePrice(product);
  const details = productDetails(product);
  return (
    <ItemControl {...props} className={styles.row}>
      {(check) => (
        <>
          {check ??
            (multiple && <span className={styles.slot} aria-hidden="true" />)}
          <Thumbnail
            image={product.featuredImage}
            size={40}
            radius={4}
            className={styles.rowThumb}
          />
          <span className={styles.rowMain}>
            <span className={styles.rowTitle}>{product.title}</span>
            {details && <span className={styles.rowDetails}>{details}</span>}
            <Note note={props.note} />
          </span>
          <SkuCell product={product} />
          <span className={styles.rowVariants}>
            {expandable ? (
              <SelectedVariantsTag count={props.selectedVariants ?? 0} />
            ) : null}
            {variantsLabel(product)}
          </span>
          <span className={styles.rowPrice}>
            {price && <PriceTag price={price} locale={locale} />}
          </span>
          <span className={styles.rowAvailability}>
            <AvailabilityBadge node={product} inventory={inventory} />
          </span>
          {(expandable || props.chevronColumn) && (
            <span
              className={cx(styles.chevron, !expandable && styles.slotHidden)}
              aria-hidden="true"
            >
              <Icon icon={faChevronDown} />
            </span>
          )}
        </>
      )}
    </ItemControl>
  );
}

export function ProductItem(props: ProductItemProps) {
  return props.view === 'grid' ? (
    <ProductCard {...props} />
  ) : (
    <ProductRow {...props} />
  );
}

export type CollectionItemProps = ItemSelectionState & {
  collection: CollectionSummary;
  view: PickerView;
  rovingKey: string;
  /**
   * Grid view: show the image band. Off when no collection on the page has
   * an image, so cards aren't mostly empty swatches.
   */
  withMedia: boolean;
  onActivate: () => void;
};

function CollectionRow(props: CollectionItemProps) {
  const { collection } = props;
  return (
    <ItemControl {...props} className={styles.row}>
      {(check) => (
        <>
          {check}
          <Thumbnail
            image={collection.image}
            size={40}
            radius={4}
            className={styles.rowThumb}
          />
          <span className={styles.rowMain}>
            <span className={styles.rowTitle}>{collection.title}</span>
            <span className={styles.rowDetails}>{collection.handle}</span>
          </span>
        </>
      )}
    </ItemControl>
  );
}

export function CollectionItem(props: CollectionItemProps) {
  const { collection, view, withMedia } = props;
  if (view === 'list') return <CollectionRow {...props} />;
  return (
    <ItemControl {...props} className={styles.card}>
      {(check) => (
        <>
          {withMedia && (
            <span className={cx(styles.media, styles.mediaWide)}>
              <Thumbnail
                image={collection.image}
                className={styles.mediaCover}
              />
            </span>
          )}
          <span className={styles.body}>
            {check}
            <span className={styles.bodyMain}>
              <span className={styles.title}>{collection.title}</span>
              <span className={styles.details}>{collection.handle}</span>
            </span>
          </span>
        </>
      )}
    </ItemControl>
  );
}

/** Column titles over the list view, aligned with the rows below. */
export function ListHeader({
  columns,
  withCheck,
  withChevron,
}: {
  columns: {
    sku?: boolean;
    variants?: string;
    price?: boolean;
    availability?: boolean;
  };
  withCheck: boolean;
  withChevron: boolean;
}) {
  return (
    <div
      className={cx(
        styles.listHeader,
        withCheck && styles.listHeaderCheck,
        withChevron && styles.listHeaderChevron,
      )}
      aria-hidden="true"
    >
      <span className={styles.rowMain}>Name</span>
      {columns.sku && <span className={styles.rowSku}>SKU</span>}
      {columns.variants !== undefined && (
        <span className={styles.rowVariants}>{columns.variants}</span>
      )}
      {columns.price && <span className={styles.rowPrice}>Price</span>}
      {columns.availability && (
        <span className={styles.rowAvailability}>Availability</span>
      )}
    </div>
  );
}
