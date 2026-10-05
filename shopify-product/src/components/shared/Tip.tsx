import {
  Tooltip,
  type TooltipProps,
  TooltipContent,
  TooltipTrigger,
} from 'datocms-react-ui';
import type { ReactElement, ReactNode } from 'react';

type Props = {
  /** The tip. `null` renders the children alone. */
  tip: ReactNode | null;
  placement?: TooltipProps['placement'];
  /**
   * Wrap the children in an anchor span (`.dl-tooltip-anchor`). Needed around
   * kit components that don't take a ref and handlers, and around disabled
   * buttons, which take no pointer events or focus. `'focusable'` also puts
   * the anchor in the tab order, so keyboard users can reach the tip.
   */
  anchor?: boolean | 'focusable';
  /** Extra class on the anchor span. */
  anchorClassName?: string;
  /**
   * Without `anchor`: one element that takes a ref and event handlers, such
   * as a `<button>`. Don't give it a ref of its own: the kit's
   * `TooltipTrigger` spreads the child's props over its own, and on React 19
   * a child's `ref` is one of them, so the tip would lose its anchor.
   */
  children: ReactElement;
};

/**
 * A dashboard-like tooltip: the kit `Tooltip` with the tip set in
 * `.dl-tooltip-text` (250px max, centered, balanced). Use it for every
 * tooltip, so they all look and behave the same.
 */
export default function Tip({
  tip,
  placement = 'top',
  anchor = false,
  anchorClassName,
  children,
}: Props) {
  if (tip === null) return children;
  const trigger = anchor ? (
    <span
      className={['dl-tooltip-anchor', anchorClassName]
        .filter(Boolean)
        .join(' ')}
      tabIndex={anchor === 'focusable' ? 0 : undefined}
    >
      {children}
    </span>
  ) : (
    children
  );
  return (
    <Tooltip placement={placement}>
      <TooltipTrigger>{trigger}</TooltipTrigger>
      <TooltipContent>
        <div className="dl-tooltip-text">{tip}</div>
      </TooltipContent>
    </Tooltip>
  );
}
