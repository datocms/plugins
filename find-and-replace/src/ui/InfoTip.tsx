import { type ReactNode, useId } from 'react';
import { Tip, type TipPlacement } from './Tip';

type InfoTipProps = {
  /** The explanation: the tooltip, and the label's description for screen readers. */
  tip: string;
  placement?: TipPlacement;
  /** Classes for the label itself (for example `dl-row-tag`). */
  className?: string;
  children: ReactNode;
};

/**
 * A plain label that explains itself in a tooltip ("Changes the URL"). It's
 * focusable, so the explanation opens on keyboard focus and on a tap as well
 * as on hover, and a visually hidden copy describes it for screen readers.
 */
export function InfoTip({ tip, placement, className, children }: InfoTipProps) {
  const tipId = useId();

  return (
    <>
      <Tip label={tip} placement={placement}>
        <span
          className={
            className ? `dl-tooltip-anchor ${className}` : 'dl-tooltip-anchor'
          }
          tabIndex={0}
          aria-describedby={tipId}
        >
          {children}
        </span>
      </Tip>
      <span id={tipId} className="fr-sr-only">
        {tip}
      </span>
    </>
  );
}
