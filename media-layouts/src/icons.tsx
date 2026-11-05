import type { JSX, SVGProps } from 'react';

// The plugin's own glyphs: datocms-react-ui ships no icons. Each one is a
// component that takes svg props, so it works as the `icon` of a component.
// The icons are 1em in the color of the text: the place sizes and paints them.

type IconProps = SVGProps<SVGSVGElement>;

// The kit paints icons with `fill` (a global `svg { fill }` rule, and rules
// in buttons, menus and blank slates), and a CSS rule beats the `fill`
// attribute. The inline style keeps the outlines empty: the stroke follows the
// color of the text instead.
function StrokeIcon({ style, ...props }: IconProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ fill: 'none', ...style }}
      {...props}
    />
  );
}

function FillIcon(props: IconProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}

/** Adds something: a bold plus */
export function AddIcon(props: IconProps): JSX.Element {
  return (
    <StrokeIcon strokeWidth={2.75} {...props}>
      <path d="M12 4.5v15M4.5 12h15" />
    </StrokeIcon>
  );
}

/** The "⋮" of a row or card: a vertical ellipsis */
export function ActionToggleIcon(props: IconProps): JSX.Element {
  return (
    <FillIcon {...props}>
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </FillIcon>
  );
}

/** Edits something: a pen */
export function EditIcon(props: IconProps): JSX.Element {
  return (
    <StrokeIcon {...props}>
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      <path d="m14.5 5.5 3 3" />
    </StrokeIcon>
  );
}

/** Replaces something with another: two opposing arrows */
export function ReplaceIcon(props: IconProps): JSX.Element {
  return (
    <StrokeIcon {...props}>
      <path d="m16 3 4 4-4 4" />
      <path d="M20 7H4" />
      <path d="m8 21-4-4 4-4" />
      <path d="M4 17h16" />
    </StrokeIcon>
  );
}

/** Deletes something the user made: a trash can */
export function DeleteIcon(props: IconProps): JSX.Element {
  return (
    <StrokeIcon {...props}>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6M14 11v6" />
    </StrokeIcon>
  );
}

/** Moves something earlier in an order: an arrow up */
export function MoveUpIcon(props: IconProps): JSX.Element {
  return (
    <StrokeIcon {...props}>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </StrokeIcon>
  );
}

/** Moves something later in an order: an arrow down */
export function MoveDownIcon(props: IconProps): JSX.Element {
  return (
    <StrokeIcon {...props}>
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </StrokeIcon>
  );
}

/** Moves something one column to the left: an arrow left */
export function MoveLeftIcon(props: IconProps): JSX.Element {
  return (
    <StrokeIcon {...props}>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </StrokeIcon>
  );
}

/** Moves something one column to the right: an arrow right */
export function MoveRightIcon(props: IconProps): JSX.Element {
  return (
    <StrokeIcon {...props}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </StrokeIcon>
  );
}

/** A problem: a circle with an exclamation mark */
export function WarningIcon(props: IconProps): JSX.Element {
  return (
    <StrokeIcon {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 7v6" />
      <path d="M12 16.5h.01" />
    </StrokeIcon>
  );
}
