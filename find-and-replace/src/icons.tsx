/* Font Awesome Pro 6.5.2 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license (Commercial License) Copyright 2024 Fonticons, Inc. */
/* Regular style, copied verbatim from the dashboard icon set (cms/src/icons/regular). Keep this header. */
/* XmarkIcon and ArrowsRotateIcon: Font Awesome Free 6.7.2 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free (Icons: CC BY 4.0) Copyright 2024 Fonticons, Inc. Solid style. */
import type { ReactElement, SVGProps } from 'react';

/**
 * An icon for the `icon` props of the kit: a 1em square painted with the
 * color of the text around it. The kit sets its size from the place.
 */
export type IconComponent = (props: SVGProps<SVGSVGElement>) => ReactElement;

function glyphIcon(viewBox: string, d: string): IconComponent {
  return function GlyphIcon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg
        viewBox={viewBox}
        width="1em"
        height="1em"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
        {...props}
      >
        <path d={d} />
      </svg>
    );
  };
}

/** magnifying-glass (regular): a search, and a search with no results */
export const SearchIcon = glyphIcon(
  '0 0 512 512',
  'M368 208A160 160 0 1 0 48 208a160 160 0 1 0 320 0zM337.1 371.1C301.7 399.2 256.8 416 208 416C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208c0 48.8-16.8 93.7-44.9 129.1L505 471c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0L337.1 371.1z',
);

/** file-magnifying-glass (regular): the plugin, as in the navigation tab */
export const FileMagnifyingGlassIcon = glyphIcon(
  '0 0 384 512',
  'M64 464c-8.8 0-16-7.2-16-16V64c0-8.8 7.2-16 16-16H224v80c0 17.7 14.3 32 32 32h80V448c0 8.8-7.2 16-16 16H64zM64 0C28.7 0 0 28.7 0 64V448c0 35.3 28.7 64 64 64H320c35.3 0 64-28.7 64-64V154.5c0-17-6.7-33.3-18.7-45.3L274.7 18.7C262.7 6.7 246.5 0 229.5 0H64zM272 304c0-53-43-96-96-96s-96 43-96 96s43 96 96 96c17.8 0 34.4-4.8 48.7-13.2L263 425.1c9.4 9.4 24.6 9.4 33.9 0s9.4-24.6 0-33.9l-38.3-38.3c8.5-14.3 13.3-31 13.3-48.9zm-96-48a48 48 0 1 1 0 96 48 48 0 1 1 0-96z',
);

/** arrow-right (regular): the decorative separator between Find and Replace with */
export const ArrowRightIcon = glyphIcon(
  '0 0 448 512',
  'M440.6 273.4c4.7-4.5 7.4-10.8 7.4-17.4s-2.7-12.8-7.4-17.4l-176-168c-9.6-9.2-24.8-8.8-33.9 .8s-8.8 24.8 .8 33.9L364.1 232 24 232c-13.3 0-24 10.7-24 24s10.7 24 24 24l340.1 0L231.4 406.6c-9.6 9.2-9.9 24.3-.8 33.9s24.3 9.9 33.9 .8l176-168z',
);

/** font-case (regular): Match case */
export const FontCaseIcon = glyphIcon(
  '0 0 640 512',
  'M198.4 47.5C194.9 38.2 186 32 176 32s-18.9 6.2-22.4 15.5l-152 400c-4.7 12.4 1.5 26.3 13.9 31s26.3-1.5 31-13.9L83.1 368H268.9l36.7 96.5c4.7 12.4 18.6 18.6 31 13.9s18.6-18.6 13.9-31l-152-400zM250.7 320H101.4L176 123.6 250.7 320zM616 160c-13.3 0-24 10.7-24 24v8.8c-22.1-20.4-51.6-32.8-84-32.8c-68.5 0-124 55.5-124 124v72c0 68.5 55.5 124 124 124c32.4 0 61.9-12.4 84-32.8V456c0 13.3 10.7 24 24 24s24-10.7 24-24V184c0-13.3-10.7-24-24-24zM432 284c0-42 34-76 76-76s76 34 76 76v72c0 42-34 76-76 76s-76-34-76-76V284z',
);

/** input-text (regular): Match whole word */
export const InputTextIcon = glyphIcon(
  '0 0 640 512',
  'M64 112c-8.8 0-16 7.2-16 16V384c0 8.8 7.2 16 16 16H576c8.8 0 16-7.2 16-16V128c0-8.8-7.2-16-16-16H64zM0 128C0 92.7 28.7 64 64 64H576c35.3 0 64 28.7 64 64V384c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V128zm184 32c9.5 0 18.1 5.6 21.9 14.3l64 144c5.4 12.1-.1 26.3-12.2 31.7s-26.3-.1-31.7-12.2l-4.3-9.7H146.3l-4.3 9.7c-5.4 12.1-19.6 17.6-31.7 12.2s-17.6-19.6-12.2-31.7l64-144c3.9-8.7 12.4-14.3 21.9-14.3zm0 83.1L167.6 280h32.8L184 243.1zM304 184c0-13.3 10.7-24 24-24h52c33.1 0 60 26.9 60 60c0 9.2-2.1 17.9-5.8 25.7c13.3 11 21.8 27.6 21.8 46.3c0 33.1-26.9 60-60 60H328c-13.3 0-24-10.7-24-24v-8V256 192v-8zm48 24v24h28c6.6 0 12-5.4 12-12s-5.4-12-12-12H352zm0 96h44c6.6 0 12-5.4 12-12s-5.4-12-12-12H380 352v24z',
);

