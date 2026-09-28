import {
  Tooltip,
  TooltipContent,
  type TooltipProps,
  TooltipTrigger,
} from 'datocms-react-ui';
import type { ReactElement, ReactNode } from 'react';

export type TipPlacement = TooltipProps['placement'];

type TipProps = {
  /** Tooltip text. Icon-only controls also need the same text as their accessible name. */
  label: ReactNode;
  placement?: TipPlacement;
  /** Controlled mode: the caller opens and closes it (the kit's hover and focus handling is off). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** One element that takes a ref and DOM handlers (a native button, link or span). */
  children: ReactElement;
};

/** Kit tooltip with the dashboard's compact, centered text (.dl-tooltip-text). */
export function Tip({
  label,
  placement,
  open,
  onOpenChange,
  children,
}: TipProps) {
  return (
    <Tooltip placement={placement} open={open} onOpenChange={onOpenChange}>
      <TooltipTrigger>{children}</TooltipTrigger>
      <TooltipContent>
        <div className="dl-tooltip-text">{label}</div>
      </TooltipContent>
    </Tooltip>
  );
}
