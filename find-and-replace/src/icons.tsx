// The plugin's icons, from Lucide, for the `icon` props of the kit (a
// component that renders an `svg` and takes its props) and as elements. They
// are drawn at 1em, the size of the text around them (see the LucideProvider
// in utils/render.tsx); the kit sets their size from the place.
import {
  Ban,
  CircleExclamationPoint,
  ExternalLink,
  FileSearch,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';

/** A search, and a search with no results */
export const SearchIcon = Search;

/** The plugin, as in the navigation tab ('file-search') */
export const FileMagnifyingGlassIcon = FileSearch;

/** Opens a record in a new tab */
export const OpenInNewTabIcon = ExternalLink;

/** The status of an error */
export const CircleExclamationIcon = CircleExclamationPoint;

/** A role or a project that cannot use the plugin */
export const BanIcon = Ban;

/** Clears a value */
export const XmarkIcon = X;

/** Does something again (Try again) */
export const ArrowsRotateIcon = RefreshCw;
