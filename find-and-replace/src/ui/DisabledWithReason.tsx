import {
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
  useId,
  useState,
} from 'react';
import { Tip, type TipPlacement } from './Tip';

type DisabledWithReasonProps = {
  /** Why the control is disabled ("You cannot … as …"). */
  reason: string;
  placement?: TipPlacement;
  /** Extra classes for the focusable anchor. */
  className?: string;
  /** The disabled control. Give it `style={{ pointerEvents: 'none' }}` so the anchor gets the hover. */
  children: ReactNode;
};

/**
 * Keyboard focus, decided like the kit tooltip (floating-ui) does: jsdom never
 * matches `:focus-visible`, so there every focus counts.
 */
function focusVisible(element: Element): boolean {
  const agent = element.ownerDocument.defaultView?.navigator.userAgent ?? '';
  if (agent.includes('jsdom')) {
    return true;
  }
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}

/**
 * A disabled control swallows pointer events and can't be focused, so a
 * focusable anchor around it carries the tooltip, and a visually hidden copy
 * of the reason describes it for screen readers.
 *
 * The reason opens when the pointer moves over the anchor, on a tap, or on
 * keyboard focus. Not on a bare `mouseenter`: the anchor often mounts under a
 * pointer that isn't moving (it replaces the "Search again" or enabled
 * button that was just clicked), and Chrome sends it a synthetic hover then,
 * which would cover the Find row with a tooltip nobody pointed at.
 */
export function DisabledWithReason({
  reason,
  placement = 'bottom',
  className,
  children,
}: DisabledWithReasonProps) {
  const reasonId = useId();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tip
        label={reason}
        placement={placement}
        open={open}
        onOpenChange={setOpen}
      >
        <span
          className={
            className ? `dl-tooltip-anchor ${className}` : 'dl-tooltip-anchor'
          }
          tabIndex={0}
          aria-describedby={reasonId}
          onPointerMove={(event: PointerEvent<HTMLSpanElement>) => {
            if (event.pointerType === 'mouse' && !open) {
              setOpen(true);
            }
          }}
          onPointerDown={(event: PointerEvent<HTMLSpanElement>) => {
            if (event.pointerType !== 'mouse') {
              setOpen(true);
            }
          }}
          onPointerLeave={() => setOpen(false)}
          onFocus={(event: FocusEvent<HTMLSpanElement>) => {
            if (focusVisible(event.currentTarget)) {
              setOpen(true);
            }
          }}
          onBlur={() => setOpen(false)}
        >
          {children}
        </span>
      </Tip>
      <span id={reasonId} className="fr-sr-only">
        {reason}
      </span>
    </>
  );
}
