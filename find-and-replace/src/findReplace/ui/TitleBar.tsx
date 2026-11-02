import Pane from 'datocms-react-ui/Pane';
import Toolbar from 'datocms-react-ui/Toolbar';
import type { ReactNode } from 'react';
import { STRINGS } from './copy';

/**
 * Under 600px of frame width the bar has no room for the meta after the
 * title: it shows above the results instead.
 */
export const NARROW_FRAME_QUERY = '(max-width: 599.98px)';

type TitleBarProps = {
  /** "124 matches in 38 records", after the title. */
  meta?: string | null;
  /**
   * A frame under 600px wide: the bar keeps its room for the title and the
   * slot, and the meta shows above the results instead (see Body).
   */
  narrow?: boolean;
  /** The primary slot, at the right end. */
  children?: ReactNode;
};

/**
 * The title bar of the page's view pane: the title (with its "?"), the meta,
 * and the slot at the right end. The header puts the parts in that order,
 * and leaves out those that are falsy.
 */
export function TitleBar({
  meta = null,
  narrow = false,
  children,
}: TitleBarProps) {
  return (
    <Pane.Header>
      <Pane.Header.Title
        level={1}
        help={<Toolbar.Help>{STRINGS.help}</Toolbar.Help>}
      >
        {STRINGS.title}
      </Pane.Header.Title>
      {meta && !narrow && <Pane.Header.Subtitle>{meta}</Pane.Header.Subtitle>}
      {children && <Pane.Header.Button>{children}</Pane.Header.Button>}
    </Pane.Header>
  );
}
