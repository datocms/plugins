// The plugin's icons, from Lucide. They are drawn at 1em, the size of the
// text around them (see the LucideProvider in utils/render.tsx); the kit's
// components that show them set their own size.
import {
  ChevronRight,
  CircleExclamationPoint,
  ExternalLink,
  Link,
  RefreshCw,
  Search,
} from 'lucide-react';

/** Goes to a place: the field that holds a link */
export const ChevronRightIcon = ChevronRight;

/** The status of an error */
export const CircleExclamationIcon = CircleExclamationPoint;

/** A link that opens another site in a new tab */
export const ExternalLinkIcon = ExternalLink;

/** The plugin's subject: links */
export const LinkIcon = Link;

/** Checks links again */
export const RecheckIcon = RefreshCw;

/** A search or a filter that keeps nothing */
export const SearchIcon = Search;
