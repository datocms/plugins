/**
 * icons.tsx
 * ---------
 * The plugin's glyphs, from Lucide, as components for the kit's `icon` props
 * (a component that renders an `svg` and takes its props) and as elements
 * (`<LanguageIcon />` in a BlankSlate). They are drawn at 1em, the size of the
 * text around them (see the LucideProvider in utils/render.tsx).
 */
import {
  Box,
  CircleExclamationPoint,
  ExternalLink,
  Languages,
} from 'lucide-react';

/** The status of an error. */
export const CircleExclamationIcon = CircleExclamationPoint;

/** Translations: the plugin's section icon, like its 'languages' menu icon. */
export const LanguageIcon = Languages;

/** A model: the entity that the Schema section lists. */
export const ModelIcon = Box;

/** Opens a page in a new tab (the record of a translation). */
export const OpenInNewTabIcon = ExternalLink;
