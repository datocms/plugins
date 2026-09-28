import { ChevronsRightIcon } from 'datocms-react-ui';
import { type ReactNode, useEffect, useRef } from 'react';

type InfoOverlayProps = {
  onClose: () => void;
  children: ReactNode;
};

/**
 * The Info sidebar over the report in a narrow frame, with the look of the kit's
 * overlay. The kit's VerticalSplit swaps its whole tree when its overlay opens,
 * which remounts the report, so the page keeps the split on its rail and draws
 * this beside it. The scrim, the toggle and Esc close it. A click that started
 * in the panel (selecting its text, say) and ended on the scrim doesn't.
 */
export function InfoOverlay({ onClose, children }: InfoOverlayProps) {
  const pressedScrim = useRef(false);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="blc-overlay"
      onPointerDown={(event) => {
        pressedScrim.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedScrim.current && event.target === event.currentTarget)
          onClose();
      }}
    >
      <div className="blc-overlay__panel">
        {children}
        <div className="blc-overlay__sash">
          <button
            type="button"
            className="blc-overlay__toggle"
            aria-label="Hide sidebar"
            onClick={onClose}
          >
            <span className="blc-overlay__toggle-icon">
              <ChevronsRightIcon />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
