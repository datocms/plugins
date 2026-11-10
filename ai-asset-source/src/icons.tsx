import type { SVGProps } from 'react';

// The plugin's own icons. Like the kit's, they are 1em, the size of the text
// around them.

/** A generated image: the same picture as the asset source icon */
export function ImageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      aria-hidden="true"
      {...props}
    >
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="2"
        ry="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <circle cx="8.5" cy="10" r="1.5" fill="currentColor" />
      <path
        d="M21 16l-5.25-5.25a1 1 0 0 0-1.41 0L9 16l-1.75-1.75a1 1 0 0 0-1.41 0L3 17.09V19h18z"
        fill="currentColor"
      />
    </svg>
  );
}