/** asterisk (regular): Use regular expression */
export const AsteriskIcon = glyphIcon(
  '0 0 384 512',
  'M192 32c13.3 0 24 10.7 24 24V212.9l131.4-81.3c11.3-7 26.1-3.5 33 7.8s3.5 26.1-7.8 33L237.6 256l135 83.6c11.3 7 14.8 21.8 7.8 33s-21.8 14.7-33 7.8L216 299.1V456c0 13.3-10.7 24-24 24s-24-10.7-24-24V299.1L36.6 380.4c-11.3 7-26.1 3.5-33-7.8s-3.5-26.1 7.8-33l135-83.6-135-83.6c-11.3-7-14.8-21.8-7.8-33s21.8-14.8 33-7.8L168 212.9V56c0-13.3 10.7-24 24-24z',
);

/** eraser (regular): Replace with nothing */
export const EraserIcon = glyphIcon(
  '0 0 576 512',
  'M97 319c-9.4 9.4-9.4 24.6 0 33.9l72 72c4.5 4.5 10.6 7 17 7H294.1c6.4 0 12.5-2.5 17-7l65-65L216 200 97 319zM285.1 63c28.1-28.1 73.7-28.1 101.8 0L513 189.1c28.1 28.1 28.1 73.7 0 101.8L371.9 432H520c13.3 0 24 10.7 24 24s-10.7 24-24 24H296v0c-.6 0-1.3 0-1.9 0H185.9c-19.1 0-37.4-7.6-50.9-21.1l-72-72c-28.1-28.1-28.1-73.7 0-101.8L285.1 63z',
);

/** arrow-up-right-from-square (regular): open a record in a new tab */
export const OpenInNewTabIcon = glyphIcon(
  '0 0 512 512',
  'M304 24c0 13.3 10.7 24 24 24H430.1L207 271c-9.4 9.4-9.4 24.6 0 33.9s24.6 9.4 33.9 0l223-223V184c0 13.3 10.7 24 24 24s24-10.7 24-24V24c0-13.3-10.7-24-24-24H328c-13.3 0-24 10.7-24 24zM72 32C32.2 32 0 64.2 0 104V440c0 39.8 32.2 72 72 72H408c39.8 0 72-32.2 72-72V312c0-13.3-10.7-24-24-24s-24 10.7-24 24V440c0 13.3-10.7 24-24 24H72c-13.3 0-24-10.7-24-24V104c0-13.3 10.7-24 24-24H200c13.3 0 24-10.7 24-24s-10.7-24-24-24H72z',
);

/** circle-exclamation (regular): the status of an error */
export const CircleExclamationIcon = glyphIcon(
  '0 0 512 512',
  'M256 48a208 208 0 1 1 0 416 208 208 0 1 1 0-416zm0 464A256 256 0 1 0 256 0a256 256 0 1 0 0 512zm0-384c-13.3 0-24 10.7-24 24V264c0 13.3 10.7 24 24 24s24-10.7 24-24V152c0-13.3-10.7-24-24-24zm32 224a32 32 0 1 0 -64 0 32 32 0 1 0 64 0z',
);

/** ban (regular): a role or a project that cannot use the plugin */
export const BanIcon = glyphIcon(
  '0 0 512 512',
  'M385.1 419.1L92.9 126.9C64.8 162.3 48 207.2 48 256c0 114.9 93.1 208 208 208c48.8 0 93.7-16.8 129.1-44.9zm33.9-33.9C447.2 349.7 464 304.8 464 256c0-114.9-93.1-208-208-208c-48.8 0-93.7 16.8-129.1 44.9L419.1 385.1zM0 256a256 256 0 1 1 512 0A256 256 0 1 1 0 256z',
);

/** xmark (solid): clears a value. Close icons are bold. */
export const XmarkIcon = glyphIcon(
  '0 0 384 512',
  'M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z',
);

/** arrows-rotate (solid): does something again (Try again) */
export const ArrowsRotateIcon = glyphIcon(
  '0 0 512 512',
  'M105.1 202.6c7.7-21.8 20.2-42.3 37.8-59.8c62.5-62.5 163.8-62.5 226.3 0L386.3 160 352 160c-17.7 0-32 14.3-32 32s14.3 32 32 32l111.5 0c0 0 0 0 0 0l.4 0c17.7 0 32-14.3 32-32l0-112c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 35.2L414.4 97.6c-87.5-87.5-229.3-87.5-316.8 0C73.2 122 55.6 150.7 44.8 181.4c-5.9 16.7 2.9 34.9 19.5 40.8s34.9-2.9 40.8-19.5zM39 289.3c-5 1.5-9.8 4.2-13.7 8.2c-4 4-6.7 8.8-8.1 14c-.3 1.2-.6 2.5-.8 3.8c-.3 1.7-.4 3.4-.4 5.1L16 432c0 17.7 14.3 32 32 32s32-14.3 32-32l0-35.1 17.6 17.5c0 0 0 0 0 0c87.5 87.4 229.3 87.4 316.7 0c24.4-24.4 42.1-53.1 52.9-83.8c5.9-16.7-2.9-34.9-19.5-40.8s-34.9 2.9-40.8 19.5c-7.7 21.8-20.2 42.3-37.8 59.8c-62.5 62.5-163.8 62.5-226.3 0l-.1-.1L125.6 352l34.4 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L48.4 288c-1.6 0-3.2 .1-4.8 .3s-3.1 .5-4.6 1z',
);
