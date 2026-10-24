/**
 * InsetRowList.tsx
 * ----------------
 * A RowList in a column of content that already has an inset: the body of a
 * dialog, a sidebar panel. RowList keeps its text at the inset of its own
 * box, so in such a column a negative margin puts the box out of the column
 * and the text of the rows lines up with the fields and lines around the
 * list (RowList, "The inset row"). The margin never goes past the body
 * padding of the frame, so the hover surface of a row stays in the frame.
 */
import RowList from 'datocms-react-ui/RowList';
import type { CSSProperties, ReactNode } from 'react';
import s from './InsetRowList.module.css';

export interface InsetRowListProps {
  /** The body padding of the frame (`ctx.bodyPadding`: top, right, bottom, left). */
  bodyPadding: readonly number[];
  /** Places the box, for example a scroll box around the rows. */
  className?: string;
  /** The rows (RowList.Item). */
  children: ReactNode;
}

export function InsetRowList({
  bodyPadding,
  className,
  children,
}: InsetRowListProps) {
  const [, right = 0, , left = 0] = bodyPadding;
  // The frame padding on each side caps the margin (see the CSS module).
  const frameInsets = {
    '--InsetRowList-frame-left': `${left}px`,
    '--InsetRowList-frame-right': `${right}px`,
  } as CSSProperties;

  return (
    <div
      className={className ? `${s.inset} ${className}` : s.inset}
      style={frameInsets}
    >
      <RowList>{children}</RowList>
    </div>
  );
}
