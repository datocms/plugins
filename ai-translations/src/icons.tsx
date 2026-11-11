/**
 * icons.tsx
 * ---------
 * The plugin's glyphs, as components for the kit's `icon` props (a component
 * that renders an `svg` and takes its props) and as elements (`<LanguageIcon />`
 * in a BlankSlate). They wrap Font Awesome glyphs of react-icons, the icon
 * source the plugin already uses for the vendor logos; the components that
 * show them set their size.
 */
import type { SVGProps } from 'react';
import {
  FaArrowUpRightFromSquare,
  FaCircleExclamation,
  FaCube,
  FaLanguage,
} from 'react-icons/fa6';

type IconProps = SVGProps<SVGSVGElement>;

/** The status of an error. */
export function CircleExclamationIcon(props: IconProps) {
  return (
    <FaCircleExclamation aria-hidden="true" fill="currentColor" {...props} />
  );
}

/** Translations: the plugin's section icon, like its 'languages' menu icon. */
export function LanguageIcon(props: IconProps) {
  return <FaLanguage aria-hidden="true" fill="currentColor" {...props} />;
}

/** A model: the entity that the Schema section lists. */
export function ModelIcon(props: IconProps) {
  return <FaCube aria-hidden="true" fill="currentColor" {...props} />;
}

/** Opens a page in a new tab (the record of a translation). */
export function OpenInNewTabIcon(props: IconProps) {
  return (
    <FaArrowUpRightFromSquare
      aria-hidden="true"
      fill="currentColor"
      {...props}
    />
  );
}
