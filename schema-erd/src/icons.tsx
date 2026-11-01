import type { SVGProps } from 'react';

// Font Awesome glyphs. Each is 1em in the color of the text: the place
// that shows it sets its size.

/** The schema diagram: the icon of the sidebar item */
export function DiagramIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 576 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M0 80C0 53.5 21.5 32 48 32l96 0c26.5 0 48 21.5 48 48l0 16 192 0 0-16c0-26.5 21.5-48 48-48l96 0c26.5 0 48 21.5 48 48l0 96c0 26.5-21.5 48-48 48l-96 0c-26.5 0-48-21.5-48-48l0-16-192 0 0 16c0 1.7-.1 3.4-.3 5L272 288l96 0c26.5 0 48 21.5 48 48l0 96c0 26.5-21.5 48-48 48l-96 0c-26.5 0-48-21.5-48-48l0-96c0-1.7 .1-3.4 .3-5L144 224l-96 0c-26.5 0-48-21.5-48-48L0 80z" />
    </svg>
  );
}

export function MagnifyingGlassPlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 512 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376c-34.4 25.2-76.8 40-122.7 40C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208zM184 296c0 13.3 10.7 24 24 24s24-10.7 24-24l0-64 64 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-64 0 0-64c0-13.3-10.7-24-24-24s-24 10.7-24 24l0 64-64 0c-13.3 0-24 10.7-24 24s10.7 24 24 24l64 0 0 64z" />
    </svg>
  );
}

export function MagnifyingGlassMinusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 512 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376c-34.4 25.2-76.8 40-122.7 40C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208zM136 184c-13.3 0-24 10.7-24 24s10.7 24 24 24l144 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-144 0z" />
    </svg>
  );
}

export function ArrowRotateLeftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 512 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M125.7 160l50.3 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L48 224c-17.7 0-32-14.3-32-32L16 64c0-17.7 14.3-32 32-32s32 14.3 32 32l0 51.2L97.6 97.6c87.5-87.5 229.3-87.5 316.8 0s87.5 229.3 0 316.8s-229.3 87.5-316.8 0c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0c62.5 62.5 163.8 62.5 226.3 0s62.5-163.8 0-226.3s-163.8-62.5-226.3 0L125.7 160z" />
    </svg>
  );
}

export function CrosshairsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 512 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M256 0c17.7 0 32 14.3 32 32l0 10.4c93.7 13.9 167.7 88 181.6 181.6l10.4 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-10.4 0c-13.9 93.7-88 167.7-181.6 181.6l0 10.4c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-10.4C130.3 455.7 56.3 381.7 42.4 288L32 288c-17.7 0-32-14.3-32-32s14.3-32 32-32l10.4 0C56.3 130.3 130.3 56.3 224 42.4L224 32c0-17.7 14.3-32 32-32zM107.4 288c12.5 58.3 58.4 104.1 116.6 116.6l0-20.6c0-17.7 14.3-32 32-32s32 14.3 32 32l0 20.6c58.3-12.5 104.1-58.4 116.6-116.6L384 288c-17.7 0-32-14.3-32-32s14.3-32 32-32l20.6 0C392.1 165.7 346.3 119.9 288 107.4l0 20.6c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-20.6C165.7 119.9 119.9 165.7 107.4 224l20.6 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-20.6 0zM256 224a32 32 0 1 1 0 64 32 32 0 1 1 0-64z" />
    </svg>
  );
}

export function DownloadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 512 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M288 32c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 242.7-73.4-73.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l128 128c12.5 12.5 32.8 12.5 45.3 0l128-128c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L288 274.7 288 32zM64 352c-35.3 0-64 28.7-64 64l0 32c0 35.3 28.7 64 64 64l384 0c35.3 0 64-28.7 64-64l0-32c0-35.3-28.7-64-64-64l-101.5 0-45.3 45.3c-25 25-65.5 25-90.5 0L165.5 352 64 352zm368 56a24 24 0 1 1 0 48 24 24 0 1 1 0-48z" />
    </svg>
  );
}

/** The status of an error */
export function CircleExclamationIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 512 512"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M256 48a208 208 0 1 1 0 416 208 208 0 1 1 0-416zm0 464A256 256 0 1 0 256 0a256 256 0 1 0 0 512zm0-384c-13.3 0-24 10.7-24 24v112c0 13.3 10.7 24 24 24s24-10.7 24-24V152c0-13.3-10.7-24-24-24zm32 224a32 32 0 1 0-64 0 32 32 0 1 0 64 0z" />
    </svg>
  );
}
