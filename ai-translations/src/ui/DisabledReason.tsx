/**
 * DisabledReason.tsx
 * ------------------
 * Explains why an action is unavailable: while `reason` is set, the wrapped
 * button is disabled and a tooltip on its anchor span gives the one reason.
 *
 * The element tree is the same whether the action is blocked or not
 * (`Tooltip > TooltipTrigger > span > button`); only the tooltip content, the
 * anchor's `tabIndex` and the button's `pointerEvents` toggle, so the button
 * never remounts when readiness flips. The anchor span is required because
 * the kit `Button` forwards neither refs nor handlers to `TooltipTrigger`.
 * It has no click handler: a blocked action is not clickable.
 */
import { Tooltip, TooltipContent, TooltipTrigger } from 'datocms-react-ui';
import { type CSSProperties, cloneElement, type ReactElement } from 'react';

type Props = {
  /** `null` → enabled: no tooltip and no extra tab stop. */
  reason: string | null;
  placement?: 'top' | 'bottom' | 'bottom-end';
  /** Full-width anchor, for a full-width submit. */
  block?: boolean;
  children: ReactElement<{ disabled?: boolean; style?: CSSProperties }>;
};

export function DisabledReason({
  reason,
  placement = 'bottom',
  block = false,
  children,
}: Props) {
  const blocked = reason !== null;
  return (
    <Tooltip placement={placement}>
      <TooltipTrigger>
        <span
          className={
            block
              ? 'dl-tooltip-anchor dl-tooltip-anchor--block'
              : 'dl-tooltip-anchor'
          }
          tabIndex={blocked ? 0 : undefined}
        >
          {blocked
            ? cloneElement(children, {
                disabled: true,
                style: { ...children.props.style, pointerEvents: 'none' },
              })
            : children}
        </span>
      </TooltipTrigger>
      {blocked && (
        <TooltipContent>
          <div className="dl-tooltip-text">{reason}</div>
        </TooltipContent>
      )}
    </Tooltip>
  );
}
