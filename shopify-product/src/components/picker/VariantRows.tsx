import type { ReactNode } from 'react';
import { nodeTitle } from '../../lib/format';
import { DEFAULT_VARIANT_TITLE } from '../../lib/titles';
import type { VariantSummary } from '../../types';
import AvailabilityBadge from '../shared/AvailabilityBadge';
import PriceTag, { nodePrice } from '../shared/PriceTag';
import Thumbnail from '../shared/Thumbnail';
import Tip from '../shared/Tip';
import {
  CheckboxInput,
  type ItemSelectionState,
  isItemDisabled,
} from './ResultItems';
import { useRovingTabIndex } from './rovingFocus';
import styles from './VariantRows.module.css';

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

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

export type VariantRowProps = ItemSelectionState & {
  variant: VariantSummary;
  rovingKey: string;
  locale: string;
  inventory: boolean;
  /** SKU matches show the product title too. */
  showProduct?: boolean;
  onActivate: () => void;
};

function VariantCells({
  variant,
  locale,
  inventory,
  showProduct,
}: Pick<VariantRowProps, 'variant' | 'locale' | 'inventory' | 'showProduct'>) {
  const price = nodePrice(variant);
  const code = variant.sku?.trim() || variant.barcode?.trim() || '';
  return (
    <>
      <Thumbnail
        image={variant.image ?? variant.product.featuredImage}
        size={40}
        radius={4}
        className={styles.thumb}
      />
      <span className={styles.name}>
        {showProduct ? nodeTitle(variant) : variantLabel(variant)}
      </span>
      <span className={styles.sku}>
        {code ? (
          <code className={styles.code}>{code}</code>
        ) : (
          <span className={styles.none}>No SKU</span>
        )}
      </span>
      <span className={styles.price}>
        {price && <PriceTag price={price} locale={locale} />}
      </span>
      <span className={styles.availability}>
        <AvailabilityBadge node={variant} inventory={inventory} />
      </span>
    </>
  );
}

/** The same native checkbox as the product rows above it. */
function MultipleVariantRow(props: VariantRowProps) {
  const { rovingKey, selected, disabledReason, onActivate } = props;
  const disabled = isItemDisabled(props);
  return (
    <Tip tip={disabled ? disabledReason : null}>
      <label
        className={cx(
          styles.row,
          selected && styles.selected,
          disabled && styles.disabled,
        )}
      >
        <CheckboxInput
          rovingKey={rovingKey}
          checked={selected}
          disabled={disabled}
          onToggle={onActivate}
        />
        <VariantCells {...props} />
      </label>
    </Tip>
  );
}

function SingleVariantRow(props: VariantRowProps) {
  const { rovingKey, selected, locked, disabledReason, onActivate } = props;
  const tabIndex = useRovingTabIndex(rovingKey);
  const disabled = isItemDisabled(props);
  return (
    <Tip tip={disabled ? disabledReason : null}>
      <button
        type="button"
        className={cx(
          styles.row,
          styles.single,
          selected && styles.selected,
          disabled && styles.disabled,
        )}
        data-roving={rovingKey}
        tabIndex={tabIndex}
        aria-current={selected && !locked ? 'true' : undefined}
        aria-disabled={disabled || undefined}
        onClick={disabled ? undefined : onActivate}
      >
        <VariantCells {...props} />
      </button>
    </Tip>
  );
}

/** One selectable variant: a checkbox row (multiple) or a button (single). */
export function VariantRow(props: VariantRowProps) {
  return (
    <li className={styles.item}>
      {props.multiple ? (
        <MultipleVariantRow {...props} />
      ) : (
        <SingleVariantRow {...props} />
      )}
    </li>
  );
}

/** Column titles over variant rows. */
export function VariantHeader({ multiple }: { multiple: boolean }) {
  return (
    <div
      className={cx(styles.header, multiple && styles.headerMultiple)}
      aria-hidden="true"
    >
      <span className={styles.name}>Variant</span>
      <span className={styles.sku}>SKU</span>
      <span className={styles.price}>Price</span>
      <span className={styles.availability}>Availability</span>
    </div>
  );
}

/** The list that holds variant rows; a roving grid of one column. */
export function VariantList({
  ownerKey,
  label,
  children,
}: {
  /** The card that opened this list, for Up from the first row. */
  ownerKey?: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <ul
      className={styles.list}
      aria-label={label}
      data-roving-grid=""
      data-roving-owner={ownerKey}
    >
      {children}
    </ul>
  );
}
