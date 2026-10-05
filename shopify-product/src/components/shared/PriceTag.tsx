import {
  formatPriceRange,
  hasCompareAtPrice,
  formatMoney,
} from '../../lib/format';
import type { Money, ShopifyNode } from '../../types';
import styles from './PriceTag.module.css';

export type NodePrice = {
  min: Money;
  max: Money;
  /** The highest compare-at price; shown struck through when it beats `max`. */
  compareAt: Money | null;
};

/** The price to show for a node, or null for collections. */
export function nodePrice(node: ShopifyNode): NodePrice | null {
  switch (node.__typename) {
    case 'Product':
      return {
        min: node.priceRange.minVariantPrice,
        max: node.priceRange.maxVariantPrice,
        compareAt: node.compareAtPriceRange.maxVariantPrice,
      };
    case 'ProductVariant':
      return {
        min: node.price,
        max: node.price,
        compareAt: node.compareAtPrice,
      };
    default:
      return null;
  }
}

type Props = {
  price: NodePrice;
  /** `ctx.ui.locale`. */
  locale: string;
  align?: 'start' | 'end';
  className?: string;
};

/** A locale-formatted price or range, with the compare-at price struck through. */
export default function PriceTag({
  price,
  locale,
  align = 'end',
  className,
}: Props) {
  const showCompareAt = hasCompareAtPrice(price.max, price.compareAt);
  return (
    <span
      className={[
        styles.price,
        align === 'start' ? styles.start : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className={styles.current}>
        {formatPriceRange(price.min, price.max, locale)}
      </span>
      {showCompareAt && price.compareAt && (
        <s className={styles.compareAt}>
          <span className="dl-sr-only">Compare at </span>
          {formatMoney(price.compareAt, locale)}
        </s>
      )}
    </span>
  );
}
