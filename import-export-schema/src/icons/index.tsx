import type { SVGProps } from 'react';
import DiamondSvg from './diamond.svg?react';
import GridSvg from './grid-2.svg?react';
import PuzzlePieceSvg from './puzzle-piece.svg?react';

// The icons of the plugin. Like the icons of the kit, they are 1em in the
// color of the text: the place that shows them sets their size.

type IconProps = SVGProps<SVGSVGElement>;

/** A model */
export function ModelIcon(props: IconProps) {
  return (
    <DiamondSvg
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    />
  );
}

/** A block model: the grid turned into a diamond, scaled to stay in its box */
export function BlockIcon({ style, ...props }: IconProps) {
  return (
    <GridSvg
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      style={{ transform: 'rotate(45deg) scale(0.8)', ...style }}
      {...props}
    />
  );
}

/** A plugin */
export function PluginIcon(props: IconProps) {
  return (
    <PuzzlePieceSvg
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    />
  );
}

/** Export as JSON (Font Awesome file-export) */
export function ExportIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 576 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M96.5 0c-35.3 0-64 28.7-64 64l0 384c0 35.3 28.7 64 64 64l256 0c35.3 0 64-28.7 64-64l0-96 78.1 0-31 31c-9.4 9.4-9.4 24.6 0 33.9s24.6 9.4 33.9 0l72-72c9.4-9.4 9.4-24.6 0-33.9l-72-72c-9.4-9.4-24.6-9.4-33.9 0s-9.4 24.6 0 33.9l31 31-78.1 0 0-133.5c0-17-6.7-33.3-18.7-45.3L291.2 18.7C279.2 6.7 263 0 246 0L96.5 0zM358 176l-93.5 0c-13.3 0-24-10.7-24-24L240.5 58.5 358 176zM224.5 328c0-13.3 10.7-24 24-24l104 0 0 48-104 0c-13.3 0-24-10.7-24-24z" />
    </svg>
  );
}

/** Import a file (Font Awesome file-import) */
export function ImportIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 384 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M64 0C28.7 0 0 28.7 0 64l0 240 182.1 0-31-31c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l72 72c9.4 9.4 9.4 24.6 0 33.9l-72 72c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l31-31-182.1 0 0 96c0 35.3 28.7 64 64 64l256 0c35.3 0 64-28.7 64-64l0-277.5c0-17-6.7-33.3-18.7-45.3L258.7 18.7C246.7 6.7 230.5 0 213.5 0L64 0zM325.5 176L232 176c-13.3 0-24-10.7-24-24L208 58.5 325.5 176z" />
    </svg>
  );
}

/** Choose a file (Font Awesome folder-open) */
export function FolderOpenIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 576 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M56 225.6L32.4 296.2 32.4 96c0-35.3 28.7-64 64-64l138.7 0c13.8 0 27.3 4.5 38.4 12.8l38.4 28.8c5.5 4.2 12.3 6.4 19.2 6.4l117.3 0c35.3 0 64 28.7 64 64l0 16-365.4 0c-41.3 0-78 26.4-91.1 65.6zM477.8 448L99 448c-32.8 0-55.9-32.1-45.5-63.2l48-144C108 221.2 126.4 208 147 208l378.8 0c32.8 0 55.9 32.1 45.5 63.2l-48 144c-6.5 19.6-24.9 32.8-45.5 32.8z" />
    </svg>
  );
}

/** The status of an error (Font Awesome circle-exclamation) */
export function CircleExclamationIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 512 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M256 512a256 256 0 1 1 0-512 256 256 0 1 1 0 512zm0-192a32 32 0 1 0 0 64 32 32 0 1 0 0-64zm0-192c-18.2 0-32.7 15.5-31.4 33.7l7.4 104c.9 12.6 11.4 22.3 23.9 22.3 12.6 0 23-9.7 23.9-22.3l7.4-104c1.3-18.2-13.1-33.7-31.4-33.7z" />
    </svg>
  );
}

/** Try again (Font Awesome arrows-rotate) */
export function RefreshIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 512 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M65.9 228.5c13.3-93 93.4-164.5 190.1-164.5 53 0 101 21.5 135.8 56.2 .2 .2 .4 .4 .6 .6l7.6 7.2-47.9 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l128 0c17.7 0 32-14.3 32-32l0-128c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 53.4-11.3-10.7C390.5 28.6 326.5 0 256 0 127 0 20.3 95.4 2.6 219.5 .1 237 12.2 253.2 29.7 255.7s33.7-9.7 36.2-27.1zm443.5 64c2.5-17.5-9.7-33.7-27.1-36.2s-33.7 9.7-36.2 27.1c-13.3 93-93.4 164.5-190.1 164.5-53 0-101-21.5-135.8-56.2-.2-.2-.4-.4-.6-.6l-7.6-7.2 47.9 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L32 320c-8.5 0-16.7 3.4-22.7 9.5S-.1 343.7 0 352.3l1 127c.1 17.7 14.6 31.9 32.3 31.7S65.2 496.4 65 478.7l-.4-51.5 10.7 10.1c46.3 46.1 110.2 74.7 180.7 74.7 129 0 235.7-95.4 253.4-219.5z" />
    </svg>
  );
}
