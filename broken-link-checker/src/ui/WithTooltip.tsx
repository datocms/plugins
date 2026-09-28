import { Tooltip, TooltipContent, TooltipTrigger } from 'datocms-react-ui';
import type { ReactNode } from 'react';

type WithTooltipProps = {
  content: ReactNode;
  children: ReactNode;
  /** Makes the anchor itself focusable, for wrapped controls that can't take focus (disabled buttons). */
  focusable?: boolean;
  /** A block anchor, for full-width controls. */
  block?: boolean;
  placement?: 'top' | 'bottom';
};

/** TooltipTrigger needs a DOM child that takes its ref and handlers, so kit components get an anchor span. */
export function WithTooltip({
  content,
  children,
  focusable,
  block,
  placement = 'top',
}: WithTooltipProps) {
  return (
    <Tooltip placement={placement}>
      <TooltipTrigger>
        <span
          className={
            block ? 'dl-tooltip-anchor blc-block-anchor' : 'dl-tooltip-anchor'
          }
          tabIndex={focusable ? 0 : undefined}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="dl-tooltip-text">{content}</div>
      </TooltipContent>
    </Tooltip>
  );
}

/** Explains why the wrapped control is temporarily disabled; renders the control alone when it isn't. */
export function DisabledReason({
  reason,
  block,
  children,
}: {
  reason: string | null;
  block?: boolean;
  children: ReactNode;
}) {
  if (reason === null) return <>{children}</>;
  return (
    <WithTooltip focusable block={block} content={reason}>
      {children}
    </WithTooltip>
  );
}
