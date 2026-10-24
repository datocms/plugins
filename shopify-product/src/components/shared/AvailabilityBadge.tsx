import FeedbackDot, {
  type FeedbackDotProps,
} from 'datocms-react-ui/FeedbackDot';
import {
  type Availability,
  type AvailabilityTone,
  availability,
  formatCount,
} from '../../lib/format';
import type { ShopifyNode } from '../../types';

/** The dot of an availability, for `FeedbackDot` and `StatusCell`. */
export function availabilityDotTone(
  tone: AvailabilityTone,
): FeedbackDotProps['tone'] {
  switch (tone) {
    case 'success':
      return 'success';
    case 'danger':
      return 'danger';
    default:
      return 'neutral';
  }
}

/**
 * "Available", or "Available · 12 in stock" with a known stock count, the
 * number with the separators of `locale` ("1,200 in stock").
 */
export function availabilityText(
  status: Availability,
  locale?: string,
): string {
  return status.quantity === null
    ? status.label
    : `${status.label} · ${formatCount(status.quantity, locale)} in stock`;
}

type Props = {
  node: ShopifyNode;
  /** `ctx.ui.locale`, for the stock count. */
  locale: string;
  /** Show stock counts (only with the inventory capability). */
  inventory?: boolean;
  className?: string;
};

/**
 * "● Available", "● Sold out", "● Available to order", plus "· 12 in stock":
 * a dot and its word, for a row's details or a card. Nothing for collections.
 * In a table cell, use `StatusCell` with `availabilityDotTone` and
 * `availabilityText` instead.
 */
export default function AvailabilityBadge({
  node,
  locale,
  inventory,
  className,
}: Props) {
  const status = availability(node, { inventory });
  if (!status.label) return null;
  return (
    <span className={className}>
      <FeedbackDot tone={availabilityDotTone(status.tone)} />
      {/* No break between the dot and its word. */}
      {' '}
      {availabilityText(status, locale)}
    </span>
  );
}
