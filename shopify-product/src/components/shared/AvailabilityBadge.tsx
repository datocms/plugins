import { availability } from '../../lib/format';
import type { ShopifyNode } from '../../types';
import styles from './AvailabilityBadge.module.css';

type Props = {
  node: ShopifyNode;
  /** Show stock counts (only with the inventory capability). */
  inventory?: boolean;
  className?: string;
};

/** "● Available", "● Sold out", "● Available to order", plus "· 12 in stock". */
export default function AvailabilityBadge({
  node,
  inventory,
  className,
}: Props) {
  const status = availability(node, { inventory });
  if (!status.label) return null;
  return (
    <span
      className={[styles.badge, styles[status.tone], className]
        .filter(Boolean)
        .join(' ')}
    >
      <span className={styles.dot} aria-hidden="true" />
      {status.label}
      {status.quantity !== null && (
        <span className={styles.quantity}>{status.quantity} in stock</span>
      )}
    </span>
  );
}
